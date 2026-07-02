import { createFileRoute } from '@tanstack/react-router';

import { getAuth } from '@/core/auth';
import { listEnabledCodeModels } from '@/modules/code/models';
import { respData, respErr } from '@/lib/resp';

async function currentUser(request: Request) {
  const auth = getAuth();
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) throw new Error('Unauthorized');
  return session.user;
}

async function GET({ request }: { request: Request }) {
  try {
    await currentUser(request);
    const { searchParams } = new URL(request.url);
    return respData(await listEnabledCodeModels(searchParams.get('agent')));
  } catch (error: any) {
    return respErr(error.message || 'Failed to list code models');
  }
}

export const Route = createFileRoute('/api/code/models')({
  server: {
    handlers: { GET },
  },
});
