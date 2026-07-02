import { createFileRoute } from '@tanstack/react-router';

import { getAuth } from '@/core/auth';
import * as codeSessions from '@/modules/code/service';
import { enforceMinIntervalRateLimit } from '@/lib/rate-limit';
import { respData, respErr } from '@/lib/resp';

async function currentUser(request: Request) {
  const auth = getAuth();
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) throw new Error('Unauthorized');
  return session.user;
}

async function GET({ request }: { request: Request }) {
  try {
    const user = await currentUser(request);
    const sessions = await codeSessions.listSessions(user.id);
    return respData(sessions);
  } catch (error: any) {
    return respErr(error.message || 'Failed to list code sessions');
  }
}

async function POST({ request }: { request: Request }) {
  try {
    const user = await currentUser(request);
    const limited = enforceMinIntervalRateLimit(request, {
      intervalMs: 2000,
      keyPrefix: 'code-session-create',
      extraKey: user.id,
    });
    if (limited) return limited;

    const body = await request.json().catch(() => ({}));
    const session = await codeSessions.createSession(
      user.id,
      body.agent,
      body.model
    );
    return respData(session);
  } catch (error: any) {
    return respErr(error.message || 'Failed to create code session');
  }
}

export const Route = createFileRoute('/api/code/sessions')({
  server: {
    handlers: { GET, POST },
  },
});
