import { createFileRoute } from '@tanstack/react-router';

import { getAuth } from '@/core/auth';
import { envConfigs } from '@/config';
import { normalizeAgent, terminalHttpUrl } from '@/modules/code/runtime';
import * as codeSessions from '@/modules/code/service';

async function currentUser(request: Request) {
  const auth = getAuth();
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) throw new Error('Unauthorized');
  return session.user;
}

async function GET({
  request,
  params,
}: {
  request: Request;
  params: { id: string };
}) {
  try {
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Expected WebSocket upgrade', { status: 426 });
    }

    const user = await currentUser(request);
    const session = await codeSessions.getOwnedSession(user.id, params.id);
    if (!session || session.status !== 'active') {
      return new Response('Session not found', { status: 404 });
    }

    const headers = new Headers(request.headers);
    headers.delete('cookie');
    headers.delete('host');

    return fetch(
      terminalHttpUrl(
        envConfigs.runtime_base_url,
        session.runtimeUserId,
        session.id,
        normalizeAgent(session.agent),
        session.model
      ),
      {
        method: 'GET',
        headers,
      }
    );
  } catch (error: any) {
    const message = error?.message || 'Terminal proxy failed';
    const status = message === 'Unauthorized' ? 401 : 500;
    return new Response(message, { status });
  }
}

export const Route = createFileRoute('/api/code/sessions/$id/terminal')({
  server: {
    handlers: { GET },
  },
});
