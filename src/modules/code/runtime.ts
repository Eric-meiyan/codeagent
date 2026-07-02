// Pure helpers for the CodeAgent runtime session. No DOM / browser deps —
// safe to run under tsx and to import from server functions.

export const CODE_SESSION_AGENTS = ['claude', 'codex'] as const;
export type CodeSessionAgent = (typeof CODE_SESSION_AGENTS)[number];

export function normalizeAgent(value: unknown): CodeSessionAgent {
  return value === 'codex' ? 'codex' : 'claude';
}

// Lossy by design: lowercases and strips everything outside [a-z0-9-], so
// two distinct auth user ids could in theory collapse to the same slug and
// share a runtime container namespace. Acceptable for round 1 (random
// better-auth ids); revisit if round 2 moves to token-based auth with
// user-chosen or predictable ids.
export function sanitizeUserId(raw: string): string {
  const slug = (raw ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return slug || 'user';
}

export function generateSessionId(): string {
  const time = Date.now().toString(36);
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 10)
      : Math.floor(Math.random() * 1e16).toString(36);
  return `s-${time}-${rand}`.toLowerCase();
}

function trimSlashes(base: string): string {
  return base.replace(/\/+$/, '');
}

function appendAgentParam(url: string, agent?: CodeSessionAgent): string {
  const normalized = normalizeAgent(agent);
  if (normalized === 'claude') return url;
  const parsed = new URL(url);
  parsed.searchParams.set('agent', normalized);
  return parsed.toString();
}

export function terminalWsUrl(
  base: string,
  userId: string,
  sessionId: string,
  agent?: CodeSessionAgent
): string {
  const wsBase = trimSlashes(base).replace(/^http/, 'ws');
  return appendAgentParam(
    `${wsBase}/terminal/${encodeURIComponent(userId)}/${encodeURIComponent(sessionId)}`,
    agent
  );
}

export function actionUrl(
  base: string,
  action: string,
  userId: string,
  sessionId?: string,
  agent?: CodeSessionAgent
): string {
  const parts = [
    trimSlashes(base),
    encodeURIComponent(action),
    encodeURIComponent(userId),
  ];
  if (sessionId) parts.push(encodeURIComponent(sessionId));
  return appendAgentParam(parts.join('/'), agent);
}

export function previewUrl(
  base: string,
  userId: string,
  sessionId: string
): string {
  return `${trimSlashes(base)}/preview/${encodeURIComponent(userId)}/${encodeURIComponent(sessionId)}/`;
}
