import { useEffect, useState } from 'react';
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { AlertTriangle, CircleCheck, Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { m } from '@/core/i18n/messages';
import {
  hasConfiguredModelTokenCosts,
  type CodeModelView,
} from '@/modules/code/models';
import {
  CODE_SESSION_AGENTS,
  normalizeAgent,
  type CodeSessionAgent,
} from '@/modules/code/runtime';
import {
  apiDelete,
  ApiError,
  apiGet,
  apiPost,
  apiPut,
  type PageResult,
} from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { DataTable, type Column } from '@/components/data-table';
import { Badge } from '@/components/ui/badge';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';

const PAGE_SIZE = 10;

interface CodeModelForm {
  agent: CodeSessionAgent;
  provider: string;
  model: string;
  label: string;
  baseUrl: string;
  description: string;
  inputTokenCostCreditsPer1m: number;
  outputTokenCostCreditsPer1m: number;
  cachedInputTokenCostCreditsPer1m: number;
  billingMultiplier: number;
  enabled: boolean;
  isDefault: boolean;
  sort: number;
}

const emptyForm: CodeModelForm = {
  agent: 'claude',
  provider: 'yunwu',
  model: '',
  label: '',
  baseUrl: defaultBaseUrl('claude'),
  description: '',
  inputTokenCostCreditsPer1m: 0,
  outputTokenCostCreditsPer1m: 0,
  cachedInputTokenCostCreditsPer1m: 0,
  billingMultiplier: 200,
  enabled: true,
  isDefault: false,
  sort: 10,
};

function CodeModelsPage() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState<CodeModelForm>(emptyForm);
  const [editingModel, setEditingModel] = useState<CodeModelView | null>(null);
  const [editForm, setEditForm] = useState<CodeModelForm>(emptyForm);
  const [deletingModel, setDeletingModel] = useState<CodeModelView | null>(
    null
  );

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch]);

  const query = useQuery({
    queryKey: ['admin-code-models', page, debouncedSearch],
    queryFn: () => {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(PAGE_SIZE),
      });
      if (debouncedSearch) params.set('search', debouncedSearch);
      return apiGet<PageResult<CodeModelView>>(
        `/api/admin/code-models?${params}`
      );
    },
    placeholderData: keepPreviousData,
  });

  const models = query.data?.items ?? [];
  const total = query.data?.total ?? 0;

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['admin-code-models'] });

  const createMutation = useMutation({
    mutationFn: (values: CodeModelForm) =>
      apiPost<CodeModelView>('/api/admin/code-models', values),
    onSuccess: () => {
      toast.success(m['admin.code_models.created']());
      setCreateOpen(false);
      setForm(emptyForm);
      invalidate();
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : 'Failed');
    },
  });

  const editMutation = useMutation({
    mutationFn: (payload: { id: string } & CodeModelForm) =>
      apiPut<CodeModelView>('/api/admin/code-models', payload),
    onSuccess: () => {
      toast.success(m['admin.code_models.updated']());
      setEditingModel(null);
      invalidate();
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : 'Failed');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      apiDelete(`/api/admin/code-models?id=${encodeURIComponent(id)}`),
    onSuccess: () => {
      toast.success(m['admin.code_models.deleted']());
      setDeletingModel(null);
      invalidate();
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : 'Failed');
    },
  });

  const saving = createMutation.isPending || editMutation.isPending;

  function handleCreate() {
    if (!form.model.trim() || !form.label.trim()) return;
    if (form.enabled && !hasConfiguredModelTokenCosts(form)) {
      toast.error(m['admin.code_models.cost_required_error']());
      return;
    }
    createMutation.mutate(form);
  }

  function openEdit(model: CodeModelView) {
    setEditForm({
      agent: model.agent,
      provider: model.provider,
      model: model.model,
      label: model.label,
      baseUrl: model.baseUrl,
      description: model.description,
      inputTokenCostCreditsPer1m: model.inputTokenCostCreditsPer1m,
      outputTokenCostCreditsPer1m: model.outputTokenCostCreditsPer1m,
      cachedInputTokenCostCreditsPer1m: model.cachedInputTokenCostCreditsPer1m,
      billingMultiplier: model.billingMultiplier,
      enabled: model.enabled,
      isDefault: model.isDefault,
      sort: model.sort,
    });
    setEditingModel(model);
  }

  function handleEdit() {
    if (!editingModel || !editForm.model.trim() || !editForm.label.trim()) {
      return;
    }
    if (editForm.enabled && !hasConfiguredModelTokenCosts(editForm)) {
      toast.error(m['admin.code_models.cost_required_error']());
      return;
    }
    editMutation.mutate({ id: editingModel.id, ...editForm });
  }

  const columns: Column<CodeModelView>[] = [
    {
      header: m['admin.code_models.model_col'](),
      cell: (model) => (
        <div className="min-w-[220px]">
          <p className="font-medium">{model.label}</p>
          <p className="text-muted-foreground mt-1 font-mono text-xs">
            {model.model}
          </p>
        </div>
      ),
    },
    {
      header: m['admin.code_models.agent_col'](),
      cell: (model) => agentLabel(model.agent),
    },
    {
      header: m['admin.code_models.provider_col'](),
      cell: (model) => (
        <div className="min-w-[180px]">
          <p className="font-medium">{model.provider}</p>
          <p className="text-muted-foreground mt-1 truncate text-xs">
            {model.baseUrl}
          </p>
        </div>
      ),
    },
    {
      header: m['admin.code_models.status_col'](),
      cell: (model) => (
        <div className="flex flex-wrap gap-1.5">
          {model.enabled ? (
            <Badge>{m['admin.code_models.enabled_badge']()}</Badge>
          ) : (
            <Badge variant="outline">
              {m['admin.code_models.disabled_badge']()}
            </Badge>
          )}
          {model.isDefault && (
            <Badge variant="secondary">
              {m['admin.code_models.default_badge']()}
            </Badge>
          )}
        </div>
      ),
    },
    {
      header: m['admin.code_models.billing_col'](),
      cell: (model) => (
        <div className="min-w-[180px] text-xs leading-5">
          <div className="text-muted-foreground font-mono">
            <p>in {model.inputTokenCostCreditsPer1m}/1M</p>
            <p>out {model.outputTokenCostCreditsPer1m}/1M</p>
            <p>cache {model.cachedInputTokenCostCreditsPer1m}/1M</p>
            <p>x{(model.billingMultiplier / 100).toFixed(2)}</p>
          </div>
          <Badge
            variant={
              hasConfiguredModelTokenCosts(model) ? 'secondary' : 'outline'
            }
            className="mt-1.5 gap-1"
          >
            {hasConfiguredModelTokenCosts(model) ? (
              <CircleCheck className="size-3" />
            ) : (
              <AlertTriangle className="text-destructive size-3" />
            )}
            {hasConfiguredModelTokenCosts(model)
              ? m['admin.code_models.cost_ready']()
              : m['admin.code_models.cost_missing']()}
          </Badge>
        </div>
      ),
    },
    {
      header: m['admin.code_models.sort_col'](),
      className: 'w-[80px]',
      cell: (model) => model.sort,
    },
    {
      header: m['admin.code_models.actions_col'](),
      className: 'w-[90px]',
      cell: (model) => (
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={() => openEdit(model)}
            aria-label={m['admin.code_models.edit_title']()}
          >
            <Pencil className="size-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={() => setDeletingModel(model)}
            aria-label={m['admin.code_models.delete_title']()}
          >
            <Trash2 className="size-3" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">
            {m['admin.code_models.title']()}
          </h1>
          <p className="text-muted-foreground">
            {m['admin.code_models.description']()}
          </p>
          <p className="text-muted-foreground mt-1 text-sm">
            {m['admin.code_models.count']({ count: total })}
          </p>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger className="bg-primary text-primary-foreground hover:bg-primary/80 inline-flex h-8 items-center justify-center gap-1.5 rounded-lg px-2.5 text-sm font-medium transition-colors">
            <Plus className="size-4" />
            {m['admin.code_models.create_model']()}
          </DialogTrigger>
          <DialogContent className="sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>{m['admin.code_models.create_title']()}</DialogTitle>
              <DialogDescription>
                {m['admin.code_models.create_description']()}
              </DialogDescription>
            </DialogHeader>
            {renderFormFields(form, setForm)}
            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateOpen(false)}>
                {m['admin.code_models.cancel']()}
              </Button>
              <Button onClick={handleCreate} disabled={saving}>
                {m['admin.code_models.save']()}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardContent>
          <DataTable
            columns={columns}
            data={models}
            total={total}
            page={page}
            pageSize={PAGE_SIZE}
            onPageChange={setPage}
            rowKey={(model) => model.id}
            emptyText={m['admin.code_models.no_models']()}
            search={search}
            searchPlaceholder={m['admin.code_models.search_placeholder']()}
            onSearchChange={setSearch}
            onRefresh={() => query.refetch()}
            loading={query.isFetching}
          />
        </CardContent>
      </Card>

      <Dialog
        open={!!editingModel}
        onOpenChange={(open) => !open && setEditingModel(null)}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{m['admin.code_models.edit_title']()}</DialogTitle>
            <DialogDescription>
              {m['admin.code_models.edit_description']()}
            </DialogDescription>
          </DialogHeader>
          {renderFormFields(editForm, setEditForm)}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingModel(null)}>
              {m['admin.code_models.cancel']()}
            </Button>
            <Button onClick={handleEdit} disabled={saving}>
              {m['admin.code_models.save']()}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!deletingModel}
        onOpenChange={(open) => !open && setDeletingModel(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{m['admin.code_models.delete_title']()}</DialogTitle>
            <DialogDescription>
              {m['admin.code_models.delete_confirm']()}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeletingModel(null)}>
              {m['admin.code_models.cancel']()}
            </Button>
            <Button
              variant="destructive"
              onClick={() =>
                deletingModel && deleteMutation.mutate(deletingModel.id)
              }
            >
              {m['admin.code_models.confirm_delete']()}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function renderFormFields(
  values: CodeModelForm,
  onChange: (values: CodeModelForm) => void
) {
  const costsReady = hasConfiguredModelTokenCosts(values);

  function setAgent(value: CodeSessionAgent | null) {
    if (!value) return;
    const agent = normalizeAgent(value);
    onChange({
      ...values,
      agent,
      baseUrl:
        values.baseUrl === defaultBaseUrl(values.agent)
          ? defaultBaseUrl(agent)
          : values.baseUrl,
    });
  }

  return (
    <div className="grid gap-4 py-4 sm:grid-cols-2">
      <div
        className={cn(
          'rounded-md border px-3 py-3 text-sm sm:col-span-2',
          costsReady
            ? 'border-border bg-muted/40'
            : 'border-destructive/40 bg-destructive/5'
        )}
      >
        <div className="flex items-start gap-2">
          {costsReady ? (
            <CircleCheck className="text-primary mt-0.5 size-4 shrink-0" />
          ) : (
            <AlertTriangle className="text-destructive mt-0.5 size-4 shrink-0" />
          )}
          <div>
            <p className="font-medium">
              {costsReady
                ? m['admin.code_models.cost_ready']()
                : m['admin.code_models.cost_missing']()}
            </p>
            <p className="text-muted-foreground mt-1 leading-5">
              {m['admin.code_models.cost_guide']()}
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <Label>{m['admin.code_models.agent_field']()}</Label>
        <Select value={values.agent} onValueChange={setAgent}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CODE_SESSION_AGENTS.map((agent) => (
              <SelectItem key={agent} value={agent}>
                {agentLabel(agent)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label>{m['admin.code_models.provider_field']()}</Label>
        <Input
          value={values.provider}
          onChange={(event) =>
            onChange({ ...values, provider: event.target.value })
          }
          placeholder="yunwu"
        />
      </div>

      <div className="space-y-2">
        <Label>{m['admin.code_models.label_field']()}</Label>
        <Input
          value={values.label}
          onChange={(event) =>
            onChange({ ...values, label: event.target.value })
          }
          placeholder={m['admin.code_models.label_placeholder']()}
        />
      </div>

      <div className="space-y-2">
        <Label>{m['admin.code_models.model_field']()}</Label>
        <Input
          value={values.model}
          onChange={(event) =>
            onChange({ ...values, model: event.target.value })
          }
          placeholder={m['admin.code_models.model_placeholder']()}
        />
      </div>

      <div className="space-y-2 sm:col-span-2">
        <Label>{m['admin.code_models.base_url_field']()}</Label>
        <Input
          value={values.baseUrl}
          onChange={(event) =>
            onChange({ ...values, baseUrl: event.target.value })
          }
          placeholder={defaultBaseUrl(values.agent)}
        />
      </div>

      <div className="space-y-2">
        <Label>{m['admin.code_models.sort_field']()}</Label>
        <Input
          type="number"
          value={values.sort}
          onChange={(event) =>
            onChange({ ...values, sort: Number(event.target.value) || 0 })
          }
        />
      </div>

      <div className="space-y-2">
        <Label>{m['admin.code_models.input_cost_field']()}</Label>
        <Input
          type="number"
          min={0}
          value={values.inputTokenCostCreditsPer1m}
          onChange={(event) =>
            onChange({
              ...values,
              inputTokenCostCreditsPer1m: Number(event.target.value) || 0,
            })
          }
          placeholder="0"
        />
      </div>

      <div className="space-y-2">
        <Label>{m['admin.code_models.output_cost_field']()}</Label>
        <Input
          type="number"
          min={0}
          value={values.outputTokenCostCreditsPer1m}
          onChange={(event) =>
            onChange({
              ...values,
              outputTokenCostCreditsPer1m: Number(event.target.value) || 0,
            })
          }
          placeholder="0"
        />
      </div>

      <div className="space-y-2">
        <Label>{m['admin.code_models.cached_input_cost_field']()}</Label>
        <Input
          type="number"
          min={0}
          value={values.cachedInputTokenCostCreditsPer1m}
          onChange={(event) =>
            onChange({
              ...values,
              cachedInputTokenCostCreditsPer1m: Number(event.target.value) || 0,
            })
          }
          placeholder="0"
        />
      </div>

      <div className="space-y-2">
        <Label>{m['admin.code_models.multiplier_field']()}</Label>
        <Input
          type="number"
          min={1}
          value={values.billingMultiplier}
          onChange={(event) =>
            onChange({
              ...values,
              billingMultiplier: Number(event.target.value) || 200,
            })
          }
          placeholder="200"
        />
      </div>

      <div className="grid grid-cols-2 gap-4 pt-7">
        <label className="flex items-center gap-2 text-sm">
          <Switch
            checked={values.enabled}
            onCheckedChange={(checked) =>
              onChange({ ...values, enabled: checked })
            }
          />
          {m['admin.code_models.enabled_field']()}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <Switch
            checked={values.isDefault}
            onCheckedChange={(checked) =>
              onChange({ ...values, isDefault: checked })
            }
          />
          {m['admin.code_models.default_field']()}
        </label>
      </div>

      <div className="space-y-2 sm:col-span-2">
        <Label>{m['admin.code_models.description_field']()}</Label>
        <Textarea
          value={values.description}
          onChange={(event) =>
            onChange({ ...values, description: event.target.value })
          }
          rows={3}
        />
      </div>
    </div>
  );
}

function agentLabel(agent: CodeSessionAgent) {
  return agent === 'codex' ? m['code.agent.codex']() : m['code.agent.claude']();
}

function defaultBaseUrl(agent: CodeSessionAgent) {
  return agent === 'codex' ? 'https://yunwu.ai/v1' : 'https://yunwu.ai';
}

export const Route = createFileRoute('/admin/code-models')({
  component: CodeModelsPage,
});
