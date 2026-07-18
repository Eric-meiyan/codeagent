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
  requireConfiguredModelCosts: boolean;
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
  idempotencyKey?: unknown;
  provider?: unknown;
  endpoint?: unknown;
  upstreamStatus?: unknown;
  requestId?: unknown;
  rawUsage?: unknown;
  description?: string;
  metadata?: unknown;
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
    requireConfiguredModelCosts: boolConfig(
      configs.billing_require_model_costs,
      false
    ),
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
  const idempotencyKey = optionalText(input.idempotencyKey, 255) || null;
  const provider =
    optionalText(input.provider, 255) || optionalText(model?.provider, 255);
  const endpoint = optionalText(input.endpoint, 255);
  const upstreamStatus = nonNegativeInteger(input.upstreamStatus);
  const requestId = optionalText(input.requestId, 255);
  const rawUsage = jsonText(input.rawUsage, 2048);
  const metadata = {
    ...metadataObject(input.metadata),
    sessionId: row.id,
    agent: normalizeAgent(row.agent),
    model: row.model,
    provider,
    endpoint,
    upstreamStatus,
    requestId,
    idempotencyKey,
    inputTokens,
    outputTokens,
    cachedInputTokens,
  };

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
      idempotencyKey,
      provider,
      endpoint,
      upstreamStatus,
      requestId,
      inputTokens,
      outputTokens,
      cachedInputTokens,
      rawUsage,
      rawCostCredits,
      chargedCredits: settings.enabled ? chargedCredits : 0,
      billingMultiplier: multiplier,
      description:
        input.description ||
        `Model usage: ${row.model} (${inputTokens} input / ${outputTokens} output tokens)`,
      metadata: jsonText(metadata, 4096),
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
        sessionId: row.id,
        agent: normalizeAgent(row.agent),
        model: row.model,
        runtimeState,
        durationSeconds,
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
  const metadata = values.metadata || '';

  if (values.idempotencyKey) {
    const existing = await getBillingEventByIdempotencyKey(
      tx,
      values.userId,
      values.idempotencyKey
    );
    if (existing) return existing;

    const event: NewCodeBillingEvent = {
      id: getUuid(),
      ...values,
      chargedCredits,
      creditId: values.creditId || '',
      status: values.status || (chargedCredits > 0 ? 'pending' : 'recorded'),
      metadata,
      createdAt: new Date(),
    };

    try {
      await tx.insert(codeBillingEvent).values(event);
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        const existingAfterConflict = await getBillingEventByIdempotencyKey(
          tx,
          values.userId,
          values.idempotencyKey
        );
        if (existingAfterConflict) return existingAfterConflict;
      }
      throw error;
    }

    if (chargedCredits <= 0) return event;

    const { creditId, status } = await settleEventCredits(tx, {
      ...values,
      metadata,
      chargedCredits,
    });
    await tx
      .update(codeBillingEvent)
      .set({ creditId, status })
      .where(eq(codeBillingEvent.id, event.id));

    return { ...event, creditId, status };
  }

  let status = chargedCredits > 0 ? 'charged' : 'recorded';
  let creditId = values.creditId || '';

  if (chargedCredits > 0) {
    const settled = await settleEventCredits(tx, {
      ...values,
      metadata,
      chargedCredits,
    });
    creditId = settled.creditId;
    status = settled.status;
  }

  const event: NewCodeBillingEvent = {
    id: getUuid(),
    ...values,
    chargedCredits,
    creditId,
    status: values.status || status,
    metadata,
    createdAt: new Date(),
  };
  await tx.insert(codeBillingEvent).values(event);
  return event;
}

async function settleEventCredits(
  tx: any,
  values: Omit<NewCodeBillingEvent, 'id' | 'createdAt' | 'status'> & {
    chargedCredits: number;
  }
) {
  const result = await consume({
    userId: values.userId,
    credits: values.chargedCredits,
    scene:
      values.eventType === 'model_tokens'
        ? CreditTransactionScene.CODE_MODEL
        : CreditTransactionScene.CODE_RUNTIME,
    description: values.description,
    metadata: values.metadata,
    tx,
  });

  if (result.success) {
    return {
      creditId: result.consumedCredit?.id || '',
      status: 'charged',
    };
  }

  return { creditId: '', status: 'unpaid' };
}

async function getBillingEventByIdempotencyKey(
  tx: any,
  userId: string,
  idempotencyKey: string
) {
  const [row] = await tx
    .select()
    .from(codeBillingEvent)
    .where(
      and(
        eq(codeBillingEvent.userId, userId),
        eq(codeBillingEvent.idempotencyKey, idempotencyKey)
      )
    )
    .limit(1);
  return row;
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

function optionalText(value: unknown, maxLength: number) {
  if (value === null || value === undefined) return '';
  return String(value).trim().slice(0, maxLength);
}

function metadataObject(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return metadataObject(parsed);
    } catch {
      return {};
    }
  }
  if (typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function jsonText(value: unknown, maxLength: number) {
  try {
    return JSON.stringify(value ?? {}).slice(0, maxLength);
  } catch {
    return '{}';
  }
}

function isUniqueConstraintError(error: unknown) {
  const message = String(
    (error as any)?.message || (error as any)?.cause?.message || ''
  ).toLowerCase();
  return (
    message.includes('unique') ||
    message.includes('duplicate') ||
    message.includes('constraint')
  );
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
