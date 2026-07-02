import { createFileRoute } from '@tanstack/react-router';

import { getAuth } from '@/core/auth';
import {
  createCodeModel,
  deleteCodeModel,
  listAdminCodeModels,
  updateCodeModel,
} from '@/modules/code/models';
import { hasPermission } from '@/modules/rbac/service';
import { respData, respErr, respOk, respPage } from '@/lib/resp';

async function checkAdmin(request: Request) {
  const auth = getAuth();
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) throw new Error('Unauthorized');
  const isAdmin = await hasPermission(session.user.id, 'admin.*');
  if (!isAdmin) throw new Error('Forbidden');
  return session;
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
    const result = await listAdminCodeModels({
      page,
      pageSize,
      search: searchParams.get('search'),
    });
    return respPage(result.items, result.total);
  } catch (error: any) {
    return respErr(error.message || 'Failed to list code models');
  }
}

async function POST({ request }: { request: Request }) {
  try {
    await checkAdmin(request);
    const body = await request.json().catch(() => ({}));
    return respData(await createCodeModel(body));
  } catch (error: any) {
    return respErr(error.message || 'Failed to create code model');
  }
}

async function PUT({ request }: { request: Request }) {
  try {
    await checkAdmin(request);
    const body = await request.json().catch(() => ({}));
    if (!body.id) return respErr('ID is required');
    return respData(await updateCodeModel(body.id, body));
  } catch (error: any) {
    return respErr(error.message || 'Failed to update code model');
  }
}

async function DELETE({ request }: { request: Request }) {
  try {
    await checkAdmin(request);
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return respErr('ID is required');
    await deleteCodeModel(id);
    return respOk();
  } catch (error: any) {
    return respErr(error.message || 'Failed to delete code model');
  }
}

export const Route = createFileRoute('/api/admin/code-models')({
  server: {
    handlers: { GET, POST, PUT, DELETE },
  },
});
