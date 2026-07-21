const OUTBOX_PREFIX = 'billing-usage-pending/';
const INVALID_PREFIX = 'billing-usage-invalid/';
const DEFAULT_BATCH_SIZE = 100;
const MAX_RETRY_DELAY_MS = 6 * 60 * 60 * 1000;

export interface UsageReportPayload {
  eventType: 'model_tokens';
  idempotencyKey: string;
  provider: string;
  endpoint: string;
  upstreamStatus: number;
  requestId: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cachedInputTokens: number;
  rawUsage: unknown;
  metadata: Record<string, unknown>;
}

export interface BillingOutboxBucket {
  put(
    key: string,
    value: string,
    options?: { httpMetadata?: { contentType?: string } }
  ): Promise<unknown>;
  get(key: string): Promise<{ text(): Promise<string> } | null>;
  delete(key: string): Promise<void>;
  list(options: {
    prefix: string;
    limit: number;
  }): Promise<{ objects: Array<{ key: string }> }>;
}

export interface BillingOutboxEnv {
  WORKSPACE_ARCHIVES: BillingOutboxBucket;
  APP_BASE_URL?: string;
  BILLING_USAGE_WEBHOOK_SECRET?: string;
}

interface PendingUsageReport {
  version: 1;
  sessionId: string;
  payload: UsageReportPayload;
  attempts: number;
  createdAt: string;
  updatedAt: string;
  nextAttemptAt: string;
  lastError: string;
}

interface DeliveryOptions {
  fetchFn?: typeof fetch;
  now?: Date;
  sleepFn?: (delayMs: number) => Promise<void>;
}

export interface BillingOutboxFlushResult {
  scanned: number;
  delivered: number;
  deferred: number;
  failed: number;
  invalid: number;
}

export async function deliverOrQueueUsageReport(
  env: BillingOutboxEnv,
  sessionId: string,
  payload: UsageReportPayload,
  options: DeliveryOptions = {}
) {
  const fetchFn = options.fetchFn || fetch;
  const sleepFn = options.sleepFn || sleep;
  let lastError = '';

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await postUsageReport(env, sessionId, payload, fetchFn);
      return { delivered: true, queued: false };
    } catch (error) {
      lastError = errorMessage(error);
      if (attempt === 0) await sleepFn(250);
    }
  }

  const now = options.now || new Date();
  const pending: PendingUsageReport = {
    version: 1,
    sessionId,
    payload,
    attempts: 2,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    nextAttemptAt: new Date(now.getTime() + retryDelayMs(2)).toISOString(),
    lastError,
  };
  await env.WORKSPACE_ARCHIVES.put(
    usageReportKey(sessionId, payload.idempotencyKey),
    JSON.stringify(pending),
    { httpMetadata: { contentType: 'application/json' } }
  );
  return { delivered: false, queued: true };
}

export async function flushPendingUsageReports(
  env: BillingOutboxEnv,
  options: DeliveryOptions & { limit?: number } = {}
): Promise<BillingOutboxFlushResult> {
  const now = options.now || new Date();
  const fetchFn = options.fetchFn || fetch;
  const result: BillingOutboxFlushResult = {
    scanned: 0,
    delivered: 0,
    deferred: 0,
    failed: 0,
    invalid: 0,
  };
  const batchSize = Math.min(
    100,
    Math.max(1, options.limit || DEFAULT_BATCH_SIZE)
  );
  const listed = await env.WORKSPACE_ARCHIVES.list({
    prefix: OUTBOX_PREFIX,
    limit: Math.min(1000, batchSize * 10),
  });

  for (const object of listed.objects) {
    if (result.delivered + result.failed >= batchSize) break;
    result.scanned += 1;
    const stored = await env.WORKSPACE_ARCHIVES.get(object.key);
    if (!stored) continue;

    let pending: PendingUsageReport;
    const raw = await stored.text().catch(() => '');
    try {
      pending = JSON.parse(raw) as PendingUsageReport;
      validatePendingUsageReport(pending);
    } catch {
      result.invalid += 1;
      await env.WORKSPACE_ARCHIVES.put(
        `${INVALID_PREFIX}${encodeURIComponent(object.key)}.txt`,
        raw,
        { httpMetadata: { contentType: 'text/plain' } }
      );
      await env.WORKSPACE_ARCHIVES.delete(object.key);
      continue;
    }

    if (Date.parse(pending.nextAttemptAt) > now.getTime()) {
      result.deferred += 1;
      continue;
    }

    try {
      await postUsageReport(env, pending.sessionId, pending.payload, fetchFn);
      await env.WORKSPACE_ARCHIVES.delete(object.key);
      result.delivered += 1;
    } catch (error) {
      const attempts = pending.attempts + 1;
      const updated: PendingUsageReport = {
        ...pending,
        attempts,
        updatedAt: now.toISOString(),
        nextAttemptAt: new Date(
          now.getTime() + retryDelayMs(attempts)
        ).toISOString(),
        lastError: errorMessage(error),
      };
      await env.WORKSPACE_ARCHIVES.put(object.key, JSON.stringify(updated), {
        httpMetadata: { contentType: 'application/json' },
      });
      result.failed += 1;
    }
  }

  return result;
}

async function postUsageReport(
  env: BillingOutboxEnv,
  sessionId: string,
  payload: UsageReportPayload,
  fetchFn: typeof fetch
) {
  if (!env.APP_BASE_URL || !env.BILLING_USAGE_WEBHOOK_SECRET) {
    throw new Error('Billing delivery is not configured');
  }

  const target = new URL(env.APP_BASE_URL);
  target.pathname = `/api/code/sessions/${encodeURIComponent(sessionId)}/usage`;
  const response = await fetchFn(target, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-hicode-billing-secret': env.BILLING_USAGE_WEBHOOK_SECRET,
    },
    body: JSON.stringify(payload),
  });
  const body = (await response.json().catch(() => null)) as {
    code?: number;
    message?: string;
  } | null;

  if (!response.ok || body?.code !== 0) {
    throw new Error(
      body?.message || `Billing usage delivery failed (${response.status})`
    );
  }
}

function usageReportKey(sessionId: string, idempotencyKey: string) {
  return `${OUTBOX_PREFIX}${encodeURIComponent(sessionId)}/${encodeURIComponent(idempotencyKey)}.json`;
}

function retryDelayMs(attempts: number) {
  return Math.min(MAX_RETRY_DELAY_MS, 30_000 * 2 ** Math.min(10, attempts));
}

function validatePendingUsageReport(value: PendingUsageReport) {
  if (
    value?.version !== 1 ||
    !value.sessionId ||
    !value.payload?.idempotencyKey ||
    value.payload.eventType !== 'model_tokens'
  ) {
    throw new Error('Invalid pending usage report');
  }
}

function errorMessage(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500);
}

function sleep(delayMs: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, delayMs));
}
