import assert from 'node:assert/strict';

import { extractTokenUsage } from './token-usage';

assert.deepEqual(
  extractTokenUsage(
    JSON.stringify({
      usage: {
        input_tokens: 1,
        output_tokens: 13,
        cache_creation_input_tokens: 873,
        cache_read_input_tokens: 3718,
      },
    })
  ),
  {
    inputTokens: 1,
    outputTokens: 13,
    cacheCreationInputTokens: 873,
    cachedInputTokens: 3718,
    rawUsage: [
      {
        input_tokens: 1,
        output_tokens: 13,
        cache_creation_input_tokens: 873,
        cache_read_input_tokens: 3718,
      },
    ],
  }
);

assert.deepEqual(
  extractTokenUsage(
    JSON.stringify({
      usage: {
        input_tokens: 8294,
        output_tokens: 138,
        input_tokens_details: { cached_tokens: 7936 },
      },
    })
  ),
  {
    inputTokens: 358,
    outputTokens: 138,
    cacheCreationInputTokens: 0,
    cachedInputTokens: 7936,
    rawUsage: [
      {
        input_tokens: 8294,
        output_tokens: 138,
        input_tokens_details: { cached_tokens: 7936 },
      },
    ],
  }
);

console.log('token-usage.test.ts OK');
