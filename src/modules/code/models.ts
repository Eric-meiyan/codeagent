import { and, asc, count, desc, eq, like, or, type SQL } from 'drizzle-orm';

import { db } from '@/core/db';
import {
  codeModel,
  type CodeModel,
  type NewCodeModel,
} from '@/config/db/schema';
import { getUuid } from '@/lib/hash';

import {
  CODE_SESSION_AGENTS,
  normalizeAgent,
  type CodeSessionAgent,
} from './runtime';

export interface CodeModelView {
  id: string;
  agent: CodeSessionAgent;
  provider: string;
  model: string;
  label: string;
  baseUrl: string;
  description: string;
  inputTokenCostCreditsPer1m: number;
  outputTokenCostCreditsPer1m: number;
  cacheCreationInputTokenCostCreditsPer1m: number;
  cachedInputTokenCostCreditsPer1m: number;
  billingMultiplier: number;
  enabled: boolean;
  isDefault: boolean;
  sort: number;
  createdAt: string;
  updatedAt: string;
}

export interface CodeModelListResult {
  items: CodeModelView[];
  total: number;
}

export function hasConfiguredModelTokenCosts(
  model: Pick<
    CodeModelView,
    'inputTokenCostCreditsPer1m' | 'outputTokenCostCreditsPer1m'
  >
) {
  return (
    model.inputTokenCostCreditsPer1m > 0 &&
    model.outputTokenCostCreditsPer1m > 0
  );
}

export interface CodeModelInput {
  agent?: unknown;
  provider?: unknown;
  model?: unknown;
  label?: unknown;
  baseUrl?: unknown;
  description?: unknown;
  inputTokenCostCreditsPer1m?: unknown;
  outputTokenCostCreditsPer1m?: unknown;
  cacheCreationInputTokenCostCreditsPer1m?: unknown;
  cachedInputTokenCostCreditsPer1m?: unknown;
  billingMultiplier?: unknown;
  enabled?: unknown;
  isDefault?: unknown;
  sort?: unknown;
}

type NormalizedCodeModelInput = {
  agent: CodeSessionAgent;
  provider: string;
  model: string;
  label: string;
  baseUrl: string;
  description: string;
  inputTokenCostCreditsPer1m: number;
  outputTokenCostCreditsPer1m: number;
  cacheCreationInputTokenCostCreditsPer1m: number;
  cachedInputTokenCostCreditsPer1m: number;
  billingMultiplier: number;
  enabled: boolean;
  isDefault: boolean;
  sort: number;
};

function asIso(value: Date | string | number | null | undefined) {
  if (!value) return new Date().toISOString();
  if (value instanceof Date) return value.toISOString();
  return new Date(value).toISOString();
}

export function toCodeModelView(row: CodeModel): CodeModelView {
  return {
    id: row.id,
    agent: normalizeAgent(row.agent),
    provider: row.provider || 'yunwu',
    model: row.model,
    label: row.label || row.model,
    baseUrl: row.baseUrl || defaultBaseUrl(normalizeAgent(row.agent)),
    description: row.description || '',
    inputTokenCostCreditsPer1m: Number(row.inputTokenCostCreditsPer1m || 0),
    outputTokenCostCreditsPer1m: Number(row.outputTokenCostCreditsPer1m || 0),
    cacheCreationInputTokenCostCreditsPer1m: Number(
      row.cacheCreationInputTokenCostCreditsPer1m || 0
    ),
    cachedInputTokenCostCreditsPer1m: Number(
      row.cachedInputTokenCostCreditsPer1m || 0
    ),
    billingMultiplier: Number(row.billingMultiplier || 200),
    enabled: Boolean(row.enabled),
    isDefault: Boolean(row.isDefault),
    sort: Number(row.sort || 0),
    createdAt: asIso(row.createdAt),
    updatedAt: asIso(row.updatedAt),
  };
}

export async function listEnabledCodeModels(
  agent?: unknown
): Promise<CodeModelView[]> {
  const normalizedAgent =
    typeof agent === 'string' && CODE_SESSION_AGENTS.includes(agent as any)
      ? normalizeAgent(agent)
      : null;
  const where = normalizedAgent
    ? and(eq(codeModel.enabled, true), eq(codeModel.agent, normalizedAgent))
    : eq(codeModel.enabled, true);

  const rows = await db()
    .select()
    .from(codeModel)
    .where(where)
    .orderBy(
      asc(codeModel.agent),
      desc(codeModel.isDefault),
      asc(codeModel.sort)
    );

  return rows.map(toCodeModelView);
}

export async function listAdminCodeModels(params: {
  page: number;
  pageSize: number;
  search?: string | null;
}): Promise<CodeModelListResult> {
  const page = Math.max(1, params.page);
  const pageSize = Math.min(100, Math.max(1, params.pageSize));
  const offset = (page - 1) * pageSize;

  const conditions: SQL[] = [];
  if (params.search) {
    conditions.push(
      or(
        like(codeModel.model, `%${params.search}%`),
        like(codeModel.label, `%${params.search}%`),
        like(codeModel.provider, `%${params.search}%`)
      )!
    );
  }
  const where = conditions.length ? and(...conditions) : undefined;

  const [totalResult] = await db()
    .select({ value: count() })
    .from(codeModel)
    .where(where);

  const rows = await db()
    .select()
    .from(codeModel)
    .where(where)
    .orderBy(
      asc(codeModel.agent),
      desc(codeModel.isDefault),
      asc(codeModel.sort)
    )
    .limit(pageSize)
    .offset(offset);

  return { items: rows.map(toCodeModelView), total: Number(totalResult.value) };
}

export async function getEnabledCodeModel(
  agent: unknown,
  model?: unknown
): Promise<CodeModelView> {
  const normalizedAgent = normalizeAgent(agent);
  const requestedModel = textValue(model);
  const where = requestedModel
    ? and(
        eq(codeModel.agent, normalizedAgent),
        eq(codeModel.model, requestedModel),
        eq(codeModel.enabled, true)
      )
    : and(eq(codeModel.agent, normalizedAgent), eq(codeModel.enabled, true));

  const rows = await db()
    .select()
    .from(codeModel)
    .where(where)
    .orderBy(desc(codeModel.isDefault), asc(codeModel.sort))
    .limit(1);

  const row = rows[0];
  if (!row) {
    throw new Error(
      requestedModel
        ? 'Selected model is not available'
        : 'No enabled model for this agent'
    );
  }

  return toCodeModelView(row);
}

export async function getCodeModelForBilling(agent: unknown, model: unknown) {
  const normalizedAgent = normalizeAgent(agent);
  const modelId = textValue(model);
  if (!modelId) return null;

  const [row] = await db()
    .select()
    .from(codeModel)
    .where(
      and(eq(codeModel.agent, normalizedAgent), eq(codeModel.model, modelId))
    )
    .limit(1);

  return row ? toCodeModelView(row) : null;
}

export async function createCodeModel(input: CodeModelInput) {
  const values = normalizeInput(input, true);
  await ensureNoDuplicate(values.agent, values.model);

  if (values.isDefault) {
    await unsetDefault(values.agent);
  }

  const now = new Date();
  const row: NewCodeModel = {
    id: getUuid(),
    ...values,
    createdAt: now,
    updatedAt: now,
  };

  await db().insert(codeModel).values(row);
  return getCodeModel(row.id);
}

export async function updateCodeModel(id: string, input: CodeModelInput) {
  const existing = await getCodeModelRow(id);
  if (!existing) throw new Error('Model not found');

  const values = normalizeInput(
    {
      agent: input.agent ?? existing.agent,
      provider: input.provider ?? existing.provider,
      model: input.model ?? existing.model,
      label: input.label ?? existing.label,
      baseUrl: input.baseUrl ?? existing.baseUrl,
      description: input.description ?? existing.description,
      inputTokenCostCreditsPer1m:
        input.inputTokenCostCreditsPer1m ?? existing.inputTokenCostCreditsPer1m,
      outputTokenCostCreditsPer1m:
        input.outputTokenCostCreditsPer1m ??
        existing.outputTokenCostCreditsPer1m,
      cacheCreationInputTokenCostCreditsPer1m:
        input.cacheCreationInputTokenCostCreditsPer1m ??
        existing.cacheCreationInputTokenCostCreditsPer1m,
      cachedInputTokenCostCreditsPer1m:
        input.cachedInputTokenCostCreditsPer1m ??
        existing.cachedInputTokenCostCreditsPer1m,
      billingMultiplier: input.billingMultiplier ?? existing.billingMultiplier,
      enabled: input.enabled ?? existing.enabled,
      isDefault: input.isDefault ?? existing.isDefault,
      sort: input.sort ?? existing.sort,
    },
    true
  );

  await ensureNoDuplicate(values.agent, values.model, id);
  if (values.isDefault) {
    await unsetDefault(values.agent, id);
  }

  await db()
    .update(codeModel)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(codeModel.id, id));

  return getCodeModel(id);
}

export async function deleteCodeModel(id: string) {
  await db().delete(codeModel).where(eq(codeModel.id, id));
}

async function getCodeModel(id: string) {
  const row = await getCodeModelRow(id);
  if (!row) throw new Error('Model not found');
  return toCodeModelView(row);
}

async function getCodeModelRow(id: string) {
  const [row] = await db()
    .select()
    .from(codeModel)
    .where(eq(codeModel.id, id))
    .limit(1);
  return row;
}

async function ensureNoDuplicate(
  agent: CodeSessionAgent,
  model: string,
  ignoreId?: string
) {
  const rows = await db()
    .select({ id: codeModel.id })
    .from(codeModel)
    .where(and(eq(codeModel.agent, agent), eq(codeModel.model, model)))
    .limit(2);
  const duplicate = (rows as Array<{ id: string }>).find(
    (row) => row.id !== ignoreId
  );
  if (duplicate) throw new Error('Model already exists for this agent');
}

async function unsetDefault(agent: CodeSessionAgent, ignoreId?: string) {
  const rows = await db()
    .select({ id: codeModel.id })
    .from(codeModel)
    .where(and(eq(codeModel.agent, agent), eq(codeModel.isDefault, true)));

  const ids = (rows as Array<{ id: string }>)
    .map((row) => row.id)
    .filter((id: string) => id !== ignoreId);
  await Promise.all(
    ids.map((id: string) =>
      db()
        .update(codeModel)
        .set({ isDefault: false })
        .where(eq(codeModel.id, id))
    )
  );
}

function normalizeInput(
  input: CodeModelInput,
  requireModel: boolean
): NormalizedCodeModelInput {
  const agent = normalizeAgent(input.agent);
  const model = textValue(input.model);
  if (requireModel && !model) throw new Error('Model is required');

  const values = {
    agent,
    provider: textValue(input.provider) || 'yunwu',
    model,
    label: textValue(input.label) || model,
    baseUrl: textValue(input.baseUrl) || defaultBaseUrl(agent),
    description: textValue(input.description),
    inputTokenCostCreditsPer1m: nonNegativeNumberValue(
      input.inputTokenCostCreditsPer1m
    ),
    outputTokenCostCreditsPer1m: nonNegativeNumberValue(
      input.outputTokenCostCreditsPer1m
    ),
    cacheCreationInputTokenCostCreditsPer1m: nonNegativeNumberValue(
      input.cacheCreationInputTokenCostCreditsPer1m
    ),
    cachedInputTokenCostCreditsPer1m: nonNegativeNumberValue(
      input.cachedInputTokenCostCreditsPer1m
    ),
    billingMultiplier: positiveNumberValue(input.billingMultiplier, 200),
    enabled: input.enabled !== false,
    isDefault: input.isDefault === true,
    sort: numberValue(input.sort),
  };

  if (values.enabled && !hasConfiguredModelTokenCosts(values)) {
    throw new Error(
      'Enabled models require input and output token costs greater than 0'
    );
  }

  return values;
}

function textValue(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function numberValue(value: unknown) {
  const parsed =
    typeof value === 'number'
      ? value
      : Number.parseInt(typeof value === 'string' ? value : '0', 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nonNegativeNumberValue(value: unknown) {
  const parsed =
    typeof value === 'number'
      ? value
      : Number.parseInt(typeof value === 'string' ? value : '0', 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

function positiveNumberValue(value: unknown, fallback: number) {
  const parsed =
    typeof value === 'number'
      ? value
      : Number.parseInt(typeof value === 'string' ? value : '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function defaultBaseUrl(agent: CodeSessionAgent) {
  return agent === 'codex' ? 'https://yunwu.ai/v1' : 'https://yunwu.ai';
}
