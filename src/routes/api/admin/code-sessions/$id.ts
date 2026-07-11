import { createFileRoute } from '@tanstack/react-router';

import { getAuth } from '@/core/auth';
import { getAdminCodeSessionDetail } from '@/modules/code/admin-diagnostics';
import { hasPermission } from '@/modules/rbac/service';
import { respData, respErr } from '@/lib/resp';

async function checkAdmin(request: Request) {
  const auth = getAuth();
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) throw new Error('Unauthorized');
  const isAdmin = await hasPermission(session.user.id, 'admin.*');
  if (!isAdmin) throw new Error('Forbidden');
}

async function GET({
  request,
  params,
}: {
  request: Request;
  params: { id: string };
}) {
  try {
    await checkAdmin(request);
    const { searchParams } = new URL(request.url);
    const eventLimit = parseInt(searchParams.get('eventLimit') || '120', 10);
    const billingLimit = parseInt(searchParams.get('billingLimit') || '80', 10);
    return respData(
      await getAdminCodeSessionDetail(params.id, { eventLimit, billingLimit })
    );
  } catch (error: any) {
    return respErr(error.message || 'Failed to load code session');
  }
}

export const Route = createFileRoute('/api/admin/code-sessions/$id')({
  server: {
    handlers: { GET },
  },
});
