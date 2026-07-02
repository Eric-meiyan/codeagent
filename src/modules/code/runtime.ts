// Pure helpers for the CodeAgent runtime session. No DOM / browser deps —
// safe to run under tsx and to import from server functions.

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

export function terminalWsUrl(
  base: string,
  userId: string,
  sessionId: string
): string {
  const wsBase = trimSlashes(base).replace(/^http/, 'ws');
  return `${wsBase}/terminal/${encodeURIComponent(userId)}/${encodeURIComponent(sessionId)}`;
}

export function actionUrl(
  base: string,
  action: string,
  userId: string,
  sessionId?: string
): string {
  const parts = [
    trimSlashes(base),
    encodeURIComponent(action),
    encodeURIComponent(userId),
  ];
  if (sessionId) parts.push(encodeURIComponent(sessionId));
  return parts.join('/');
}

export function previewUrl(
  base: string,
  userId: string,
  sessionId: string
): string {
  return `${trimSlashes(base)}/preview/${encodeURIComponent(userId)}/${encodeURIComponent(sessionId)}/`;
}
