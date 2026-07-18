import { and, asc, desc, eq, isNotNull, lt, or } from 'drizzle-orm';

import { db } from '@/core/db';
import { envConfigs } from '@/config';
import {
  codeSession,
  codeSessionEvent,
  type CodeSession,
  type NewCodeSession,
} from '@/config/db/schema';
import { getAllConfigs } from '@/modules/config/service';
import {
  getBalance,
  getHistory,
  grantForNewUser,
} from '@/modules/credits/service';

import { getCodeBillingSettings, settleSessionRuntimeUsage } from './billing';
import {
  getCodeModelForBilling,
  getEnabledCodeModel,
  hasConfiguredModelTokenCosts,
  type CodeModelView,
} from './models';
import {
  actionUrl,
  generateSessionId,
  normalizeAgent,
  sanitizeUserId,
  type CodeSessionAgent,
} from './runtime';

export type CodeSessionStatus = 'active' | 'suspended' | 'ended' | 'error';
export type { CodeSessionAgent };

export interface CodeSessionView {
  id: string;
  agent: CodeSessionAgent;
  model: string;
  runtimeUserId: string;
  status: CodeSessionStatus;
  title: string;
  archiveKey: string | null;
  archiveDigest: string | null;
  lastActiveAt: string;
  endedAt: string | null;
  createdAt: string;
}

export type CodeSessionStartErrorReason =
  | 'insufficient_credits'
  | 'model_costs_not_configured';

export class CodeSessionStartError extends Error {
  constructor(
    public reason: CodeSessionStartErrorReason,
    message: string,
    public details: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = 'CodeSessionStartError';
  }
}

export interface RuntimeActionResult {
  ok?: boolean;
  [key: string]: unknown;
}

interface ArchiveStatus {
  state: 'saved';
  savedAt: string;
  digest: string;
  key: string;
  eventKind: string;
  recordedEvent: boolean;
  bytes?: number;
  files?: number;
}

interface RestoreIntegrity {
  state: 'verified' | 'mismatch' | 'unknown' | 'untracked';
  expectedDigest: string;
  restoredDigest: string;
}

type CodeSessionEventSeverity = 'info' | 'warn' | 'error';
type CodeSessionEventSource = 'app' | 'browser' | 'runtime';

interface RecordCodeSessionEventInput {
  userId: string;
  sessionId: string;
  runtimeUserId?: string;
  agent?: unknown;
  model?: string;
  eventType: string;
  severity?: CodeSessionEventSeverity;
  source?: CodeSessionEventSource;
  message?: string;
  metadata?: Record<string, unknown>;
}

function maxActiveSessions() {
  const parsed = Number.parseInt(
    envConfigs.code_max_active_sessions || '1',
    10
  );
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function idleSuspendMinutes() {
  const parsed = Number.parseInt(
    envConfigs.code_session_idle_suspend_minutes || '30',
    10
  );
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 30;
}

function idleReaperBatchSize() {
  return 20;
}

function asIso(value: Date | string | number | null | undefined) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return new Date(value).toISOString();
}

function sessionRuntimeUserId(userId: string, sessionId: string) {
  return `${sanitizeUserId(userId)}-${sessionId}`;
}

export function toView(row: CodeSession): CodeSessionView {
  return {
    id: row.id,
    agent: normalizeAgent(row.agent),
    model: row.model || '',
    runtimeUserId: row.runtimeUserId,
    status: row.status as CodeSessionStatus,
    title: row.title,
    archiveKey: row.archiveKey,
    archiveDigest: row.archiveDigest,
    lastActiveAt: asIso(row.lastActiveAt) || new Date().toISOString(),
    endedAt: asIso(row.endedAt),
    createdAt: asIso(row.createdAt) || new Date().toISOString(),
  };
}

export async function listSessions(userId: string): Promise<CodeSessionView[]> {
  const rows = await db()
    .select()
    .from(codeSession)
    .where(
      and(eq(codeSession.userId, userId), eq(codeSession.status, 'active'))
    )
    .orderBy(desc(codeSession.lastActiveAt))
    .limit(10);
  return rows.map(toView);
}

export async function listArchivedSessions(
  userId: string
): Promise<CodeSessionView[]> {
  const rows = await db()
    .select()
    .from(codeSession)
    .where(
      and(
        eq(codeSession.userId, userId),
        or(
          eq(codeSession.status, 'suspended'),
          eq(codeSession.status, 'ended')
        ),
        isNotNull(codeSession.archiveKey)
      )
    )
    .orderBy(desc(codeSession.lastActiveAt))
    .limit(20);
  return rows.map(toView);
}

export async function getOrCreateActiveSession(
  userId: string
): Promise<CodeSessionView> {
  const [existing] = await db()
    .select()
    .from(codeSession)
    .where(
      and(eq(codeSession.userId, userId), eq(codeSession.status, 'active'))
    )
    .orderBy(desc(codeSession.lastActiveAt))
    .limit(1);

  if (existing) {
    return touchSession(userId, existing.id);
  }

  return createSession(userId);
}

export async function createSession(
  userId: string,
  agent?: unknown,
  model?: unknown
): Promise<CodeSessionView> {
  const normalizedAgent = normalizeAgent(agent);
  const selectedModel = await getEnabledCodeModel(normalizedAgent, model);
  await ensureCanStartBillableSession(userId, selectedModel);

  const activeRows = await db()
    .select({ id: codeSession.id })
    .from(codeSession)
    .where(
      and(eq(codeSession.userId, userId), eq(codeSession.status, 'active'))
    )
    .limit(maxActiveSessions());

  if (activeRows.length >= maxActiveSessions()) {
    throw new Error('Active session limit reached');
  }

  const now = new Date();
  const sessionId = generateSessionId();
  const row: NewCodeSession = {
    id: sessionId,
    agent: normalizedAgent,
    model: selectedModel.model,
    userId,
    runtimeUserId: sessionRuntimeUserId(userId, sessionId),
    status: 'active',
    title: '',
    lastActiveAt: now,
    createdAt: now,
    updatedAt: now,
  };

  await db().insert(codeSession).values(row);
  const created = await getOwnedSession(userId, row.id);
  if (!created) throw new Error('Failed to create code session');
  await recordCodeSessionEvent({
    userId,
    sessionId: created.id,
    runtimeUserId: created.runtimeUserId,
    agent: created.agent,
    model: created.model,
    eventType: 'session.created',
    message: 'Session created',
    metadata: { status: created.status },
  });
  return toView(created);
}

export async function preflightSessionStart(
  userId: string,
  agent?: unknown,
  model?: unknown
) {
  const selectedModel = await getEnabledCodeModel(agent, model);
  await ensureCanStartBillableSession(userId, selectedModel);
  return {
    agent: selectedModel.agent,
    model: selectedModel.model,
    ready: true,
  };
}

export async function getOwnedSession(userId: string, sessionId: string) {
  const [row] = await db()
    .select()
    .from(codeSession)
    .where(and(eq(codeSession.userId, userId), eq(codeSession.id, sessionId)))
    .limit(1);
  return row;
}

export async function touchSession(
  userId: string,
  sessionId: string
): Promise<CodeSessionView> {
  const now = new Date();
  await db()
    .update(codeSession)
    .set({ lastActiveAt: now, updatedAt: now })
    .where(and(eq(codeSession.userId, userId), eq(codeSession.id, sessionId)));

  const row = await getOwnedSession(userId, sessionId);
  if (!row) throw new Error('Session not found');
  return toView(row);
}

async function markSessionError(userId: string, sessionId: string) {
  const now = new Date();
  await db()
    .update(codeSession)
    .set({ status: 'error', updatedAt: now })
    .where(and(eq(codeSession.userId, userId), eq(codeSession.id, sessionId)));
}

async function markSessionEnded(
  userId: string,
  sessionId: string,
  archive?: RuntimeActionResult | null,
  endedAt?: Date
): Promise<CodeSessionView> {
  const now = endedAt || new Date();
  await db()
    .update(codeSession)
    .set({
      status: 'ended',
      endedAt: now,
      lastActiveAt: now,
      updatedAt: now,
      archiveKey: typeof archive?.key === 'string' ? archive.key : undefined,
      archiveDigest: digestFromArchive(archive),
    })
    .where(and(eq(codeSession.userId, userId), eq(codeSession.id, sessionId)));

  const row = await getOwnedSession(userId, sessionId);
  if (!row) throw new Error('Session not found');
  return toView(row);
}

async function markSessionDiscarded(
  userId: string,
  sessionId: string,
  endedAt?: Date
): Promise<CodeSessionView> {
  const now = endedAt || new Date();
  await db()
    .update(codeSession)
    .set({
      status: 'ended',
      endedAt: now,
      lastActiveAt: now,
      updatedAt: now,
      archiveKey: null,
      archiveDigest: null,
    })
    .where(and(eq(codeSession.userId, userId), eq(codeSession.id, sessionId)));

  const row = await getOwnedSession(userId, sessionId);
  if (!row) throw new Error('Session not found');
  return toView(row);
}

async function markSessionSuspended(
  userId: string,
  sessionId: string,
  archive?: RuntimeActionResult | null,
  suspendedAt?: Date
): Promise<CodeSessionView> {
  const now = suspendedAt || new Date();
  await db()
    .update(codeSession)
    .set({
      status: 'suspended',
      lastActiveAt: now,
      updatedAt: now,
      archiveKey: typeof archive?.key === 'string' ? archive.key : undefined,
      archiveDigest: digestFromArchive(archive),
    })
    .where(and(eq(codeSession.userId, userId), eq(codeSession.id, sessionId)));

  const row = await getOwnedSession(userId, sessionId);
  if (!row) throw new Error('Session not found');
  return toView(row);
}

export async function recordArchive(
  userId: string,
  sessionId: string,
  archive: RuntimeActionResult
): Promise<CodeSessionView> {
  const now = new Date();
  await db()
    .update(codeSession)
    .set({
      archiveKey: typeof archive.key === 'string' ? archive.key : undefined,
      archiveDigest: digestFromArchive(archive),
      lastActiveAt: now,
      updatedAt: now,
    })
    .where(and(eq(codeSession.userId, userId), eq(codeSession.id, sessionId)));

  const row = await getOwnedSession(userId, sessionId);
  if (!row) throw new Error('Session not found');
  return toView(row);
}

function digestFromArchive(archive?: RuntimeActionResult | null) {
  const digest =
    archive?.workspaceDigest || archive?.archiveSha256 || archive?.digest;
  return typeof digest === 'string' ? digest : undefined;
}

function objectField(payload: unknown, field: string) {
  if (!payload || typeof payload !== 'object') return undefined;
  const value = (payload as Record<string, unknown>)[field];
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : undefined;
}

function digestFromRestore(restore?: RuntimeActionResult | null) {
  const directDigest = digestFromArchive(restore);
  if (directDigest) return directDigest;

  const restored = objectField(restore, 'restored');
  const restoredDigest = digestFromArchive(
    restored as RuntimeActionResult | undefined
  );
  if (restoredDigest) return restoredDigest;

  const workspace = objectField(restore, 'workspace');
  const workspaceDigest = stringField(workspace, 'digest');
  if (workspaceDigest) return workspaceDigest;

  const objectMetadata = objectField(restore, 'objectMetadata');
  const metadataDigest = stringField(objectMetadata, 'workspaceDigest');
  return metadataDigest || undefined;
}

export async function recordCodeSessionEvent({
  userId,
  sessionId,
  runtimeUserId = '',
  agent,
  model = '',
  eventType,
  severity = 'info',
  source = 'app',
  message = '',
  metadata = {},
}: RecordCodeSessionEventInput) {
  const normalizedAgent = normalizeAgent(agent);
  const event = {
    id: generateEventId(),
    userId,
    sessionId,
    runtimeUserId,
    agent: normalizedAgent,
    model,
    eventType: safeString(eventType, 96),
    severity,
    source,
    message: safeString(message, 500),
    metadata: serializeMetadata(metadata),
    createdAt: new Date(),
  };

  console.info('[code-session-event]', event);

  try {
    await db().insert(codeSessionEvent).values(event);
  } catch (error) {
    console.warn('[code-session-event-failed]', {
      sessionId,
      eventType: event.eventType,
      message: (error as Error).message,
    });
  }
}

export async function recordClientSessionEvent(
  userId: string,
  sessionId: string,
  input: Record<string, unknown>
) {
  const row = await getOwnedSession(userId, sessionId);
  if (!row) throw new Error('Session not found');

  const eventType =
    typeof input.eventType === 'string' &&
    input.eventType.startsWith('terminal.')
      ? input.eventType
      : 'terminal.client';
  const severity =
    input.severity === 'warn' || input.severity === 'error'
      ? input.severity
      : 'info';
  const metadata =
    input.metadata && typeof input.metadata === 'object'
      ? (input.metadata as Record<string, unknown>)
      : {};

  await recordCodeSessionEvent({
    userId,
    sessionId,
    runtimeUserId: row.runtimeUserId,
    agent: row.agent,
    model: row.model,
    eventType,
    severity,
    source: 'browser',
    message: typeof input.message === 'string' ? input.message : '',
    metadata,
  });

  if (row.status === 'active') {
    const now = new Date();
    await db()
      .update(codeSession)
      .set({ lastActiveAt: now, updatedAt: now })
      .where(
        and(eq(codeSession.userId, userId), eq(codeSession.id, sessionId))
      );
  }

  return { ok: true };
}

export async function listSessionEvents(
  userId: string,
  sessionId: string,
  limit = 100
) {
  const rows = await db()
    .select()
    .from(codeSessionEvent)
    .where(
      and(
        eq(codeSessionEvent.userId, userId),
        eq(codeSessionEvent.sessionId, sessionId)
      )
    )
    .orderBy(desc(codeSessionEvent.createdAt))
    .limit(Math.min(Math.max(limit, 1), 200));

  return rows.map((row: any) => ({
    ...row,
    createdAt: asIso(row.createdAt),
  }));
}

function generateEventId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `evt-${Date.now().toString(36)}`;
}

function safeString(value: unknown, maxLength: number) {
  if (typeof value !== 'string') return '';
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

function serializeMetadata(metadata: Record<string, unknown>) {
  try {
    const json = JSON.stringify(sanitizeMetadata(metadata));
    return json.length > 4000 ? json.slice(0, 4000) : json;
  } catch {
    return '';
  }
}

function sanitizeMetadata(value: unknown, depth = 0): unknown {
  if (value == null) return value;
  if (typeof value === 'string') return safeString(value, 500);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (depth >= 3) return '[truncated]';
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => sanitizeMetadata(item, depth + 1));
  }
  if (typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(
      value as Record<string, unknown>
    )) {
      if (
        /^(apiKey|accessToken|refreshToken|idToken|password|secret|authorization|cookie)$/i.test(
          key
        )
      ) {
        output[key] = '[redacted]';
        continue;
      }
      output[safeString(key, 80)] = sanitizeMetadata(item, depth + 1);
    }
    return output;
  }
  return String(value);
}

function pickRuntimeFields(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== 'object') return {};
  const record = payload as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  for (const key of [
    'ok',
    'exists',
    'state',
    'status',
    'agent',
    'model',
    'workspace',
    'runtimeUserId',
    'sessionId',
    'key',
    'versionKey',
    'archiveSha256',
    'workspaceDigest',
    'digest',
    'files',
    'fileCount',
    'previousFileCount',
    'bytes',
    'durationSeconds',
    'chargedCredits',
  ]) {
    if (record[key] !== undefined) output[key] = record[key];
  }
  return output;
}

function archiveMetadata(archive?: RuntimeActionResult | null) {
  if (!archive) return {};
  return {
    key: typeof archive.key === 'string' ? archive.key : '',
    versionKey:
      typeof archive.versionKey === 'string' ? archive.versionKey : '',
    digest: digestFromArchive(archive) || '',
    bytes:
      typeof archive.bytes === 'number'
        ? archive.bytes
        : typeof archive.size === 'number'
          ? archive.size
          : undefined,
    files:
      typeof archive.files === 'number'
        ? archive.files
        : typeof archive.fileCount === 'number'
          ? archive.fileCount
          : undefined,
  };
}

function archiveStatusFromResult(
  session: CodeSessionView,
  archive: RuntimeActionResult,
  eventKind: string | null
): ArchiveStatus {
  const metadata = archiveMetadata(archive);
  return {
    state: 'saved',
    savedAt: session.lastActiveAt,
    digest:
      (typeof metadata.digest === 'string' ? metadata.digest : '') ||
      session.archiveDigest ||
      '',
    key:
      (typeof metadata.key === 'string' ? metadata.key : '') ||
      session.archiveKey ||
      '',
    eventKind: eventKind || 'unchanged',
    recordedEvent: Boolean(eventKind),
    bytes: typeof metadata.bytes === 'number' ? metadata.bytes : undefined,
    files: typeof metadata.files === 'number' ? metadata.files : undefined,
  };
}

function archiveEventKind(
  row: CodeSession,
  archive?: RuntimeActionResult | null
) {
  const digest = digestFromArchive(archive);
  if (!row.archiveKey) return 'first';
  if (digest && digest !== row.archiveDigest) return 'digest_changed';
  return null;
}

function restoreIntegrityFromResult(
  row: CodeSession,
  restore?: RuntimeActionResult | null
): RestoreIntegrity {
  const expectedDigest = row.archiveDigest || '';
  const restoredDigest = digestFromRestore(restore) || '';
  if (!expectedDigest) {
    return { state: 'untracked', expectedDigest, restoredDigest };
  }
  if (!restoredDigest) {
    return { state: 'unknown', expectedDigest, restoredDigest };
  }
  if (restoredDigest !== expectedDigest) {
    return { state: 'mismatch', expectedDigest, restoredDigest };
  }
  return { state: 'verified', expectedDigest, restoredDigest };
}

function booleanField(payload: unknown, field: string) {
  if (!payload || typeof payload !== 'object') return undefined;
  const value = (payload as Record<string, unknown>)[field];
  return typeof value === 'boolean' ? value : undefined;
}

function stringField(payload: unknown, field: string) {
  if (!payload || typeof payload !== 'object') return '';
  const value = (payload as Record<string, unknown>)[field];
  return typeof value === 'string' ? value : '';
}

async function runtimeJson(
  action: string,
  runtimeUserId: string,
  sessionId?: string,
  method: 'GET' | 'POST' = 'GET',
  agent?: CodeSessionAgent,
  model?: string
): Promise<RuntimeActionResult> {
  const res = await fetch(
    actionUrl(
      envConfigs.runtime_base_url,
      action,
      runtimeUserId,
      sessionId,
      agent,
      model
    ),
    { method }
  );
  const payload = await res.json().catch(() => ({}));

  if (!res.ok || payload?.ok === false) {
    const message =
      typeof payload?.error === 'string'
        ? payload.error
        : res.statusText || 'Runtime request failed';
    throw new Error(message);
  }

  return payload;
}

export async function health(userId: string, sessionId: string) {
  const row = await getOwnedSession(userId, sessionId);
  if (!row) throw new Error('Session not found');
  try {
    const health = await runtimeJson(
      'container-health',
      row.runtimeUserId,
      sessionId,
      'GET',
      normalizeAgent(row.agent),
      row.model
    );
    await recordCodeSessionEvent({
      userId,
      sessionId,
      runtimeUserId: row.runtimeUserId,
      agent: row.agent,
      model: row.model,
      eventType: 'session.health',
      message: 'Runtime health checked',
      metadata: pickRuntimeFields(health),
    });
    return health;
  } catch (error) {
    await recordCodeSessionEvent({
      userId,
      sessionId,
      runtimeUserId: row.runtimeUserId,
      agent: row.agent,
      model: row.model,
      eventType: 'session.health.failed',
      severity: 'warn',
      message: (error as Error).message,
    });
    throw error;
  }
}

export async function inspectSession(userId: string, sessionId: string) {
  const row = await getOwnedSession(userId, sessionId);
  if (!row) throw new Error('Session not found');
  if (row.status !== 'active') throw new Error('Session is not active');

  const agent = normalizeAgent(row.agent);
  try {
    const [tmuxStatus, workspace] = await Promise.all([
      runtimeJson(
        'tmux',
        row.runtimeUserId,
        sessionId,
        'GET',
        agent,
        row.model
      ),
      runtimeJson(
        'inspect',
        row.runtimeUserId,
        sessionId,
        'GET',
        agent,
        row.model
      ),
    ]);
    await recordCodeSessionEvent({
      userId,
      sessionId,
      runtimeUserId: row.runtimeUserId,
      agent: row.agent,
      model: row.model,
      eventType: 'session.inspect',
      message: 'Runtime inspected',
      metadata: {
        tmuxExists: booleanField(tmuxStatus, 'exists'),
        workspaceExists: booleanField(workspace, 'exists'),
        tmuxState: stringField(tmuxStatus, 'state'),
        workspacePath: stringField(workspace, 'workspace'),
      },
    });

    return { session: toView(row), tmuxStatus, workspace };
  } catch (error) {
    await recordCodeSessionEvent({
      userId,
      sessionId,
      runtimeUserId: row.runtimeUserId,
      agent: row.agent,
      model: row.model,
      eventType: 'session.inspect.failed',
      severity: 'warn',
      message: (error as Error).message,
    });
    throw error;
  }
}

export async function archiveSession(userId: string, sessionId: string) {
  const row = await getOwnedSession(userId, sessionId);
  if (!row) throw new Error('Session not found');
  if (row.status !== 'active') throw new Error('Session is not active');

  try {
    const archive = await runtimeJson(
      'archive',
      row.runtimeUserId,
      sessionId,
      'GET',
      normalizeAgent(row.agent),
      row.model
    );
    const eventKind = archiveEventKind(row, archive);
    const session = await recordArchive(userId, sessionId, archive);
    const archiveStatus = archiveStatusFromResult(session, archive, eventKind);
    if (eventKind) {
      await recordCodeSessionEvent({
        userId,
        sessionId,
        runtimeUserId: row.runtimeUserId,
        agent: row.agent,
        model: row.model,
        eventType: 'session.archive',
        message:
          eventKind === 'first'
            ? 'Workspace archived for the first time'
            : 'Workspace archive digest changed',
        metadata: {
          ...archiveMetadata(archive),
          eventKind,
          previousArchiveKey: row.archiveKey || '',
          previousDigest: row.archiveDigest || '',
        },
      });
    }

    return { session, archive, archiveStatus };
  } catch (error) {
    await recordCodeSessionEvent({
      userId,
      sessionId,
      runtimeUserId: row.runtimeUserId,
      agent: row.agent,
      model: row.model,
      eventType: 'session.archive.failed',
      severity: 'warn',
      message: (error as Error).message,
    });
    throw error;
  }
}

export async function restoreSession(userId: string, sessionId: string) {
  const row = await getOwnedSession(userId, sessionId);
  if (!row) throw new Error('Session not found');
  if (row.status !== 'active') throw new Error('Session is not active');

  try {
    const restore = await runtimeJson(
      'restore',
      row.runtimeUserId,
      sessionId,
      'POST',
      normalizeAgent(row.agent),
      row.model
    );
    const restoreIntegrity = restoreIntegrityFromResult(row, restore);
    if (restoreIntegrity.state === 'mismatch') {
      await recordCodeSessionEvent({
        userId,
        sessionId,
        runtimeUserId: row.runtimeUserId,
        agent: row.agent,
        model: row.model,
        eventType: 'session.restore.integrity_failed',
        severity: 'error',
        message: 'Restored workspace digest mismatch',
        metadata: {
          restoreIntegrity,
          restore: pickRuntimeFields(restore),
        },
      });
      throw new Error('Restored workspace digest mismatch');
    }

    const session = await touchSession(userId, sessionId);
    if (restoreIntegrity.state === 'unknown') {
      await recordCodeSessionEvent({
        userId,
        sessionId,
        runtimeUserId: row.runtimeUserId,
        agent: row.agent,
        model: row.model,
        eventType: 'session.restore.integrity_unknown',
        severity: 'warn',
        message: 'Restored workspace digest was not reported',
        metadata: {
          restoreIntegrity,
          restore: pickRuntimeFields(restore),
        },
      });
    }
    await recordCodeSessionEvent({
      userId,
      sessionId,
      runtimeUserId: row.runtimeUserId,
      agent: row.agent,
      model: row.model,
      eventType: 'session.restore',
      message: 'Workspace restored',
      metadata: {
        ...pickRuntimeFields(restore),
        restoreIntegrity,
      },
    });

    return { session, restore, restoreIntegrity };
  } catch (error) {
    await recordCodeSessionEvent({
      userId,
      sessionId,
      runtimeUserId: row.runtimeUserId,
      agent: row.agent,
      model: row.model,
      eventType: 'session.restore.failed',
      severity: 'warn',
      message: (error as Error).message,
    });
    throw error;
  }
}

export async function resumeArchivedSession(userId: string, sessionId: string) {
  const row = await getOwnedSession(userId, sessionId);
  if (!row) throw new Error('Session not found');
  if (row.status !== 'ended' && row.status !== 'suspended') {
    throw new Error('Session is not restorable');
  }
  if (!row.archiveKey) throw new Error('Archived workspace not found');

  const model = await getCodeModelForBilling(row.agent, row.model);
  await ensureCanStartBillableSession(userId, model || undefined);

  const activeRows = await db()
    .select({ id: codeSession.id })
    .from(codeSession)
    .where(
      and(eq(codeSession.userId, userId), eq(codeSession.status, 'active'))
    )
    .limit(maxActiveSessions());

  if (activeRows.length >= maxActiveSessions()) {
    throw new Error('Suspend or end the current session before restoring');
  }

  const now = new Date();
  await db()
    .update(codeSession)
    .set({
      status: 'active',
      endedAt: null,
      lastActiveAt: now,
      updatedAt: now,
    })
    .where(and(eq(codeSession.userId, userId), eq(codeSession.id, sessionId)));

  const resumed = await getOwnedSession(userId, sessionId);
  if (!resumed) throw new Error('Session not found');

  await recordCodeSessionEvent({
    userId,
    sessionId,
    runtimeUserId: resumed.runtimeUserId,
    agent: resumed.agent,
    model: resumed.model,
    eventType: 'session.resumed',
    message: 'Archived session resumed',
    metadata: {
      archiveKey: row.archiveKey,
      archiveDigest: row.archiveDigest || '',
      previousStatus: row.status,
      previousEndedAt: asIso(row.endedAt),
    },
  });

  return { session: toView(resumed), restorePending: true };
}

export async function preflightSessionResume(
  userId: string,
  sessionId: string
) {
  const row = await getOwnedSession(userId, sessionId);
  if (!row) throw new Error('Session not found');
  if (row.status !== 'ended' && row.status !== 'suspended') {
    throw new Error('Session is not restorable');
  }
  if (!row.archiveKey) throw new Error('Archived workspace not found');

  const model = await getCodeModelForBilling(row.agent, row.model);
  await ensureCanStartBillableSession(userId, model || undefined);
  return { ready: true, sessionId: row.id };
}

export async function suspendSession(userId: string, sessionId: string) {
  const row = await getOwnedSession(userId, sessionId);
  if (!row) throw new Error('Session not found');
  return suspendSessionRow(row, { reason: 'manual' });
}

export async function discardSession(userId: string, sessionId: string) {
  const row = await getOwnedSession(userId, sessionId);
  if (!row) throw new Error('Session not found');
  if (row.status === 'error') throw new Error('Session is in error state');

  let clear: RuntimeActionResult | null = null;
  let billing: unknown = null;
  const endedAt = new Date();

  if (row.status === 'active') {
    try {
      clear = await runtimeJson(
        'clear',
        row.runtimeUserId,
        row.id,
        'POST',
        normalizeAgent(row.agent),
        row.model
      );
    } catch (error) {
      await markSessionError(userId, sessionId);
      await recordCodeSessionEvent({
        userId,
        sessionId,
        runtimeUserId: row.runtimeUserId,
        agent: row.agent,
        model: row.model,
        eventType: 'session.discard.failed',
        severity: 'error',
        message: (error as Error).message || 'Runtime cleanup failed',
      });
      throw error;
    }

    try {
      billing = await settleSessionRuntimeUsage({
        userId,
        sessionId,
        runtimeState: 'active',
        endedAt,
        metadata: { reason: 'discard' },
      });
    } catch (error) {
      await recordCodeSessionEvent({
        userId,
        sessionId,
        runtimeUserId: row.runtimeUserId,
        agent: row.agent,
        model: row.model,
        eventType: 'session.billing.failed',
        severity: 'warn',
        message: (error as Error).message,
        metadata: { during: 'session.discard' },
      });
    }
  }

  const session = await markSessionDiscarded(userId, sessionId, endedAt);
  await recordCodeSessionEvent({
    userId,
    sessionId,
    runtimeUserId: row.runtimeUserId,
    agent: row.agent,
    model: row.model,
    eventType: 'session.discarded',
    message: 'Session discarded',
    metadata: {
      previousStatus: row.status,
      previousArchiveKey: row.archiveKey || '',
      clear: pickRuntimeFields(clear),
      billing: pickRuntimeFields(billing),
    },
  });

  return { session, clear, billing };
}

export async function suspendIdleSessions(now = new Date()) {
  const cutoff = new Date(now.getTime() - idleSuspendMinutes() * 60_000);
  const rows = await db()
    .select()
    .from(codeSession)
    .where(
      and(
        eq(codeSession.status, 'active'),
        lt(codeSession.lastActiveAt, cutoff)
      )
    )
    .orderBy(asc(codeSession.lastActiveAt))
    .limit(idleReaperBatchSize());

  const result = {
    ok: true,
    checked: rows.length,
    suspended: 0,
    skipped: 0,
    failed: 0,
    cutoff: cutoff.toISOString(),
    idleMinutes: idleSuspendMinutes(),
  };

  for (const row of rows) {
    try {
      await suspendSessionRow(row, {
        reason: 'idle-timeout',
        now,
        cutoff,
      });
      result.suspended += 1;
    } catch (error) {
      result.failed += 1;
      console.warn('[code-session-reaper] suspend failed', {
        sessionId: row.id,
        userId: row.userId,
        message: (error as Error).message,
      });
    }
  }

  return result;
}

async function suspendSessionRow(
  row: CodeSession,
  options: { reason: string; now?: Date; cutoff?: Date }
) {
  if (row.status === 'suspended') {
    return {
      session: toView(row),
      archive: null,
      clear: null,
      archiveError: null,
      clearError: null,
      billing: null,
    };
  }
  if (row.status !== 'active') throw new Error('Session is not active');

  let archive: RuntimeActionResult | null = null;
  let archiveError: string | null = null;
  try {
    archive = await runtimeJson(
      'archive',
      row.runtimeUserId,
      row.id,
      'GET',
      normalizeAgent(row.agent),
      row.model
    );
  } catch (error) {
    archiveError = (error as Error).message || 'Archive failed';
    await recordCodeSessionEvent({
      userId: row.userId,
      sessionId: row.id,
      runtimeUserId: row.runtimeUserId,
      agent: row.agent,
      model: row.model,
      eventType: 'session.archive.failed',
      severity: 'warn',
      message: archiveError,
      metadata: { during: 'session.suspend', reason: options.reason },
    });
  }

  if (!archive && !row.archiveKey) {
    await recordCodeSessionEvent({
      userId: row.userId,
      sessionId: row.id,
      runtimeUserId: row.runtimeUserId,
      agent: row.agent,
      model: row.model,
      eventType: 'session.suspend.failed',
      severity: 'warn',
      message: archiveError || 'No archive available for suspended session',
      metadata: { reason: options.reason },
    });
    throw new Error('Cannot suspend session without a workspace archive');
  }

  let clear: RuntimeActionResult | null = null;
  let clearError: string | null = null;
  try {
    clear = await runtimeJson(
      'clear',
      row.runtimeUserId,
      row.id,
      'POST',
      normalizeAgent(row.agent),
      row.model
    );
  } catch (error) {
    clearError = (error as Error).message || 'Runtime cleanup failed';
    await recordCodeSessionEvent({
      userId: row.userId,
      sessionId: row.id,
      runtimeUserId: row.runtimeUserId,
      agent: row.agent,
      model: row.model,
      eventType: 'session.clear.failed',
      severity: 'warn',
      message: clearError,
      metadata: { during: 'session.suspend', reason: options.reason },
    });
  }

  const suspendedAt = options.now || new Date();
  let billing: unknown = null;
  try {
    billing = await settleSessionRuntimeUsage({
      userId: row.userId,
      sessionId: row.id,
      runtimeState: 'active',
      endedAt: suspendedAt,
      metadata: { reason: options.reason, suspended: true },
    });
  } catch (error) {
    await recordCodeSessionEvent({
      userId: row.userId,
      sessionId: row.id,
      runtimeUserId: row.runtimeUserId,
      agent: row.agent,
      model: row.model,
      eventType: 'session.billing.failed',
      severity: 'warn',
      message: (error as Error).message,
      metadata: { during: 'session.suspend', reason: options.reason },
    });
  }

  const session = await markSessionSuspended(
    row.userId,
    row.id,
    archive,
    suspendedAt
  );
  await recordCodeSessionEvent({
    userId: row.userId,
    sessionId: row.id,
    runtimeUserId: row.runtimeUserId,
    agent: row.agent,
    model: row.model,
    eventType: 'session.suspended',
    message: 'Session suspended',
    metadata: {
      reason: options.reason,
      cutoff: options.cutoff?.toISOString(),
      archiveError,
      clearError,
      archive: archiveMetadata(archive),
      billing: pickRuntimeFields(billing),
    },
  });

  return { session, archive, clear, archiveError, clearError, billing };
}

export async function endSession(userId: string, sessionId: string) {
  const row = await getOwnedSession(userId, sessionId);
  if (!row) throw new Error('Session not found');

  let archive: RuntimeActionResult | null = null;
  let archiveError: string | null = null;
  if (row.status === 'active') {
    try {
      archive = await runtimeJson(
        'archive',
        row.runtimeUserId,
        sessionId,
        'GET',
        normalizeAgent(row.agent),
        row.model
      );
    } catch (error) {
      archiveError = (error as Error).message || 'Archive failed';
      await recordCodeSessionEvent({
        userId,
        sessionId,
        runtimeUserId: row.runtimeUserId,
        agent: row.agent,
        model: row.model,
        eventType: 'session.archive.failed',
        severity: 'warn',
        message: archiveError,
        metadata: { during: 'session.end' },
      });
    }
  }

  try {
    const clear = await runtimeJson(
      'clear',
      row.runtimeUserId,
      sessionId,
      'POST',
      normalizeAgent(row.agent),
      row.model
    );
    const endedAt = new Date();
    const billing = await settleSessionRuntimeUsage({
      userId,
      sessionId,
      runtimeState: 'active',
      endedAt,
    });
    const session = await markSessionEnded(userId, sessionId, archive, endedAt);
    await recordCodeSessionEvent({
      userId,
      sessionId,
      runtimeUserId: row.runtimeUserId,
      agent: row.agent,
      model: row.model,
      eventType: 'session.ended',
      message: 'Session ended',
      metadata: {
        archiveError,
        archive: archiveMetadata(archive),
        billing: pickRuntimeFields(billing),
      },
    });
    return { session, archive, clear, archiveError, billing };
  } catch (error) {
    await markSessionError(userId, sessionId);
    await recordCodeSessionEvent({
      userId,
      sessionId,
      runtimeUserId: row.runtimeUserId,
      agent: row.agent,
      model: row.model,
      eventType: 'session.end.failed',
      severity: 'error',
      message: (error as Error).message,
    });
    throw error;
  }
}

async function ensureCanStartBillableSession(
  userId: string,
  model?: CodeModelView
) {
  const settings = await getCodeBillingSettings();
  if (!settings.enabled) {
    return;
  }

  if (
    settings.requireConfiguredModelCosts &&
    model &&
    !hasConfiguredModelTokenCosts(model)
  ) {
    throw new CodeSessionStartError(
      'model_costs_not_configured',
      'Selected model billing is not configured',
      { agent: model.agent, model: model.model }
    );
  }

  if (settings.sessionCreateMinBalanceCredits <= 0) return;

  let balance = await getBalance(userId);
  if (balance >= settings.sessionCreateMinBalanceCredits) {
    return;
  }

  const history = await getHistory(userId, 1);
  if (history.length === 0) {
    await grantForNewUser({
      userId,
      configs: await getAllConfigs(),
    });
    balance = await getBalance(userId);
  }

  if (balance < settings.sessionCreateMinBalanceCredits) {
    throw new CodeSessionStartError(
      'insufficient_credits',
      'Insufficient credits to start a new session',
      {
        balance,
        requiredBalance: settings.sessionCreateMinBalanceCredits,
      }
    );
  }
}
