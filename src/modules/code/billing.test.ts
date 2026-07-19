import assert from 'node:assert/strict';

import {
  calculateMeteredDuration,
  calculateModelTokenCharge,
  calculateRuntimeCharge,
} from './billing';

assert.deepEqual(
  calculateModelTokenCharge({
    inputTokens: 100_000,
    outputTokens: 0,
    cachedInputTokens: 0,
    inputTokenCostCreditsPer1m: 1000,
    outputTokenCostCreditsPer1m: 3000,
    cachedInputTokenCostCreditsPer1m: 100,
    billingMultiplier: 200,
  }),
  { rawCostCredits: 100, chargedCredits: 200 }
);

assert.deepEqual(
  calculateRuntimeCharge({
    durationSeconds: 70,
    runtimeState: 'active',
    idleCreditsPerMinute: 1,
    activeCreditsPerMinute: 2,
    highLoadCreditsPerMinute: 5,
  }),
  { chargedMinutes: 2, chargedCredits: 4 }
);

assert.deepEqual(
  calculateMeteredDuration({
    chargeStart: new Date('2026-07-19T00:00:00.000Z'),
    endedAt: new Date('2026-07-19T00:10:00.000Z'),
    maxDurationSeconds: 120,
  }),
  {
    durationSeconds: 120,
    pendingDurationSeconds: 480,
    billedThrough: new Date('2026-07-19T00:02:00.000Z'),
  }
);

assert.deepEqual(
  calculateMeteredDuration({
    chargeStart: new Date('2026-07-19T00:00:00.000Z'),
    endedAt: new Date('2026-07-19T00:01:01.000Z'),
    maxDurationSeconds: 120,
    wholeMinutesOnly: true,
  }),
  {
    durationSeconds: 60,
    pendingDurationSeconds: 1,
    billedThrough: new Date('2026-07-19T00:01:00.000Z'),
  }
);

assert.deepEqual(
  calculateMeteredDuration({
    chargeStart: new Date('2026-07-19T00:01:00.000Z'),
    endedAt: new Date('2026-07-19T00:00:00.000Z'),
    maxDurationSeconds: 120,
  }),
  {
    durationSeconds: 0,
    pendingDurationSeconds: 0,
    billedThrough: new Date('2026-07-19T00:01:00.000Z'),
  }
);

console.log('billing.test.ts OK');
