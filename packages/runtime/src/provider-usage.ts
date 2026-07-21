import type { UsageReportPayload } from './billing-outbox';

const DEFAULT_PROVIDER_BASE_URL = 'https://api.anthropic.com';

interface ProviderUsageEnv {
  ANTHROPIC_API_BASE_URL?: string;
  ANTHROPIC_API_KEY?: string;
  OPENAI_API_KEY?: string;
  YUNWU_SYSTEM_ACCESS_TOKEN?: string;
  YUNWU_USER_ID?: string;
}

interface ProviderUsageLog {
  request_id?: unknown;
  upstream_request_id?: unknown;
  quota?: unknown;
  group?: unknown;
  model_name?: unknown;
  created_at?: unknown;
  prompt_tokens?: unknown;
  completion_tokens?: unknown;
  other?: unknown;
}

interface ResolveOptions {
  fetchFn?: typeof fetch;
  attempts?: number;
  sleepFn?: (delayMs: number) => Promise<void>;
}

export async function resolveProviderUsageReport(
  env: ProviderUsageEnv,
  payload: UsageReportPayload,
  options: ResolveOptions = {}
): Promise<UsageReportPayload | null> {
  if (payload.costSource === 'provider_log') return payload;
  if (!payload.requestId) return null;

  const apiKey = apiKeyForEndpoint(env, payload.endpoint);
  if (!apiKey) return null;

  const attempts = Math.max(1, options.attempts || 1);
  const fetchFn = options.fetchFn || fetch;
  const sleepFn = options.sleepFn || sleep;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const logs = await fetchProviderUsageLogs(
      env,
      apiKey,
      payload.requestId,
      fetchFn
    );
    const log = logs.find(
      (item) =>
        textValue(item.request_id) === payload.requestId ||
        textValue(item.upstream_request_id) === payload.requestId
    );
    if (log) return mergeProviderUsage(payload, log);

    if (env.YUNWU_SYSTEM_ACCESS_TOKEN?.trim()) {
      const candidates = await fetchRecentProviderUsageLogs(
        env,
        payload,
        fetchFn
      );
      const matched = matchProviderUsageLog(payload, candidates);
      if (matched) return mergeProviderUsage(payload, matched);
    }
    if (attempt + 1 < attempts) {
      await sleepFn(250 * 2 ** attempt);
    }
  }

  return null;
}

async function fetchRecentProviderUsageLogs(
  env: ProviderUsageEnv,
  payload: UsageReportPayload,
  fetchFn: typeof fetch
): Promise<ProviderUsageLog[]> {
  const expectedAt = expectedProviderTimestamp(payload);
  if (!expectedAt) return [];

  const { target, headers } = systemUsageLogRequest(env);
  const windowSeconds = 10 * 60;
  target.searchParams.set('page', '1');
  target.searchParams.set('page_size', '100');
  target.searchParams.set('type', '2');
  target.searchParams.set(
    'start_timestamp',
    String(expectedAt - windowSeconds)
  );
  target.searchParams.set('end_timestamp', String(expectedAt + windowSeconds));
  const model = textValue(payload.metadata.model);
  if (model) target.searchParams.set('model_name', model);

  const response = await fetchFn(target, { headers });
  return usageLogs(await parseUsageLogResponse(response));
}

async function fetchProviderUsageLogs(
  env: ProviderUsageEnv,
  apiKey: string,
  requestId: string,
  fetchFn: typeof fetch
): Promise<ProviderUsageLog[]> {
  const target = new URL(
    env.ANTHROPIC_API_BASE_URL || DEFAULT_PROVIDER_BASE_URL
  );
  target.search = '';
  const systemAccessToken = env.YUNWU_SYSTEM_ACCESS_TOKEN?.trim() || '';
  const headers = new Headers({ accept: 'application/json' });

  if (systemAccessToken) {
    const systemRequest = systemUsageLogRequest(env);
    target.pathname = systemRequest.target.pathname;
    target.searchParams.set('request_id', requestId);
    target.searchParams.set('page', '1');
    target.searchParams.set('page_size', '20');
    systemRequest.headers.forEach((value, key) => headers.set(key, value));
  } else {
    target.pathname = '/api/log/token';
    headers.set('authorization', `Bearer ${apiKey}`);
    headers.set('x-api-key', apiKey);
  }

  let response = await fetchFn(target, { headers });
  let body = await parseUsageLogResponse(response);

  if (systemAccessToken && usageLogs(body).length === 0) {
    target.searchParams.delete('request_id');
    target.searchParams.set('upstream_request_id', requestId);
    response = await fetchFn(target, { headers });
    body = await parseUsageLogResponse(response);
  }

  return usageLogs(body);
}

function systemUsageLogRequest(env: ProviderUsageEnv) {
  const systemAccessToken = env.YUNWU_SYSTEM_ACCESS_TOKEN?.trim() || '';
  const userId = env.YUNWU_USER_ID?.trim() || '';
  if (!systemAccessToken) {
    throw new Error('Provider system access token is not configured');
  }
  if (!userId) {
    throw new Error('Provider user ID is not configured');
  }

  const target = new URL(
    env.ANTHROPIC_API_BASE_URL || DEFAULT_PROVIDER_BASE_URL
  );
  target.pathname = '/api/log/self';
  target.search = '';
  const headers = new Headers({
    accept: 'application/json',
    authorization: `Bearer ${systemAccessToken}`,
    'new-api-user': userId,
  });
  return { target, headers };
}

async function parseUsageLogResponse(response: Response) {
  if (!response.ok) {
    throw new Error(`Provider usage lookup failed (${response.status})`);
  }

  const body = (await response.json().catch(() => null)) as {
    success?: boolean;
    data?: unknown;
    message?: unknown;
    error?: unknown;
    code?: unknown;
  } | null;
  if (!body) {
    throw new Error('Provider usage lookup returned an invalid response');
  }
  if (body.success === false) {
    const detail =
      textValue(body.message) || textValue(body.error) || textValue(body.code);
    throw new Error(
      `Provider usage lookup rejected${detail ? `: ${detail}` : ''}`
    );
  }
  return body;
}

function usageLogs(body: { data?: unknown }): ProviderUsageLog[] {
  if (Array.isArray(body.data)) return body.data as ProviderUsageLog[];
  if (
    body.data &&
    typeof body.data === 'object' &&
    Array.isArray((body.data as { items?: unknown }).items)
  ) {
    return (body.data as { items: ProviderUsageLog[] }).items;
  }
  return [];
}

function matchProviderUsageLog(
  payload: UsageReportPayload,
  logs: ProviderUsageLog[]
): ProviderUsageLog | null {
  const model = textValue(payload.metadata.model);
  const candidates = logs.filter((log) => {
    if (model && textValue(log.model_name) !== model) return false;

    const other = objectValue(log.other);
    const cachedInputTokens = firstNonNegativeInteger(
      other.cache_tokens,
      other.cache_read_input_tokens,
      other.cached_tokens,
      nestedValue(other, 'usage', 'cache_read_input_tokens'),
      nestedValue(other, 'usage', 'cached_tokens')
    );
    const cacheCreationInputTokens = firstNonNegativeInteger(
      other.cache_creation_tokens,
      other.cache_creation_input_tokens,
      nestedValue(other, 'usage', 'cache_creation_input_tokens')
    );
    const promptTokens = nonNegativeInteger(log.prompt_tokens);
    const promptMatches =
      promptTokens === payload.inputTokens ||
      promptTokens === payload.inputTokens + payload.cachedInputTokens;

    return (
      promptMatches &&
      nonNegativeInteger(log.completion_tokens) === payload.outputTokens &&
      cachedInputTokens === payload.cachedInputTokens &&
      cacheCreationInputTokens === payload.cacheCreationInputTokens
    );
  });

  if (candidates.length === 1) return candidates[0];
  if (candidates.length === 0) return null;

  const expectedAt = expectedProviderTimestamp(payload);
  if (!expectedAt) return null;
  const closeCandidates = candidates.filter(
    (log) => Math.abs(nonNegativeInteger(log.created_at) - expectedAt) <= 30
  );
  return closeCandidates.length === 1 ? closeCandidates[0] : null;
}

function expectedProviderTimestamp(payload: UsageReportPayload) {
  const observedAt = nonNegativeInteger(payload.metadata.observedAtUnix);
  if (observedAt) return observedAt;

  const match = payload.requestId.match(/^(\d{14})/);
  if (!match) return 0;
  const value = match[1];
  const timestamp = Date.UTC(
    Number(value.slice(0, 4)),
    Number(value.slice(4, 6)) - 1,
    Number(value.slice(6, 8)),
    Number(value.slice(8, 10)),
    Number(value.slice(10, 12)),
    Number(value.slice(12, 14))
  );
  return Number.isFinite(timestamp) ? Math.floor(timestamp / 1000) : 0;
}

function mergeProviderUsage(
  payload: UsageReportPayload,
  log: ProviderUsageLog
): UsageReportPayload {
  const providerRequestId = textValue(log.request_id);
  const providerUpstreamRequestId = textValue(log.upstream_request_id);
  const providerQuota = nonNegativeInteger(log.quota);
  const providerGroup = textValue(log.group);
  const other = objectValue(log.other);
  const providerGroupRatio = nonNegativeNumber(
    other.user_group_ratio ?? other.group_ratio
  );
  const providerModelRatio = nonNegativeNumber(other.model_ratio);
  const providerLog = {
    requestId: providerRequestId,
    upstreamRequestId: providerUpstreamRequestId,
    quota: providerQuota,
    group: providerGroup,
    groupRatio: providerGroupRatio,
    modelRatio: providerModelRatio,
    model: textValue(log.model_name),
    createdAt: nonNegativeInteger(log.created_at),
  };

  return {
    ...payload,
    costSource: 'provider_log',
    providerRequestId,
    providerQuota,
    providerGroup,
    providerGroupRatio,
    rawUsage: mergeObject(payload.rawUsage, { provider: providerLog }),
    metadata: {
      ...payload.metadata,
      costSource: 'provider_log',
      providerRequestId,
      providerUpstreamRequestId,
      providerQuota,
      providerGroup,
      providerGroupRatio,
      providerModelRatio,
      providerLogCreatedAt: providerLog.createdAt,
    },
  };
}

function apiKeyForEndpoint(env: ProviderUsageEnv, endpoint: string) {
  const openAiEndpoint =
    endpoint === '/v1/responses' ||
    endpoint === '/v1/chat/completions' ||
    endpoint.startsWith('/v1/responses/');
  return openAiEndpoint
    ? env.OPENAI_API_KEY || env.ANTHROPIC_API_KEY || ''
    : env.ANTHROPIC_API_KEY || env.OPENAI_API_KEY || '';
}

function objectValue(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== 'string' || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function nestedValue(
  value: Record<string, unknown>,
  objectKey: string,
  valueKey: string
) {
  const nested = objectValue(value[objectKey]);
  return nested[valueKey];
}

function mergeObject(value: unknown, extra: Record<string, unknown>) {
  return { ...objectValue(value), ...extra };
}

function textValue(value: unknown) {
  return typeof value === 'string' ? value.trim().slice(0, 255) : '';
}

function nonNegativeInteger(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
}

function firstNonNegativeInteger(...values: unknown[]) {
  for (const value of values) {
    if (value === undefined || value === null || value === '') continue;
    return nonNegativeInteger(value);
  }
  return 0;
}

function nonNegativeNumber(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function sleep(delayMs: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, delayMs));
}
