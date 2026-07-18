import { createFileRoute } from '@tanstack/react-router';

import { getAuth } from '@/core/auth';
import * as codeSessions from '@/modules/code/service';
import { enforceMinIntervalRateLimit } from '@/lib/rate-limit';
import { respData, respErr, respJson } from '@/lib/resp';

async function currentUser(request: Request) {
  const auth = getAuth();
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) throw new Error('Unauthorized');
  return session.user;
}

async function GET({ request }: { request: Request }) {
  try {
    const user = await currentUser(request);
    const url = new URL(request.url);
    const sessions =
      url.searchParams.get('status') === 'archived'
        ? await codeSessions.listArchivedSessions(user.id)
        : await codeSessions.listSessions(user.id);
    return respData(sessions);
  } catch (error: any) {
    return respErr(error.message || 'Failed to list code sessions');
  }
}

async function POST({ request }: { request: Request }) {
  try {
    const user = await currentUser(request);
    const body = await request.json().catch(() => ({}));
    if (body.preflight === true) {
      const limited = enforceMinIntervalRateLimit(request, {
        intervalMs: 500,
        keyPrefix: 'code-session-preflight',
        extraKey: user.id,
      });
      if (limited) return limited;

      return respData(
        await codeSessions.preflightSessionStart(
          user.id,
          body.agent,
          body.model
        )
      );
    }

    const limited = enforceMinIntervalRateLimit(request, {
      intervalMs: 2000,
      keyPrefix: 'code-session-create',
      extraKey: user.id,
    });
    if (limited) return limited;
    const session = await codeSessions.createSession(
      user.id,
      body.agent,
      body.model
    );
    return respData(session);
  } catch (error: any) {
    if (error instanceof codeSessions.CodeSessionStartError) {
      return respJson(-1, error.message, {
        reason: error.reason,
        ...error.details,
      });
    }
    return respErr(error.message || 'Failed to create code session');
  }
}

export const Route = createFileRoute('/api/code/sessions')({
  server: {
    handlers: { GET, POST },
  },
});
