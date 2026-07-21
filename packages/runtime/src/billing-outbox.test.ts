import assert from 'node:assert/strict';

import {
  deliverOrQueueUsageReport,
  flushPendingUsageReports,
  queueUsageReport,
  type BillingOutboxBucket,
  type UsageReportPayload,
} from './billing-outbox';

class MemoryBucket implements BillingOutboxBucket {
  readonly objects = new Map<string, string>();

  async put(key: string, value: string) {
    this.objects.set(key, value);
  }

  async get(key: string) {
    const value = this.objects.get(key);
    return value === undefined
      ? null
      : {
          async text() {
            return value;
          },
        };
  }

  async delete(key: string) {
    this.objects.delete(key);
  }

  async list(options: { prefix: string; limit: number }) {
    return {
      objects: [...this.objects.keys()]
        .filter((key) => key.startsWith(options.prefix))
        .sort()
        .slice(0, options.limit)
        .map((key) => ({ key })),
    };
  }
}

const payload: UsageReportPayload = {
  eventType: 'model_tokens',
  idempotencyKey: 'model:s-1:request-1',
  provider: 'example.test',
  endpoint: '/v1/messages',
  upstreamStatus: 200,
  requestId: 'request-1',
  inputTokens: 120,
  outputTokens: 30,
  cacheCreationInputTokens: 5,
  cachedInputTokens: 10,
  rawUsage: { input_tokens: 120, output_tokens: 30 },
  metadata: { source: 'test' },
};

function env(bucket: MemoryBucket) {
  return {
    WORKSPACE_ARCHIVES: bucket,
    APP_BASE_URL: 'https://hicode.run',
    BILLING_USAGE_WEBHOOK_SECRET: 'test-secret',
  };
}

function jsonResponse(code: number, status = 200) {
  return new Response(JSON.stringify({ code }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

{
  const bucket = new MemoryBucket();
  await queueUsageReport(env(bucket), 's-1', payload, {
    now: new Date('2026-07-21T00:00:00.000Z'),
    lastError: 'provider usage pending',
  });

  let prepared = false;
  const result = await flushPendingUsageReports(env(bucket), {
    fetchFn: async () => jsonResponse(0),
    preparePayload: async (value) => {
      prepared = true;
      return {
        ...value,
        costSource: 'provider_log',
        providerRequestId: value.requestId,
        providerQuota: 168_910,
      };
    },
    now: new Date('2026-07-21T00:00:31.000Z'),
  });

  assert.equal(prepared, true);
  assert.deepEqual(result, {
    scanned: 1,
    delivered: 1,
    deferred: 0,
    failed: 0,
    invalid: 0,
  });
  assert.equal(bucket.objects.size, 0);
}

{
  const bucket = new MemoryBucket();
  await bucket.put(
    'billing-usage-pending/s-1/legacy-backoff.json',
    JSON.stringify({
      version: 1,
      sessionId: 's-1',
      payload,
      attempts: 10,
      createdAt: '2026-07-21T00:00:00.000Z',
      updatedAt: '2026-07-21T00:00:00.000Z',
      nextAttemptAt: '2026-07-21T06:00:00.000Z',
      lastError: 'provider usage pending',
    })
  );

  const result = await flushPendingUsageReports(env(bucket), {
    fetchFn: async () => jsonResponse(0),
    preparePayload: async (value) => ({
      ...value,
      costSource: 'provider_log',
      providerRequestId: 'provider-request-1',
      providerQuota: 10,
    }),
    now: new Date('2026-07-21T00:05:01.000Z'),
  });

  assert.equal(result.delivered, 1);
  assert.equal(result.deferred, 0);
  assert.equal(bucket.objects.size, 0);
}

{
  const bucket = new MemoryBucket();
  let calls = 0;
  const result = await deliverOrQueueUsageReport(env(bucket), 's-1', payload, {
    fetchFn: async () => {
      calls += 1;
      return jsonResponse(0);
    },
    sleepFn: async () => undefined,
  });

  assert.deepEqual(result, { delivered: true, queued: false });
  assert.equal(calls, 1);
  assert.equal(bucket.objects.size, 0);
}

{
  const bucket = new MemoryBucket();
  const queuedAt = new Date('2026-07-21T00:00:00.000Z');
  let calls = 0;
  const result = await deliverOrQueueUsageReport(env(bucket), 's-1', payload, {
    fetchFn: async () => {
      calls += 1;
      return jsonResponse(-1);
    },
    now: queuedAt,
    sleepFn: async () => undefined,
  });

  assert.deepEqual(result, { delivered: false, queued: true });
  assert.equal(calls, 2);
  assert.equal(bucket.objects.size, 1);

  const deferred = await flushPendingUsageReports(env(bucket), {
    fetchFn: async () => jsonResponse(0),
    now: new Date('2026-07-21T00:01:00.000Z'),
  });
  assert.deepEqual(deferred, {
    scanned: 1,
    delivered: 0,
    deferred: 1,
    failed: 0,
    invalid: 0,
  });

  const flushed = await flushPendingUsageReports(env(bucket), {
    fetchFn: async () => jsonResponse(0),
    now: new Date('2026-07-21T00:02:01.000Z'),
  });
  assert.deepEqual(flushed, {
    scanned: 1,
    delivered: 1,
    deferred: 0,
    failed: 0,
    invalid: 0,
  });
  assert.equal(bucket.objects.size, 0);
}

{
  const bucket = new MemoryBucket();
  await deliverOrQueueUsageReport(env(bucket), 's-1', payload, {
    fetchFn: async () => {
      throw new Error('network unavailable');
    },
    now: new Date('2026-07-21T00:00:00.000Z'),
    sleepFn: async () => undefined,
  });

  const failed = await flushPendingUsageReports(env(bucket), {
    fetchFn: async () => {
      throw new Error('still unavailable');
    },
    now: new Date('2026-07-21T00:02:01.000Z'),
  });
  assert.equal(failed.failed, 1);
  assert.deepEqual(failed.errors, ['still unavailable']);
  assert.equal(bucket.objects.size, 1);
  const stored = JSON.parse([...bucket.objects.values()][0]) as {
    attempts: number;
    lastError: string;
  };
  assert.equal(stored.attempts, 3);
  assert.equal(stored.lastError, 'still unavailable');
}

{
  const bucket = new MemoryBucket();
  await bucket.put('billing-usage-pending/broken.json', 'not-json');
  const result = await flushPendingUsageReports(env(bucket), {
    fetchFn: async () => jsonResponse(0),
    now: new Date('2026-07-21T00:00:00.000Z'),
  });

  assert.equal(result.invalid, 1);
  assert.equal(
    [...bucket.objects.keys()].some((key) =>
      key.startsWith('billing-usage-invalid/')
    ),
    true
  );
  assert.equal(
    [...bucket.objects.keys()].some((key) =>
      key.startsWith('billing-usage-pending/')
    ),
    false
  );
}

console.log('billing-outbox.test.ts OK');
