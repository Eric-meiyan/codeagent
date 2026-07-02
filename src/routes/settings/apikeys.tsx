import { useEffect, useState } from 'react';
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import {
  apiDelete,
  apiGet,
  apiPost,
  pageQuery,
  type PageResult,
} from '@/lib/api-client';
import { m } from '@/paraglide/messages.js';
import { DataTable, type Column } from '@/components/data-table';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface ApiKey {
  id: string;
  keyPrefix: string;
  title: string;
  createdAt: string;
}

const PAGE_SIZE = 10;

function ApiKeysPage() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [newKeyName, setNewKeyName] = useState('');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch]);

  const listQuery = useQuery({
    queryKey: ['apikeys', page, debouncedSearch],
    queryFn: () =>
      apiGet<PageResult<ApiKey>>(
        pageQuery('/api/apikeys', {
          page,
          pageSize: PAGE_SIZE,
          search: debouncedSearch,
        })
      ),
    placeholderData: keepPreviousData,
  });

  const createMutation = useMutation({
    mutationFn: (title: string) =>
      apiPost<{ key: string }>('/api/apikeys', { title }),
    onSuccess: async (data) => {
      toast.success(m['settings.apikeys.created']());
      await navigator.clipboard.writeText(data.key);
      toast.info(m['settings.apikeys.key_copied']());
      setOpen(false);
      setNewKeyName('');
      queryClient.invalidateQueries({ queryKey: ['apikeys'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiDelete(`/api/apikeys?id=${id}`),
    onSuccess: () => {
      toast.success(m['settings.apikeys.deleted']());
      queryClient.invalidateQueries({ queryKey: ['apikeys'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function handleCreate() {
    if (!newKeyName.trim()) return;
    createMutation.mutate(newKeyName);
  }

  const columns: Column<ApiKey>[] = [
    {
      header: m['settings.apikeys.name_col'](),
      cell: (k) => <span className="font-medium">{k.title}</span>,
    },
    {
      header: m['settings.apikeys.key_col'](),
      cell: (k) => <span className="font-mono text-xs">{k.keyPrefix}…</span>,
    },
    {
      header: m['settings.apikeys.actions_col'](),
      className: 'w-[100px]',
      cell: (k) => (
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={() => deleteMutation.mutate(k.id)}
          >
            <Trash2 className="size-3" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">
            {m['settings.apikeys.title']()}
          </h1>
          <p className="text-muted-foreground">
            {m['settings.apikeys.description']()}
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger className="bg-primary text-primary-foreground hover:bg-primary/80 inline-flex h-8 items-center justify-center gap-1.5 rounded-lg px-2.5 text-sm font-medium transition-colors">
            <Plus className="size-4" />
            {m['settings.apikeys.create_key']()}
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{m['settings.apikeys.create_title']()}</DialogTitle>
              <DialogDescription>
                {m['settings.apikeys.create_description']()}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2 py-4">
              <Label htmlFor="key-name">
                {m['settings.apikeys.key_name']()}
              </Label>
              <Input
                id="key-name"
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
                placeholder={m['settings.apikeys.key_name_placeholder']()}
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>
                {m['settings.apikeys.cancel']()}
              </Button>
              <Button
                onClick={handleCreate}
                disabled={createMutation.isPending}
              >
                {createMutation.isPending
                  ? m['settings.apikeys.creating']()
                  : m['settings.apikeys.create']()}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardContent>
          <DataTable
            columns={columns}
            data={listQuery.data?.items ?? []}
            total={listQuery.data?.total ?? 0}
            page={page}
            pageSize={PAGE_SIZE}
            onPageChange={setPage}
            rowKey={(k) => k.id}
            emptyText={m['settings.apikeys.no_keys']()}
            search={search}
            onSearchChange={setSearch}
            onRefresh={() => listQuery.refetch()}
            loading={listQuery.isFetching}
          />
        </CardContent>
      </Card>
    </div>
  );
}

export const Route = createFileRoute('/settings/apikeys')({
  component: ApiKeysPage,
});
