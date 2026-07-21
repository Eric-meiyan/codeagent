export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cachedInputTokens: number;
  rawUsage: Array<Record<string, unknown>>;
}

export function extractTokenUsage(text: string): TokenUsage {
  const usage = emptyTokenUsage();

  mergeUsage(usage, parseJsonUsage(text));
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) continue;
    const data = trimmed.slice(5).trim();
    if (!data || data === '[DONE]') continue;
    mergeUsage(usage, parseJsonUsage(data));
  }

  return usage;
}

function parseJsonUsage(text: string): TokenUsage {
  try {
    return collectUsage(JSON.parse(text));
  } catch {
    return emptyTokenUsage();
  }
}

function collectUsage(value: unknown): TokenUsage {
  const result = emptyTokenUsage();
  if (!value || typeof value !== 'object') return result;

  if (Array.isArray(value)) {
    for (const item of value) mergeUsage(result, collectUsage(item));
    return result;
  }

  const record = value as Record<string, unknown>;
  if (record.usage && typeof record.usage === 'object') {
    mergeUsage(
      result,
      usageFromObject(record.usage as Record<string, unknown>)
    );
  }
  if (record.response && typeof record.response === 'object') {
    mergeUsage(result, collectUsage(record.response));
  }
  if (record.message && typeof record.message === 'object') {
    mergeUsage(result, collectUsage(record.message));
  }

  return result;
}

function usageFromObject(usage: Record<string, unknown>): TokenUsage {
  const totalInputTokens = numberValue(
    usage.input_tokens ?? usage.prompt_tokens
  );
  const outputTokens = numberValue(
    usage.output_tokens ?? usage.completion_tokens
  );
  const details =
    typeof usage.input_tokens_details === 'object'
      ? (usage.input_tokens_details as Record<string, unknown>)
      : typeof usage.prompt_tokens_details === 'object'
        ? (usage.prompt_tokens_details as Record<string, unknown>)
        : {};
  const anthropicCacheReadTokens = numberValue(usage.cache_read_input_tokens);
  const cachedInputTokens =
    anthropicCacheReadTokens ||
    numberValue(usage.cached_input_tokens ?? details.cached_tokens);
  const cacheCreationInputTokens = numberValue(
    usage.cache_creation_input_tokens
  );

  // Anthropic reports cache reads separately from input_tokens. OpenAI includes
  // cached tokens in prompt/input_tokens and exposes the cached subset in details.
  const inputTokens = anthropicCacheReadTokens
    ? totalInputTokens
    : Math.max(0, totalInputTokens - cachedInputTokens);

  return {
    inputTokens,
    outputTokens,
    cacheCreationInputTokens,
    cachedInputTokens,
    rawUsage: [sanitizeUsageRecord(usage)],
  };
}

function mergeUsage(target: TokenUsage, next: TokenUsage) {
  target.inputTokens = Math.max(target.inputTokens, next.inputTokens);
  target.outputTokens = Math.max(target.outputTokens, next.outputTokens);
  target.cacheCreationInputTokens = Math.max(
    target.cacheCreationInputTokens,
    next.cacheCreationInputTokens
  );
  target.cachedInputTokens = Math.max(
    target.cachedInputTokens,
    next.cachedInputTokens
  );
  if (next.rawUsage.length > 0) {
    target.rawUsage.push(...next.rawUsage);
    if (target.rawUsage.length > 20) {
      target.rawUsage.splice(0, target.rawUsage.length - 20);
    }
  }
}

function numberValue(value: unknown): number {
  const parsed =
    typeof value === 'number'
      ? value
      : Number.parseInt(typeof value === 'string' ? value : '0', 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

function emptyTokenUsage(): TokenUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cachedInputTokens: 0,
    rawUsage: [],
  };
}

function sanitizeUsageRecord(
  usage: Record<string, unknown>
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of [
    'input_tokens',
    'output_tokens',
    'prompt_tokens',
    'completion_tokens',
    'cache_creation_input_tokens',
    'cache_read_input_tokens',
    'cached_input_tokens',
    'input_tokens_details',
    'prompt_tokens_details',
  ]) {
    if (usage[key] !== undefined) result[key] = usage[key];
  }
  return result;
}
