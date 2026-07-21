import assert from 'node:assert/strict';

import type { UsageReportPayload } from './billing-outbox';
import { resolveProviderUsageReport } from './provider-usage';

const payload: UsageReportPayload = {
  eventType: 'model_tokens',
  idempotencyKey: 'model:s-1:usage-1',
  provider: 'yunwu.ai',
  endpoint: '/v1/messages',
  upstreamStatus: 200,
  requestId: 'yunwu-request-1',
  inputTokens: 2,
  outputTokens: 134,
  cacheCreationInputTokens: 36_998,
  cachedInputTokens: 0,
  rawUsage: { aggregate: { inputTokens: 2 } },
  metadata: { source: 'test' },
};

{
  let requestedUrl = '';
  let authorization = '';
  const resolved = await resolveProviderUsageReport(
    {
      ANTHROPIC_API_BASE_URL: 'https://yunwu.ai/v1',
      ANTHROPIC_API_KEY: 'test-key',
    },
    payload,
    {
      fetchFn: async (input, init) => {
        requestedUrl = String(input);
        authorization = new Headers(init?.headers).get('authorization') || '';
        return new Response(
          JSON.stringify({
            success: true,
            data: [
              {
                request_id: 'other-request',
                quota: 1,
              },
              {
                request_id: 'yunwu-request-1',
                quota: 168_910,
                group: 'Claude Code专属',
                model_name: 'claude-sonnet-4-5-20250929',
                created_at: 1_774_000_000,
                other: JSON.stringify({
                  model_ratio: 1.5,
                  group_ratio: 2.4,
                }),
              },
            ],
          }),
          { headers: { 'content-type': 'application/json' } }
        );
      },
    }
  );

  assert.equal(requestedUrl, 'https://yunwu.ai/api/log/token');
  assert.equal(authorization, 'Bearer test-key');
  assert.equal(resolved?.costSource, 'provider_log');
  assert.equal(resolved?.providerRequestId, 'yunwu-request-1');
  assert.equal(resolved?.providerQuota, 168_910);
  assert.equal(resolved?.providerGroup, 'Claude Code专属');
  assert.equal(resolved?.providerGroupRatio, 2.4);
  assert.equal(resolved?.metadata.providerModelRatio, 1.5);
}

{
  let calls = 0;
  const resolved = await resolveProviderUsageReport(
    {
      ANTHROPIC_API_BASE_URL: 'https://yunwu.ai',
      ANTHROPIC_API_KEY: 'test-key',
    },
    payload,
    {
      attempts: 2,
      sleepFn: async () => undefined,
      fetchFn: async () => {
        calls += 1;
        return new Response(JSON.stringify({ success: true, data: [] }));
      },
    }
  );
  assert.equal(resolved, null);
  assert.equal(calls, 2);
}

{
  let requestedUrl = '';
  let authorization = '';
  let userId = '';
  const resolved = await resolveProviderUsageReport(
    {
      ANTHROPIC_API_BASE_URL: 'https://yunwu.ai/v1',
      ANTHROPIC_API_KEY: 'model-key',
      YUNWU_SYSTEM_ACCESS_TOKEN: 'system-token',
      YUNWU_USER_ID: '179285',
    },
    payload,
    {
      fetchFn: async (input, init) => {
        requestedUrl = String(input);
        const headers = new Headers(init?.headers);
        authorization = headers.get('authorization') || '';
        userId = headers.get('new-api-user') || '';
        return new Response(
          JSON.stringify({
            success: true,
            data: {
              items: [
                {
                  request_id: 'yunwu-request-1',
                  quota: 168_910,
                  group: 'Claude Code专属',
                  other: { group_ratio: 2.4 },
                },
              ],
            },
          })
        );
      },
    }
  );

  assert.equal(
    requestedUrl,
    'https://yunwu.ai/api/log/self?request_id=yunwu-request-1&page=1&page_size=20'
  );
  assert.equal(authorization, 'Bearer system-token');
  assert.equal(userId, '179285');
  assert.equal(resolved?.providerQuota, 168_910);
}

{
  const requestedUrls: string[] = [];
  const resolved = await resolveProviderUsageReport(
    {
      ANTHROPIC_API_BASE_URL: 'https://yunwu.ai',
      ANTHROPIC_API_KEY: 'model-key',
      YUNWU_SYSTEM_ACCESS_TOKEN: 'system-token',
      YUNWU_USER_ID: '179285',
    },
    payload,
    {
      fetchFn: async (input) => {
        requestedUrls.push(String(input));
        if (requestedUrls.length === 1) {
          return new Response(JSON.stringify({ success: true, data: [] }));
        }
        return new Response(
          JSON.stringify({
            success: true,
            data: [
              {
                request_id: 'provider-log-request-1',
                upstream_request_id: 'yunwu-request-1',
                quota: 33_716,
                group: 'default',
              },
            ],
          })
        );
      },
    }
  );

  assert.equal(requestedUrls.length, 2);
  assert.equal(
    requestedUrls[1],
    'https://yunwu.ai/api/log/self?page=1&page_size=20&upstream_request_id=yunwu-request-1'
  );
  assert.equal(resolved?.providerRequestId, 'provider-log-request-1');
  assert.equal(resolved?.metadata.providerUpstreamRequestId, 'yunwu-request-1');
  assert.equal(resolved?.providerQuota, 33_716);
}

{
  const resolved = await resolveProviderUsageReport(
    {
      ANTHROPIC_API_BASE_URL: 'https://yunwu.ai',
      OPENAI_API_KEY: 'codex-key',
    },
    { ...payload, endpoint: '/v1/responses', requestId: 'zero-cost' },
    {
      fetchFn: async () =>
        new Response(
          JSON.stringify({
            success: true,
            data: [{ request_id: 'zero-cost', quota: 0, group: 'default' }],
          })
        ),
    }
  );
  assert.equal(resolved?.providerQuota, 0);
  assert.equal(resolved?.costSource, 'provider_log');
}

{
  await assert.rejects(
    resolveProviderUsageReport(
      {
        ANTHROPIC_API_BASE_URL: 'https://yunwu.ai',
        ANTHROPIC_API_KEY: 'test-key',
      },
      payload,
      {
        fetchFn: async () =>
          new Response(
            JSON.stringify({ success: false, message: 'token not allowed' })
          ),
      }
    ),
    /Provider usage lookup rejected: token not allowed/
  );
}

{
  const requestedUrls: string[] = [];
  const resolved = await resolveProviderUsageReport(
    {
      ANTHROPIC_API_BASE_URL: 'https://yunwu.ai/v1',
      ANTHROPIC_API_KEY: 'model-key',
      YUNWU_SYSTEM_ACCESS_TOKEN: 'system-token',
      YUNWU_USER_ID: '179285',
    },
    {
      ...payload,
      metadata: {
        model: 'claude-sonnet-4-5-20250929',
        observedAtUnix: 1_774_000_000,
      },
    },
    {
      fetchFn: async (input) => {
        requestedUrls.push(String(input));
        if (requestedUrls.length < 3) {
          return new Response(JSON.stringify({ success: true, data: [] }));
        }
        return new Response(
          JSON.stringify({
            success: true,
            data: {
              items: [
                {
                  request_id: 'provider-internal-request',
                  upstream_request_id: 'different-upstream-request',
                  quota: 168_910,
                  group: 'default',
                  model_name: 'claude-sonnet-4-5-20250929',
                  created_at: 1_774_000_002,
                  prompt_tokens: 2,
                  completion_tokens: 134,
                  other: JSON.stringify({
                    cache_tokens: 0,
                    cache_creation_tokens: 36_998,
                  }),
                },
              ],
            },
          })
        );
      },
    }
  );

  assert.equal(requestedUrls.length, 3);
  const recentUrl = new URL(requestedUrls[2]);
  assert.equal(recentUrl.pathname, '/api/log/self');
  assert.equal(recentUrl.searchParams.get('type'), '2');
  assert.equal(recentUrl.searchParams.get('start_timestamp'), '1773999400');
  assert.equal(recentUrl.searchParams.get('end_timestamp'), '1774000600');
  assert.equal(
    recentUrl.searchParams.get('model_name'),
    'claude-sonnet-4-5-20250929'
  );
  assert.equal(resolved?.providerRequestId, 'provider-internal-request');
  assert.equal(resolved?.providerQuota, 168_910);
}

{
  const duplicate = {
    quota: 10,
    model_name: 'claude-sonnet-4-5-20250929',
    prompt_tokens: 2,
    completion_tokens: 134,
    other: {
      cache_tokens: 0,
      cache_creation_tokens: 36_998,
    },
  };
  const resolved = await resolveProviderUsageReport(
    {
      ANTHROPIC_API_BASE_URL: 'https://yunwu.ai',
      ANTHROPIC_API_KEY: 'model-key',
      YUNWU_SYSTEM_ACCESS_TOKEN: 'system-token',
      YUNWU_USER_ID: '179285',
    },
    {
      ...payload,
      metadata: {
        model: 'claude-sonnet-4-5-20250929',
        observedAtUnix: 1_774_000_000,
      },
    },
    {
      fetchFn: async (input) => {
        const url = new URL(String(input));
        if (!url.searchParams.has('start_timestamp')) {
          return new Response(JSON.stringify({ success: true, data: [] }));
        }
        return new Response(
          JSON.stringify({
            success: true,
            data: {
              items: [
                {
                  ...duplicate,
                  request_id: 'ambiguous-1',
                  created_at: 1_774_000_001,
                },
                {
                  ...duplicate,
                  request_id: 'ambiguous-2',
                  created_at: 1_774_000_005,
                },
              ],
            },
          })
        );
      },
    }
  );

  assert.equal(resolved, null);
}

console.log('provider-usage.test.ts OK');
