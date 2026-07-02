import { createFileRoute } from '@tanstack/react-router';

import { getAuth } from '@/core/auth';
import * as codeSessions from '@/modules/code/service';
import { enforceMinIntervalRateLimit } from '@/lib/rate-limit';
import { respData, respErr } from '@/lib/resp';

const ACTIONS = ['health', 'archive', 'restore', 'end'] as const;
type Action = (typeof ACTIONS)[number];

async function currentUser(request: Request) {
  const auth = getAuth();
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) throw new Error('Unauthorized');
  return session.user;
}

function isAction(value: unknown): value is Action {
  return typeof value === 'string' && ACTIONS.includes(value as Action);
}

async function POST({
  request,
  params,
}: {
  request: Request;
  params: { id: string };
}) {
  try {
    const user = await currentUser(request);
    const limited = enforceMinIntervalRateLimit(request, {
      intervalMs: 2000,
      keyPrefix: 'code-session-action',
      extraKey: `${user.id}:${params.id}`,
    });
    if (limited) return limited;

    const body = await request.json().catch(() => ({}));
    if (!isAction(body.action)) return respErr('Invalid action');

    switch (body.action) {
      case 'health':
        return respData(await codeSessions.health(user.id));
      case 'archive':
        return respData(await codeSessions.archiveSession(user.id, params.id));
      case 'restore':
        return respData(await codeSessions.restoreSession(user.id, params.id));
      case 'end':
        return respData(await codeSessions.endSession(user.id, params.id));
    }
  } catch (error: any) {
    return respErr(error.message || 'Code session action failed');
  }
}

export const Route = createFileRoute('/api/code/sessions/$id/actions')({
  server: {
    handlers: { POST },
  },
});
