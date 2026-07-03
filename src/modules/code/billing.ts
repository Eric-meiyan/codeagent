import { and, desc, eq, sql } from 'drizzle-orm';

import { db } from '@/core/db';
import {
  codeBillingEvent,
  codeModel,
  codeSession,
  type CodeModel,
  type CodeSession,
  type NewCodeBillingEvent,
} from '@/config/db/schema';
import { getAllConfigs } from '@/modules/config/service';
import { consume, CreditTransactionScene } from '@/modules/credits/service';
import { getUuid } from '@/lib/hash';

import { normalizeAgent } from './runtime';

const ONE_MILLION = 1_000_000;

export type CodeBillingEventType = 'model_tokens' | 'runtime_minutes';
export type RuntimeBillingState = 'idle' | 'active' | 'high_load';

export interface CodeBillingSettings {
  enabled: boolean;
  creditsPerCny: number;
  defaultMultiplier: number;
  freeMinutesPerSession: number;
  idleCreditsPerMinute: number;
  activeCreditsPerMinute: number;
  highLoadCreditsPerMinute: number;
  sessionCreateMinBalanceCredits: number;
  idleTimeoutMinutes: number;
  maxSessionMinutes: number;
  storageFreeGb: number;
  storageCreditsPerGbDay: number;
  dailyFreeNetworkGb: number;
  networkCreditsPerGb: number;
}

export interface ModelTokenUsageInput {
  userId: string;
  sessionId: string;
  inputTokens?: unknown;
  outputTokens?: unknown;
  cachedInputTokens?: unknown;
  description?: string;
  metadata?: Record<string, unknown>;
}

export interface RuntimeUsageInput {
  userId: string;
  sessionId: string;
  runtimeState?: unknown;
  endedAt?: Date;
  description?: string;
  metadata?: Record<string, unknown>;
}

export function calculateModelTokenCharge(params: {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  inputTokenCostCreditsPer1m: number;
  outputTokenCostCreditsPer1m: number;
  cachedInputTokenCostCreditsPer1m: number;
  billingMultiplier: number;
}) {
  const inputCost =
    params.inputTokens * params.inputTokenCostCreditsPer1m +
    params.outputTokens * params.outputTokenCostCreditsPer1m +
    params.cachedInputTokens * params.cachedInputTokenCostCreditsPer1m;

  const rawCostCredits =
    inputCost <= 0 ? 0 : Math.ceil(inputCost / ONE_MILLION);
  const chargedCredits =
    inputCost <= 0
      ? 0
      : Math.ceil((inputCost * params.billingMultiplier) / (ONE_MILLION * 100));

  return { rawCostCredits, chargedCredits };
}

export function calculateRuntimeCharge(params: {
  durationSeconds: number;
  runtimeState: RuntimeBillingState;
  idleCreditsPerMinute: number;
  activeCreditsPerMinute: number;
  highLoadCreditsPerMinute: number;
}) {
  const durationSeconds = Math.max(0, Math.ceil(params.durationSeconds));
  const chargedMinutes =
    durationSeconds <= 0 ? 0 : Math.ceil(durationSeconds / 60);
  const rate =
    params.runtimeState === 'idle'
      ? params.idleCreditsPerMinute
      : params.runtimeState === 'high_load'
        ? params.highLoadCreditsPerMinute
        : params.activeCreditsPerMinute;

  return {
    chargedMinutes,
    chargedCredits: chargedMinutes * Math.max(0, rate),
  };
}

export async function getCodeBillingSettings(): Promise<CodeBillingSettings> {
  const configs = await getAllConfigs();
  return {
    enabled: boolConfig(configs.billing_enabled, true),
    creditsPerCny: numberConfig(configs.billing_credits_per_cny, 100),
    defaultMultiplier: numberConfig(configs.billing_default_multiplier, 200),
    freeMinutesPerSession: numberConfig(
      configs.billing_session_free_minutes,
      5
    ),
    idleCreditsPerMinute: numberConfig(
      configs.billing_runtime_idle_credits_per_minute,
      1
    ),
    activeCreditsPerMinute: numberConfig(
      configs.billing_runtime_active_credits_per_minute,
      2
    ),
    highLoadCreditsPerMinute: numberConfig(
      configs.billing_runtime_high_load_credits_per_minute,
      5
    ),
    sessionCreateMinBalanceCredits: numberConfig(
      configs.billing_session_min_balance_credits,
      0
    ),
    idleTimeoutMinutes: numberConfig(configs.billing_idle_timeout_minutes, 30),
    maxSessionMinutes: numberConfig(configs.billing_max_session_minutes, 240),
    storageFreeGb: numberConfig(configs.billing_storage_free_gb, 1),
    storageCreditsPerGbDay: numberConfig(
      configs.billing_storage_credits_per_gb_day,
      1
    ),
    dailyFreeNetworkGb: numberConfig(configs.billing_daily_free_network_gb, 1),
    networkCreditsPerGb: numberConfig(
      configs.billing_network_credits_per_gb,
      10
    ),
  };
}

export async function getCodeSessionById(sessionId: string) {
  const [row] = await db()
    .select()
    .from(codeSession)
    .where(eq(codeSession.id, sessionId))
    .limit(1);
  return row;
}

export async function recordModelTokenUsage(input: ModelTokenUsageInput) {
  const settings = await getCodeBillingSettings();
  const row = await getOwnedActiveOrEndedSession(input.userId, input.sessionId);
  const model = await getCodeModelRow(row.agent, row.model);
  const multiplier = positiveIntegerOrFallback(
    model?.billingMultiplier,
    settings.defaultMultiplier
  );
  const inputTokens = nonNegativeInteger(input.inputTokens);
  const outputTokens = nonNegativeInteger(input.outputTokens);
  const cachedInputTokens = nonNegativeInteger(input.cachedInputTokens);

  const { rawCostCredits, chargedCredits } = calculateModelTokenCharge({
    inputTokens,
    outputTokens,
    cachedInputTokens,
    inputTokenCostCreditsPer1m: positiveInteger(
      model?.inputTokenCostCreditsPer1m,
      0
    ),
    outputTokenCostCreditsPer1m: positiveInteger(
      model?.outputTokenCostCreditsPer1m,
      0
    ),
    cachedInputTokenCostCreditsPer1m: positiveInteger(
      model?.cachedInputTokenCostCreditsPer1m,
      0
    ),
    billingMultiplier: multiplier,
  });

  return db().transaction(async (tx: any) =>
    createBillingEvent(tx, {
      userId: input.userId,
      sessionId: row.id,
      agent: normalizeAgent(row.agent),
      model: row.model,
      eventType: 'model_tokens',
      inputTokens,
      outputTokens,
      cachedInputTokens,
      rawCostCredits,
      chargedCredits: settings.enabled ? chargedCredits : 0,
      billingMultiplier: multiplier,
      description:
        input.description ||
        `Model usage: ${row.model} (${inputTokens} input / ${outputTokens} output tokens)`,
      metadata: JSON.stringify(input.metadata || {}),
    })
  );
}

export async function settleSessionRuntimeUsage(input: RuntimeUsageInput) {
  const settings = await getCodeBillingSettings();
  const row = await getOwnedActiveOrEndedSession(input.userId, input.sessionId);
  const runtimeState = normalizeRuntimeState(input.runtimeState);
  const endedAt = input.endedAt || new Date();
  const chargeStart = runtimeChargeStart(row, settings);
  const durationSeconds =
    chargeStart && endedAt > chargeStart
      ? Math.ceil((endedAt.getTime() - chargeStart.getTime()) / 1000)
      : 0;
  const { chargedMinutes, chargedCredits } = calculateRuntimeCharge({
    durationSeconds,
    runtimeState,
    idleCreditsPerMinute: settings.idleCreditsPerMinute,
    activeCreditsPerMinute: settings.activeCreditsPerMinute,
    highLoadCreditsPerMinute: settings.highLoadCreditsPerMinute,
  });

  return db().transaction(async (tx: any) => {
    const event = await createBillingEvent(tx, {
      userId: input.userId,
      sessionId: row.id,
      agent: normalizeAgent(row.agent),
      model: row.model,
      eventType: 'runtime_minutes',
      runtimeState,
      durationSeconds,
      rawCostCredits: chargedCredits,
      chargedCredits: settings.enabled ? chargedCredits : 0,
      billingMultiplier: 100,
      description:
        input.description ||
        `Runtime usage: ${chargedMinutes} minute${chargedMinutes === 1 ? '' : 's'} (${runtimeState})`,
      metadata: JSON.stringify({
        ...(input.metadata || {}),
        chargedMinutes,
        freeMinutesPerSession: settings.freeMinutesPerSession,
      }),
    });

    await tx
      .update(codeSession)
      .set({
        lastBilledAt: endedAt,
        billedCredits: sql`${codeSession.billedCredits} + ${event.status === 'charged' ? event.chargedCredits : 0}`,
        updatedAt: endedAt,
      })
      .where(eq(codeSession.id, row.id));

    return event;
  });
}

async function createBillingEvent(
  tx: any,
  values: Omit<NewCodeBillingEvent, 'id' | 'createdAt' | 'status'> & {
    status?: string;
  }
) {
  const chargedCredits = values.chargedCredits ?? 0;
  let status = chargedCredits > 0 ? 'charged' : 'recorded';
  let creditId = values.creditId || '';

  if (chargedCredits > 0) {
    const result = await consume({
      userId: values.userId,
      credits: chargedCredits,
      scene:
        values.eventType === 'model_tokens'
          ? CreditTransactionScene.CODE_MODEL
          : CreditTransactionScene.CODE_RUNTIME,
      description: values.description,
      metadata: values.metadata,
      tx,
    });

    if (result.success) {
      creditId = result.consumedCredit?.id || '';
      status = 'charged';
    } else {
      status = 'unpaid';
    }
  }

  const event: NewCodeBillingEvent = {
    id: getUuid(),
    ...values,
    chargedCredits,
    creditId,
    status: values.status || status,
    createdAt: new Date(),
  };
  await tx.insert(codeBillingEvent).values(event);
  return event;
}

async function getOwnedActiveOrEndedSession(userId: string, sessionId: string) {
  const [row] = await db()
    .select()
    .from(codeSession)
    .where(and(eq(codeSession.userId, userId), eq(codeSession.id, sessionId)))
    .limit(1);
  if (!row) throw new Error('Session not found');
  return row;
}

async function getCodeModelRow(agent: string, model: string) {
  const [row] = await db()
    .select()
    .from(codeModel)
    .where(
      and(
        eq(codeModel.agent, normalizeAgent(agent)),
        eq(codeModel.model, model)
      )
    )
    .orderBy(desc(codeModel.updatedAt))
    .limit(1);
  return row as CodeModel | undefined;
}

function runtimeChargeStart(
  row: CodeSession,
  settings: CodeBillingSettings
): Date | null {
  const createdAt = toDate(row.createdAt);
  if (!createdAt) return null;
  const freeUntil = new Date(
    createdAt.getTime() + settings.freeMinutesPerSession * 60_000
  );
  const lastBilledAt = toDate(row.lastBilledAt) || createdAt;
  return new Date(Math.max(freeUntil.getTime(), lastBilledAt.getTime()));
}

function normalizeRuntimeState(value: unknown): RuntimeBillingState {
  return value === 'idle' || value === 'high_load' ? value : 'active';
}

function toDate(value: Date | string | number | null | undefined) {
  if (!value) return null;
  return value instanceof Date ? value : new Date(value);
}

function boolConfig(value: string | undefined, fallback: boolean) {
  if (value === undefined || value === '') return fallback;
  return value === 'true';
}

function numberConfig(value: string | undefined, fallback: number) {
  return positiveInteger(value, fallback);
}

function nonNegativeInteger(value: unknown) {
  const parsed =
    typeof value === 'number'
      ? value
      : Number.parseInt(typeof value === 'string' ? value : '0', 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

function positiveInteger(value: unknown, fallback: number) {
  const parsed =
    typeof value === 'number'
      ? value
      : Number.parseInt(typeof value === 'string' ? value : '', 10);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}

function positiveIntegerOrFallback(value: unknown, fallback: number) {
  const parsed =
    typeof value === 'number'
      ? value
      : Number.parseInt(typeof value === 'string' ? value : '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}
