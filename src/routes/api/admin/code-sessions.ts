import { createFileRoute } from '@tanstack/react-router';

import { getAuth } from '@/core/auth';
import { listAdminCodeSessions } from '@/modules/code/admin-diagnostics';
import { hasPermission } from '@/modules/rbac/service';
import { respErr, respPage } from '@/lib/resp';

async function checkAdmin(request: Request) {
  const auth = getAuth();
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) throw new Error('Unauthorized');
  const isAdmin = await hasPermission(session.user.id, 'admin.*');
  if (!isAdmin) throw new Error('Forbidden');
}

async function GET({ request }: { request: Request }) {
  try {
    await checkAdmin(request);
    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const pageSize = Math.min(
      100,
      Math.max(1, parseInt(searchParams.get('pageSize') || '10', 10))
    );
    const result = await listAdminCodeSessions({
      page,
      pageSize,
      search: searchParams.get('search'),
      status: searchParams.get('status'),
      agent: searchParams.get('agent'),
    });
    return respPage(result.items, result.total);
  } catch (error: any) {
    return respErr(error.message || 'Failed to list code sessions');
  }
}

export const Route = createFileRoute('/api/admin/code-sessions')({
  server: {
    handlers: { GET },
  },
});
