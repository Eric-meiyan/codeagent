const OUTBOX_PREFIX = 'billing-usage-pending/';
const INVALID_PREFIX = 'billing-usage-invalid/';
const UNRESOLVED_PREFIX = 'billing-usage-unresolved/';
const DEFAULT_BATCH_SIZE = 100;
const MAX_RETRY_DELAY_MS = 6 * 60 * 60 * 1000;
const MAX_UNRESOLVED_USAGE_RETRY_DELAY_MS = 5 * 60 * 1000;
const UNRESOLVED_ALERT_AFTER_MS = 24 * 60 * 60 * 1000;
const UNRESOLVED_DEAD_LETTER_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

export interface UsageReportPayload {
  eventType: 'model_tokens';
  idempotencyKey: string;
  provider: string;
  endpoint: string;
  upstreamStatus: number;
  requestId: string;
  costSource?: 'provider_log';
  providerRequestId?: string;
  providerQuota?: number;
  providerGroup?: string;
  providerGroupRatio?: number;
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
  alertedAt?: string;
}

interface DeliveryOptions {
  fetchFn?: typeof fetch;
  now?: Date;
  sleepFn?: (delayMs: number) => Promise<void>;
  preparePayload?: (payload: UsageReportPayload) => Promise<UsageReportPayload>;
}

export interface BillingOutboxFlushResult {
  scanned: number;
  delivered: number;
  deferred: number;
  failed: number;
  invalid: number;
  alerted: number;
  deadLettered: number;
  errors?: string[];
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

export async function queueUsageReport(
  env: BillingOutboxEnv,
  sessionId: string,
  payload: UsageReportPayload,
  options: { now?: Date; lastError?: string } = {}
) {
  const now = options.now || new Date();
  const pending: PendingUsageReport = {
    version: 1,
    sessionId,
    payload,
    attempts: 0,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    nextAttemptAt: new Date(now.getTime() + retryDelayMs(0)).toISOString(),
    lastError: options.lastError || '',
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
    alerted: 0,
    deadLettered: 0,
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

    if (effectiveNextAttemptAt(pending) > now.getTime()) {
      result.deferred += 1;
      continue;
    }

    try {
      const payload = options.preparePayload
        ? await options.preparePayload(pending.payload)
        : pending.payload;
      await postUsageReport(env, pending.sessionId, payload, fetchFn);
      await env.WORKSPACE_ARCHIVES.delete(object.key);
      result.delivered += 1;
    } catch (error) {
      const failure = errorMessage(error);
      const attempts = pending.attempts + 1;
      let updated: PendingUsageReport = {
        ...pending,
        attempts,
        updatedAt: now.toISOString(),
        nextAttemptAt: new Date(
          now.getTime() +
            retryDelayMsWithLimit(
              attempts,
              pending.payload.costSource === 'provider_log'
                ? MAX_RETRY_DELAY_MS
                : MAX_UNRESOLVED_USAGE_RETRY_DELAY_MS
            )
        ).toISOString(),
        lastError: failure,
      };

      if (pending.payload.costSource !== 'provider_log') {
        const unresolvedAgeMs = pendingAgeMs(pending, now);
        if (
          unresolvedAgeMs >= UNRESOLVED_ALERT_AFTER_MS &&
          !pending.alertedAt
        ) {
          try {
            await postReconciliationIssue(
              env,
              pending.sessionId,
              pending.payload,
              {
                attempts,
                firstQueuedAt: pending.createdAt,
                lastError: failure,
              },
              fetchFn
            );
            updated = { ...updated, alertedAt: now.toISOString() };
            result.alerted += 1;
          } catch (alertError) {
            appendError(result, errorMessage(alertError));
          }
        }

        if (
          unresolvedAgeMs >= UNRESOLVED_DEAD_LETTER_AFTER_MS &&
          updated.alertedAt
        ) {
          await env.WORKSPACE_ARCHIVES.put(
            unresolvedUsageKey(object.key),
            JSON.stringify(updated),
            { httpMetadata: { contentType: 'application/json' } }
          );
          await env.WORKSPACE_ARCHIVES.delete(object.key);
          result.deadLettered += 1;
          result.failed += 1;
          appendError(result, failure);
          continue;
        }
      }

      await env.WORKSPACE_ARCHIVES.put(object.key, JSON.stringify(updated), {
        httpMetadata: { contentType: 'application/json' },
      });
      result.failed += 1;
      appendError(result, failure);
    }
  }

  return result;
}

async function postReconciliationIssue(
  env: BillingOutboxEnv,
  sessionId: string,
  payload: UsageReportPayload,
  issue: { attempts: number; firstQueuedAt: string; lastError: string },
  fetchFn: typeof fetch
) {
  await postBillingPayload(
    env,
    sessionId,
    {
      eventType: 'model_usage_unresolved',
      idempotencyKey: payload.idempotencyKey,
      provider: payload.provider,
      endpoint: payload.endpoint,
      upstreamStatus: payload.upstreamStatus,
      requestId: payload.requestId,
      inputTokens: payload.inputTokens,
      outputTokens: payload.outputTokens,
      cacheCreationInputTokens: payload.cacheCreationInputTokens,
      cachedInputTokens: payload.cachedInputTokens,
      attempts: issue.attempts,
      firstQueuedAt: issue.firstQueuedAt,
      lastError: issue.lastError,
      metadata: payload.metadata,
    },
    fetchFn
  );
}

async function postUsageReport(
  env: BillingOutboxEnv,
  sessionId: string,
  payload: UsageReportPayload,
  fetchFn: typeof fetch
) {
  await postBillingPayload(env, sessionId, payload, fetchFn);
}

async function postBillingPayload(
  env: BillingOutboxEnv,
  sessionId: string,
  payload: unknown,
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

function unresolvedUsageKey(pendingKey: string) {
  return `${UNRESOLVED_PREFIX}${encodeURIComponent(pendingKey)}.json`;
}

function pendingAgeMs(pending: PendingUsageReport, now: Date) {
  const createdAt = Date.parse(pending.createdAt);
  return Number.isFinite(createdAt)
    ? Math.max(0, now.getTime() - createdAt)
    : 0;
}

function retryDelayMs(attempts: number) {
  return retryDelayMsWithLimit(attempts, MAX_RETRY_DELAY_MS);
}

function retryDelayMsWithLimit(attempts: number, limitMs: number) {
  return Math.min(limitMs, 30_000 * 2 ** Math.min(10, attempts));
}

function effectiveNextAttemptAt(pending: PendingUsageReport) {
  const storedNextAttemptAt = Date.parse(pending.nextAttemptAt);
  if (pending.payload.costSource === 'provider_log') {
    return storedNextAttemptAt;
  }

  const updatedAt = Date.parse(pending.updatedAt);
  const cappedNextAttemptAt =
    updatedAt +
    retryDelayMsWithLimit(
      pending.attempts,
      MAX_UNRESOLVED_USAGE_RETRY_DELAY_MS
    );
  return Math.min(storedNextAttemptAt, cappedNextAttemptAt);
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

function appendError(result: BillingOutboxFlushResult, error: string) {
  result.errors ||= [];
  if (result.errors.length < 5 && !result.errors.includes(error)) {
    result.errors.push(error);
  }
}

function sleep(delayMs: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, delayMs));
}
