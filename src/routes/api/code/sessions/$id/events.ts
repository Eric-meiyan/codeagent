import { createFileRoute } from '@tanstack/react-router';

import { getAuth } from '@/core/auth';
import * as codeSessions from '@/modules/code/service';
import { respData, respErr } from '@/lib/resp';

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
    const user = await currentUser(request);
    const url = new URL(request.url);
    const limit = Number.parseInt(url.searchParams.get('limit') || '100', 10);
    return respData(
      await codeSessions.listSessionEvents(user.id, params.id, limit)
    );
  } catch (error: any) {
    return respErr(error.message || 'Code session events failed');
  }
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
    const body = await request.json().catch(() => ({}));
    return respData(
      await codeSessions.recordClientSessionEvent(user.id, params.id, body)
    );
  } catch (error: any) {
    return respErr(error.message || 'Code session event failed');
  }
}

export const Route = createFileRoute('/api/code/sessions/$id/events')({
  server: {
    handlers: { GET, POST },
  },
});
