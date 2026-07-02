import { and, desc, eq } from 'drizzle-orm';

import { db } from '@/core/db';
import { envConfigs } from '@/config';
import {
  codeSession,
  type CodeSession,
  type NewCodeSession,
} from '@/config/db/schema';

import { actionUrl, generateSessionId, sanitizeUserId } from './runtime';

export type CodeSessionStatus = 'active' | 'ended' | 'error';

export interface CodeSessionView {
  id: string;
  runtimeUserId: string;
  status: CodeSessionStatus;
  title: string;
  archiveKey: string | null;
  archiveDigest: string | null;
  lastActiveAt: string;
  endedAt: string | null;
  createdAt: string;
}

export interface RuntimeActionResult {
  ok?: boolean;
  [key: string]: unknown;
}

function maxActiveSessions() {
  const parsed = Number.parseInt(
    envConfigs.code_max_active_sessions || '1',
    10
  );
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function asIso(value: Date | string | number | null | undefined) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return new Date(value).toISOString();
}

export function toView(row: CodeSession): CodeSessionView {
  return {
    id: row.id,
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

export async function createSession(userId: string): Promise<CodeSessionView> {
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
  const runtimeUserId = sanitizeUserId(userId);
  const row: NewCodeSession = {
    id: generateSessionId(),
    userId,
    runtimeUserId,
    status: 'active',
    title: '',
    lastActiveAt: now,
    createdAt: now,
    updatedAt: now,
  };

  await db().insert(codeSession).values(row);
  const created = await getOwnedSession(userId, row.id);
  if (!created) throw new Error('Failed to create code session');
  return toView(created);
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
  archive?: RuntimeActionResult | null
): Promise<CodeSessionView> {
  const now = new Date();
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

async function runtimeJson(
  action: string,
  runtimeUserId: string,
  sessionId?: string,
  method: 'GET' | 'POST' = 'GET'
): Promise<RuntimeActionResult> {
  const res = await fetch(
    actionUrl(envConfigs.runtime_base_url, action, runtimeUserId, sessionId),
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

export async function health(userId: string) {
  return runtimeJson('container-health', sanitizeUserId(userId));
}

export async function archiveSession(userId: string, sessionId: string) {
  const row = await getOwnedSession(userId, sessionId);
  if (!row) throw new Error('Session not found');
  if (row.status !== 'active') throw new Error('Session is not active');

  const archive = await runtimeJson(
    'archive',
    row.runtimeUserId,
    sessionId,
    'GET'
  );
  const session = await recordArchive(userId, sessionId, archive);

  return { session, archive };
}

export async function restoreSession(userId: string, sessionId: string) {
  const row = await getOwnedSession(userId, sessionId);
  if (!row) throw new Error('Session not found');
  if (row.status !== 'active') throw new Error('Session is not active');

  const restore = await runtimeJson(
    'restore',
    row.runtimeUserId,
    sessionId,
    'POST'
  );
  const session = await touchSession(userId, sessionId);

  return { session, restore };
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
        'GET'
      );
    } catch (error) {
      archiveError = (error as Error).message || 'Archive failed';
    }
  }

  try {
    const clear = await runtimeJson(
      'clear',
      row.runtimeUserId,
      sessionId,
      'POST'
    );
    const session = await markSessionEnded(userId, sessionId, archive);
    return { session, archive, clear, archiveError };
  } catch (error) {
    await markSessionError(userId, sessionId);
    throw error;
  }
}
