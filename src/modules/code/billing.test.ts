import assert from 'node:assert/strict';

import {
  billingSettlementClaimStatus,
  calculateAccumulatedModelTokenCharge,
  calculateMeteredDuration,
  calculateModelTokenCharge,
  calculateModelTokenChargeUnits,
  calculateProviderQuotaCharge,
  calculateProviderQuotaChargeUnits,
  calculateRuntimeCharge,
} from './billing';

assert.equal(
  billingSettlementClaimStatus('019f3fef-7a73-7c12-a91d-1f87b503e79d'),
  'settling:019f3fef7a737c12a91d1f8'
);
assert.equal(
  billingSettlementClaimStatus('019f3fef-7a73-7c12-a91d-1f87b503e79d').length,
  32
);

assert.deepEqual(
  calculateModelTokenCharge({
    inputTokens: 100_000,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cachedInputTokens: 0,
    inputTokenCostCreditsPer1m: 1000,
    outputTokenCostCreditsPer1m: 3000,
    cacheCreationInputTokenCostCreditsPer1m: 125,
    cachedInputTokenCostCreditsPer1m: 100,
    billingMultiplier: 200,
  }),
  { rawCostCredits: 100, chargedCredits: 200 }
);

assert.deepEqual(
  calculateModelTokenCharge({
    inputTokens: 1,
    outputTokens: 13,
    cacheCreationInputTokens: 873,
    cachedInputTokens: 3718,
    inputTokenCostCreditsPer1m: 150,
    outputTokenCostCreditsPer1m: 750,
    cacheCreationInputTokenCostCreditsPer1m: 187.5,
    cachedInputTokenCostCreditsPer1m: 15,
    billingMultiplier: 200,
  }),
  { rawCostCredits: 1, chargedCredits: 1 }
);

assert.equal(
  calculateModelTokenChargeUnits({
    inputTokens: 1,
    outputTokens: 15,
    cacheCreationInputTokens: 870,
    cachedInputTokens: 3707,
    inputTokenCostCreditsPer1m: 150,
    outputTokenCostCreditsPer1m: 750,
    cacheCreationInputTokenCostCreditsPer1m: 187.5,
    cachedInputTokenCostCreditsPer1m: 15,
    billingMultiplier: 200,
  }),
  46_026_000
);

assert.equal(
  calculateModelTokenChargeUnits({
    inputTokens: 6268,
    outputTokens: 28,
    cacheCreationInputTokens: 0,
    cachedInputTokens: 0,
    inputTokenCostCreditsPer1m: 62.5,
    outputTokenCostCreditsPer1m: 500,
    cacheCreationInputTokenCostCreditsPer1m: 0,
    cachedInputTokenCostCreditsPer1m: 6.25,
    billingMultiplier: 200,
  }),
  81_150_000
);

assert.deepEqual(
  calculateProviderQuotaCharge({
    providerQuota: 168_910,
    providerQuotaPerCny: 1_000_000,
    creditsPerCny: 100,
    billingMultiplier: 200,
  }),
  { rawCostCredits: 17, chargedCredits: 34 }
);

assert.equal(
  calculateProviderQuotaChargeUnits({
    providerQuota: 168_910,
    providerQuotaPerCny: 1_000_000,
    creditsPerCny: 100,
    billingMultiplier: 200,
  }),
  3_378_200_000
);

assert.deepEqual(
  calculateAccumulatedModelTokenCharge({
    remainderUnits: 0,
    chargeUnits: 3_378_200_000,
  }),
  { chargedCredits: 33, remainderUnits: 78_200_000 }
);

const firstTinyClaudeCharge = calculateAccumulatedModelTokenCharge({
  remainderUnits: 0,
  chargeUnits: 46_026_000,
});
assert.deepEqual(firstTinyClaudeCharge, {
  chargedCredits: 0,
  remainderUnits: 46_026_000,
});
assert.deepEqual(
  calculateAccumulatedModelTokenCharge({
    remainderUnits: firstTinyClaudeCharge.remainderUnits,
    chargeUnits: 350_269_500,
  }),
  { chargedCredits: 3, remainderUnits: 96_295_500 }
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
