import { and, count, desc, eq, like, or, sql, type SQL } from 'drizzle-orm';

import { db } from '@/core/db';
import {
  codeBillingEvent,
  codeSession,
  codeSessionEvent,
  user,
} from '@/config/db/schema';

export interface AdminCodeSessionListInput {
  page: number;
  pageSize: number;
  search?: string | null;
  status?: string | null;
  agent?: string | null;
}

export interface AdminCodeSessionDetailInput {
  eventLimit?: number;
  billingLimit?: number;
}

export async function listAdminCodeSessions(input: AdminCodeSessionListInput) {
  const page = Math.max(1, input.page);
  const pageSize = Math.min(100, Math.max(1, input.pageSize));
  const offset = (page - 1) * pageSize;
  const where = adminSessionWhere(input);

  const [totalResult] = await db()
    .select({ count: count() })
    .from(codeSession)
    .leftJoin(user, eq(user.id, codeSession.userId))
    .where(where);
  const total = Number(totalResult?.count || 0);

  const rows = await db()
    .select({
      id: codeSession.id,
      userId: codeSession.userId,
      userEmail: user.email,
      userName: user.name,
      runtimeUserId: codeSession.runtimeUserId,
      agent: codeSession.agent,
      model: codeSession.model,
      status: codeSession.status,
      title: codeSession.title,
      archiveKey: codeSession.archiveKey,
      archiveDigest: codeSession.archiveDigest,
      lastBilledAt: codeSession.lastBilledAt,
      billedCredits: codeSession.billedCredits,
      lastActiveAt: codeSession.lastActiveAt,
      endedAt: codeSession.endedAt,
      createdAt: codeSession.createdAt,
      updatedAt: codeSession.updatedAt,
    })
    .from(codeSession)
    .leftJoin(user, eq(user.id, codeSession.userId))
    .where(where)
    .orderBy(desc(codeSession.updatedAt))
    .limit(pageSize)
    .offset(offset);

  const items = await Promise.all(
    rows.map(async (row) => ({
      ...serializeSessionRow(row),
      eventSummary: await sessionEventSummary(row.id),
      billingSummary: await sessionBillingSummary(row.id),
    }))
  );

  return { items, total };
}

export async function getAdminCodeSessionDetail(
  sessionId: string,
  input: AdminCodeSessionDetailInput = {}
) {
  const [row] = await db()
    .select({
      id: codeSession.id,
      userId: codeSession.userId,
      userEmail: user.email,
      userName: user.name,
      runtimeUserId: codeSession.runtimeUserId,
      agent: codeSession.agent,
      model: codeSession.model,
      status: codeSession.status,
      title: codeSession.title,
      archiveKey: codeSession.archiveKey,
      archiveDigest: codeSession.archiveDigest,
      lastBilledAt: codeSession.lastBilledAt,
      billedCredits: codeSession.billedCredits,
      lastActiveAt: codeSession.lastActiveAt,
      endedAt: codeSession.endedAt,
      createdAt: codeSession.createdAt,
      updatedAt: codeSession.updatedAt,
    })
    .from(codeSession)
    .leftJoin(user, eq(user.id, codeSession.userId))
    .where(eq(codeSession.id, sessionId))
    .limit(1);

  if (!row) throw new Error('Session not found');

  const eventLimit = Math.min(300, Math.max(1, input.eventLimit || 120));
  const billingLimit = Math.min(100, Math.max(1, input.billingLimit || 80));
  const [eventsDesc, billingEvents, eventSummary, billingSummary] =
    await Promise.all([
      db()
        .select({
          id: codeSessionEvent.id,
          eventType: codeSessionEvent.eventType,
          severity: codeSessionEvent.severity,
          source: codeSessionEvent.source,
          message: codeSessionEvent.message,
          metadata: codeSessionEvent.metadata,
          createdAt: codeSessionEvent.createdAt,
        })
        .from(codeSessionEvent)
        .where(eq(codeSessionEvent.sessionId, sessionId))
        .orderBy(desc(codeSessionEvent.createdAt))
        .limit(eventLimit),
      db()
        .select({
          id: codeBillingEvent.id,
          eventType: codeBillingEvent.eventType,
          provider: codeBillingEvent.provider,
          endpoint: codeBillingEvent.endpoint,
          upstreamStatus: codeBillingEvent.upstreamStatus,
          requestId: codeBillingEvent.requestId,
          runtimeState: codeBillingEvent.runtimeState,
          inputTokens: codeBillingEvent.inputTokens,
          outputTokens: codeBillingEvent.outputTokens,
          cachedInputTokens: codeBillingEvent.cachedInputTokens,
          durationSeconds: codeBillingEvent.durationSeconds,
          rawCostCredits: codeBillingEvent.rawCostCredits,
          chargedCredits: codeBillingEvent.chargedCredits,
          billingMultiplier: codeBillingEvent.billingMultiplier,
          creditId: codeBillingEvent.creditId,
          status: codeBillingEvent.status,
          collectible: codeBillingEvent.collectible,
          settlementAttempts: codeBillingEvent.settlementAttempts,
          lastSettlementAt: codeBillingEvent.lastSettlementAt,
          settledAt: codeBillingEvent.settledAt,
          settlementError: codeBillingEvent.settlementError,
          description: codeBillingEvent.description,
          metadata: codeBillingEvent.metadata,
          rawUsage: codeBillingEvent.rawUsage,
          createdAt: codeBillingEvent.createdAt,
        })
        .from(codeBillingEvent)
        .where(eq(codeBillingEvent.sessionId, sessionId))
        .orderBy(desc(codeBillingEvent.createdAt))
        .limit(billingLimit),
      sessionEventSummary(sessionId),
      sessionBillingSummary(sessionId),
    ]);

  return {
    session: serializeSessionRow(row),
    eventSummary,
    billingSummary,
    events: eventsDesc.reverse().map(serializeEventRow),
    billingEvents: billingEvents.map(serializeBillingRow),
  };
}

function adminSessionWhere(input: AdminCodeSessionListInput) {
  const conditions: SQL[] = [];
  const status = input.status && input.status !== 'all' ? input.status : '';
  const agent = input.agent && input.agent !== 'all' ? input.agent : '';
  const search = input.search?.trim();

  if (status) conditions.push(eq(codeSession.status, status));
  if (agent) conditions.push(eq(codeSession.agent, agent));
  if (search) {
    const pattern = `%${search}%`;
    conditions.push(
      or(
        like(codeSession.id, pattern),
        like(codeSession.runtimeUserId, pattern),
        like(codeSession.model, pattern),
        like(codeSession.archiveKey, pattern),
        like(user.email, pattern),
        like(user.name, pattern)
      )!
    );
  }

  return conditions.length > 0 ? and(...conditions) : undefined;
}

async function sessionEventSummary(sessionId: string) {
  const [totalResult, issueResult, latest] = await Promise.all([
    db()
      .select({ count: count() })
      .from(codeSessionEvent)
      .where(eq(codeSessionEvent.sessionId, sessionId)),
    db()
      .select({ count: count() })
      .from(codeSessionEvent)
      .where(
        and(
          eq(codeSessionEvent.sessionId, sessionId),
          or(
            eq(codeSessionEvent.severity, 'warn'),
            eq(codeSessionEvent.severity, 'error')
          )!
        )
      ),
    db()
      .select({
        id: codeSessionEvent.id,
        eventType: codeSessionEvent.eventType,
        severity: codeSessionEvent.severity,
        source: codeSessionEvent.source,
        message: codeSessionEvent.message,
        metadata: codeSessionEvent.metadata,
        createdAt: codeSessionEvent.createdAt,
      })
      .from(codeSessionEvent)
      .where(eq(codeSessionEvent.sessionId, sessionId))
      .orderBy(desc(codeSessionEvent.createdAt))
      .limit(1),
  ]);

  return {
    total: Number(totalResult[0]?.count || 0),
    issues: Number(issueResult[0]?.count || 0),
    latest: latest[0] ? serializeEventRow(latest[0]) : null,
  };
}

async function sessionBillingSummary(sessionId: string) {
  const [aggregate] = await db()
    .select({
      count: count(),
      chargedCredits: sql<number>`coalesce(sum(case when ${codeBillingEvent.status} = 'charged' then ${codeBillingEvent.chargedCredits} else 0 end), 0)`,
      unpaidCredits: sql<number>`coalesce(sum(case when ${codeBillingEvent.status} = 'unpaid' then ${codeBillingEvent.chargedCredits} else 0 end), 0)`,
      collectibleUnpaidCredits: sql<number>`coalesce(sum(case when ${codeBillingEvent.status} = 'unpaid' and ${codeBillingEvent.collectible} = 1 then ${codeBillingEvent.chargedCredits} else 0 end), 0)`,
      inputTokens: sql<number>`coalesce(sum(${codeBillingEvent.inputTokens}), 0)`,
      outputTokens: sql<number>`coalesce(sum(${codeBillingEvent.outputTokens}), 0)`,
      cachedInputTokens: sql<number>`coalesce(sum(${codeBillingEvent.cachedInputTokens}), 0)`,
      durationSeconds: sql<number>`coalesce(sum(${codeBillingEvent.durationSeconds}), 0)`,
    })
    .from(codeBillingEvent)
    .where(eq(codeBillingEvent.sessionId, sessionId));

  const [latest] = await db()
    .select({
      id: codeBillingEvent.id,
      eventType: codeBillingEvent.eventType,
      provider: codeBillingEvent.provider,
      endpoint: codeBillingEvent.endpoint,
      upstreamStatus: codeBillingEvent.upstreamStatus,
      requestId: codeBillingEvent.requestId,
      runtimeState: codeBillingEvent.runtimeState,
      inputTokens: codeBillingEvent.inputTokens,
      outputTokens: codeBillingEvent.outputTokens,
      cachedInputTokens: codeBillingEvent.cachedInputTokens,
      durationSeconds: codeBillingEvent.durationSeconds,
      rawCostCredits: codeBillingEvent.rawCostCredits,
      chargedCredits: codeBillingEvent.chargedCredits,
      billingMultiplier: codeBillingEvent.billingMultiplier,
      creditId: codeBillingEvent.creditId,
      status: codeBillingEvent.status,
      collectible: codeBillingEvent.collectible,
      settlementAttempts: codeBillingEvent.settlementAttempts,
      lastSettlementAt: codeBillingEvent.lastSettlementAt,
      settledAt: codeBillingEvent.settledAt,
      settlementError: codeBillingEvent.settlementError,
      description: codeBillingEvent.description,
      metadata: codeBillingEvent.metadata,
      rawUsage: codeBillingEvent.rawUsage,
      createdAt: codeBillingEvent.createdAt,
    })
    .from(codeBillingEvent)
    .where(eq(codeBillingEvent.sessionId, sessionId))
    .orderBy(desc(codeBillingEvent.createdAt))
    .limit(1);

  return {
    total: Number(aggregate?.count || 0),
    chargedCredits: Number(aggregate?.chargedCredits || 0),
    unpaidCredits: Number(aggregate?.unpaidCredits || 0),
    collectibleUnpaidCredits: Number(aggregate?.collectibleUnpaidCredits || 0),
    inputTokens: Number(aggregate?.inputTokens || 0),
    outputTokens: Number(aggregate?.outputTokens || 0),
    cachedInputTokens: Number(aggregate?.cachedInputTokens || 0),
    durationSeconds: Number(aggregate?.durationSeconds || 0),
    latest: latest ? serializeBillingRow(latest) : null,
  };
}

function serializeSessionRow(row: Record<string, any>) {
  return {
    id: row.id,
    userId: row.userId,
    userEmail: row.userEmail || null,
    userName: row.userName || null,
    runtimeUserId: row.runtimeUserId,
    agent: row.agent,
    model: row.model,
    status: row.status,
    title: row.title || '',
    archiveKey: row.archiveKey || null,
    archiveDigest: row.archiveDigest || null,
    lastBilledAt: asIso(row.lastBilledAt),
    billedCredits: Number(row.billedCredits || 0),
    lastActiveAt: asIso(row.lastActiveAt),
    endedAt: asIso(row.endedAt),
    createdAt: asIso(row.createdAt),
    updatedAt: asIso(row.updatedAt),
  };
}

function serializeEventRow(row: Record<string, any>) {
  return {
    id: row.id,
    eventType: row.eventType,
    severity: row.severity,
    source: row.source,
    message: row.message || '',
    metadata: parseJsonValue(row.metadata),
    createdAt: asIso(row.createdAt),
  };
}

function serializeBillingRow(row: Record<string, any>) {
  return {
    id: row.id,
    eventType: row.eventType,
    provider: row.provider,
    endpoint: row.endpoint,
    upstreamStatus: Number(row.upstreamStatus || 0),
    requestId: row.requestId || '',
    runtimeState: row.runtimeState || '',
    inputTokens: Number(row.inputTokens || 0),
    outputTokens: Number(row.outputTokens || 0),
    cachedInputTokens: Number(row.cachedInputTokens || 0),
    durationSeconds: Number(row.durationSeconds || 0),
    rawCostCredits: Number(row.rawCostCredits || 0),
    chargedCredits: Number(row.chargedCredits || 0),
    billingMultiplier: Number(row.billingMultiplier || 0),
    creditId: row.creditId || '',
    status: row.status,
    collectible: Number(row.collectible || 0),
    settlementAttempts: Number(row.settlementAttempts || 0),
    lastSettlementAt: asIso(row.lastSettlementAt),
    settledAt: asIso(row.settledAt),
    settlementError: row.settlementError || '',
    description: row.description || '',
    metadata: parseJsonValue(row.metadata),
    rawUsage: parseJsonValue(row.rawUsage),
    createdAt: asIso(row.createdAt),
  };
}

function parseJsonValue(value: unknown) {
  if (!value || typeof value !== 'string') return value || null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function asIso(value: unknown) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'number') {
    const ms = value > 10_000_000_000 ? value : value * 1000;
    return new Date(ms).toISOString();
  }
  if (typeof value === 'string') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toISOString();
  }
  return null;
}
