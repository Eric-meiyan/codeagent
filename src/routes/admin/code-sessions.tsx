import { useEffect, useState, type ReactNode } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { Activity, AlertTriangle, Archive, Coins, Eye } from 'lucide-react';

import { m } from '@/core/i18n/messages';
import { apiGet, type PageResult } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { DataTable, type Column } from '@/components/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';

const PAGE_SIZE = 10;

const STATUS_FILTERS = [
  'all',
  'active',
  'suspended',
  'ended',
  'error',
] as const;
const AGENT_FILTERS = ['all', 'claude', 'codex'] as const;

type StatusFilter = (typeof STATUS_FILTERS)[number];
type AgentFilter = (typeof AGENT_FILTERS)[number];

interface SessionEvent {
  id: string;
  eventType: string;
  severity: 'info' | 'warn' | 'error' | string;
  source: string;
  message: string;
  metadata: unknown;
  createdAt: string | null;
}

interface BillingEvent {
  id: string;
  eventType: string;
  provider: string;
  endpoint: string;
  upstreamStatus: number;
  requestId: string;
  runtimeState: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  durationSeconds: number;
  rawCostCredits: number;
  chargedCredits: number;
  billingMultiplier: number;
  creditId: string;
  status: string;
  description: string;
  metadata: unknown;
  rawUsage: unknown;
  createdAt: string | null;
}

interface BillingSummary {
  total: number;
  chargedCredits: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  durationSeconds: number;
  latest: BillingEvent | null;
}

interface EventSummary {
  total: number;
  issues: number;
  latest: SessionEvent | null;
}

interface AdminCodeSession {
  id: string;
  userId: string;
  userEmail: string | null;
  userName: string | null;
  runtimeUserId: string;
  agent: string;
  model: string;
  status: string;
  title: string;
  archiveKey: string | null;
  archiveDigest: string | null;
  lastBilledAt: string | null;
  billedCredits: number;
  lastActiveAt: string | null;
  endedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  eventSummary: EventSummary;
  billingSummary: BillingSummary;
}

interface AdminCodeSessionDetail {
  session: AdminCodeSession;
  eventSummary: EventSummary;
  billingSummary: BillingSummary;
  events: SessionEvent[];
  billingEvents: BillingEvent[];
}

function CodeSessionsPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [agent, setAgent] = useState<AgentFilter>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    setPage(1);
  }, [status, agent, debouncedSearch]);

  const query = useQuery({
    queryKey: ['admin-code-sessions', page, status, agent, debouncedSearch],
    queryFn: () => {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(PAGE_SIZE),
      });
      if (status !== 'all') params.set('status', status);
      if (agent !== 'all') params.set('agent', agent);
      if (debouncedSearch) params.set('search', debouncedSearch);
      return apiGet<PageResult<AdminCodeSession>>(
        `/api/admin/code-sessions?${params}`
      );
    },
    placeholderData: keepPreviousData,
  });

  const detailQuery = useQuery({
    queryKey: ['admin-code-session-detail', selectedId],
    queryFn: () =>
      apiGet<AdminCodeSessionDetail>(
        `/api/admin/code-sessions/${encodeURIComponent(selectedId || '')}`
      ),
    enabled: !!selectedId,
  });

  const sessions = query.data?.items ?? [];
  const total = query.data?.total ?? 0;

  const columns: Column<AdminCodeSession>[] = [
    {
      header: m['admin.code_sessions.session_col'](),
      cell: (session) => (
        <div className="min-w-[230px]">
          <p className="font-mono text-xs font-medium">{session.id}</p>
          <p className="text-muted-foreground mt-1 truncate text-xs">
            {session.runtimeUserId}
          </p>
        </div>
      ),
    },
    {
      header: m['admin.code_sessions.user_col'](),
      cell: (session) => (
        <div className="min-w-[180px]">
          <p className="truncate text-sm font-medium">
            {session.userEmail || session.userId}
          </p>
          <p className="text-muted-foreground mt-1 truncate text-xs">
            {session.userName || session.userId}
          </p>
        </div>
      ),
    },
    {
      header: m['admin.code_sessions.runtime_col'](),
      cell: (session) => (
        <div className="min-w-[160px]">
          <p className="text-sm font-medium">{agentLabel(session.agent)}</p>
          <p className="text-muted-foreground mt-1 truncate text-xs">
            {session.model || '—'}
          </p>
        </div>
      ),
    },
    {
      header: m['admin.code_sessions.status_col'](),
      cell: (session) => <StatusBadge status={session.status} />,
    },
    {
      header: m['admin.code_sessions.archive_col'](),
      cell: (session) => (
        <div className="min-w-[120px]">
          {session.archiveKey ? (
            <>
              <Badge variant="secondary">
                {m['admin.code_sessions.archive_ready']()}
              </Badge>
              <p className="text-muted-foreground mt-1 max-w-[150px] truncate font-mono text-xs">
                {session.archiveDigest || session.archiveKey}
              </p>
            </>
          ) : (
            <Badge variant="outline">
              {m['admin.code_sessions.archive_empty']()}
            </Badge>
          )}
        </div>
      ),
    },
    {
      header: m['admin.code_sessions.events_col'](),
      cell: (session) => (
        <div className="min-w-[140px] text-sm">
          <p>
            {m['admin.code_sessions.events_count']({
              count: session.eventSummary.total,
            })}
          </p>
          <p
            className={cn(
              'mt-1 text-xs',
              session.eventSummary.issues
                ? 'text-destructive'
                : 'text-muted-foreground'
            )}
          >
            {m['admin.code_sessions.issues_count']({
              count: session.eventSummary.issues,
            })}
          </p>
        </div>
      ),
    },
    {
      header: m['admin.code_sessions.billing_col'](),
      cell: (session) => (
        <div className="min-w-[150px] text-sm">
          <p>
            {m['admin.code_sessions.credits_count']({
              count: session.billingSummary.chargedCredits,
            })}
          </p>
          <p className="text-muted-foreground mt-1 text-xs">
            {m['admin.code_sessions.billing_events_count']({
              count: session.billingSummary.total,
            })}
          </p>
        </div>
      ),
    },
    {
      header: m['admin.code_sessions.last_event_col'](),
      cell: (session) => (
        <div className="min-w-[220px]">
          {session.eventSummary.latest ? (
            <>
              <p className="truncate text-sm">
                {session.eventSummary.latest.eventType}
              </p>
              <p className="text-muted-foreground mt-1 truncate text-xs">
                {session.eventSummary.latest.message ||
                  formatDate(session.eventSummary.latest.createdAt)}
              </p>
            </>
          ) : (
            <span className="text-muted-foreground text-sm">—</span>
          )}
        </div>
      ),
    },
    {
      header: m['admin.code_sessions.updated_col'](),
      cell: (session) => (
        <span className="text-muted-foreground text-sm">
          {formatDate(session.updatedAt)}
        </span>
      ),
    },
    {
      header: m['admin.code_sessions.actions_col'](),
      className: 'w-[90px]',
      cell: (session) => (
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          onClick={() => setSelectedId(session.id)}
          aria-label={m['admin.code_sessions.view_detail']()}
        >
          <Eye className="size-4" />
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">
          {m['admin.code_sessions.title']()}
        </h1>
        <p className="text-muted-foreground">
          {m['admin.code_sessions.description']()}
        </p>
      </div>

      <Card>
        <CardContent>
          <DataTable
            columns={columns}
            data={sessions}
            total={total}
            page={page}
            pageSize={PAGE_SIZE}
            onPageChange={setPage}
            rowKey={(session) => session.id}
            emptyText={m['admin.code_sessions.no_sessions']()}
            search={search}
            searchPlaceholder={m['admin.code_sessions.search_placeholder']()}
            onSearchChange={setSearch}
            toolbar={
              <div className="flex flex-wrap items-center gap-2">
                <Select
                  value={status}
                  onValueChange={(value) => setStatus(value as StatusFilter)}
                >
                  <SelectTrigger className="w-36">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent align="start">
                    {STATUS_FILTERS.map((item) => (
                      <SelectItem key={item} value={item}>
                        {statusFilterLabel(item)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={agent}
                  onValueChange={(value) => setAgent(value as AgentFilter)}
                >
                  <SelectTrigger className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent align="start">
                    {AGENT_FILTERS.map((item) => (
                      <SelectItem key={item} value={item}>
                        {agentFilterLabel(item)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            }
            onRefresh={() => query.refetch()}
            loading={query.isFetching}
          />
        </CardContent>
      </Card>

      <SessionDetailSheet
        open={!!selectedId}
        onOpenChange={(open) => !open && setSelectedId(null)}
        detail={detailQuery.data}
        loading={detailQuery.isFetching}
      />
    </div>
  );
}

function SessionDetailSheet({
  open,
  onOpenChange,
  detail,
  loading,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  detail?: AdminCodeSessionDetail;
  loading: boolean;
}) {
  const session = detail?.session;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-3xl">
        <SheetHeader>
          <SheetTitle>{m['admin.code_sessions.detail_title']()}</SheetTitle>
          <SheetDescription>
            {session?.id || m['admin.code_sessions.detail_loading']()}
          </SheetDescription>
        </SheetHeader>

        {loading && !detail ? (
          <div className="text-muted-foreground px-4 text-sm">
            {m['admin.code_sessions.detail_loading']()}
          </div>
        ) : detail && session ? (
          <div className="space-y-5 px-4 pb-6">
            <div className="grid gap-3 md:grid-cols-3">
              <SummaryCard
                icon={<Activity className="size-4" />}
                label={m['admin.code_sessions.status_col']()}
                value={statusLabel(session.status)}
                subValue={agentLabel(session.agent)}
              />
              <SummaryCard
                icon={<AlertTriangle className="size-4" />}
                label={m['admin.code_sessions.events_col']()}
                value={String(detail.eventSummary.total)}
                subValue={m['admin.code_sessions.issues_count']({
                  count: detail.eventSummary.issues,
                })}
                danger={detail.eventSummary.issues > 0}
              />
              <SummaryCard
                icon={<Coins className="size-4" />}
                label={m['admin.code_sessions.billing_col']()}
                value={String(detail.billingSummary.chargedCredits)}
                subValue={m['admin.code_sessions.billing_events_count']({
                  count: detail.billingSummary.total,
                })}
              />
            </div>

            <section className="space-y-3">
              <h2 className="text-sm font-semibold">
                {m['admin.code_sessions.session_info']()}
              </h2>
              <div className="grid gap-x-5 gap-y-2 text-sm md:grid-cols-2">
                <DetailRow label={m['admin.code_sessions.user_col']()}>
                  {session.userEmail || session.userId}
                </DetailRow>
                <DetailRow label="Runtime user">
                  {session.runtimeUserId}
                </DetailRow>
                <DetailRow label={m['admin.code_sessions.runtime_col']()}>
                  {agentLabel(session.agent)} · {session.model || '—'}
                </DetailRow>
                <DetailRow label={m['admin.code_sessions.created_col']()}>
                  {formatDate(session.createdAt)}
                </DetailRow>
                <DetailRow label={m['admin.code_sessions.last_active_col']()}>
                  {formatDate(session.lastActiveAt)}
                </DetailRow>
                <DetailRow label={m['admin.code_sessions.updated_col']()}>
                  {formatDate(session.updatedAt)}
                </DetailRow>
              </div>
              {session.archiveKey && (
                <div className="bg-muted/40 rounded-md p-3 text-sm">
                  <div className="mb-1 flex items-center gap-2 font-medium">
                    <Archive className="size-4" />
                    {m['admin.code_sessions.archive_col']()}
                  </div>
                  <p className="text-muted-foreground font-mono text-xs break-all">
                    {session.archiveKey}
                  </p>
                  {session.archiveDigest && (
                    <p className="text-muted-foreground mt-1 font-mono text-xs break-all">
                      {session.archiveDigest}
                    </p>
                  )}
                </div>
              )}
            </section>

            <Separator />

            <section className="space-y-3">
              <h2 className="text-sm font-semibold">
                {m['admin.code_sessions.timeline']()}
              </h2>
              {detail.events.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  {m['admin.code_sessions.no_events']()}
                </p>
              ) : (
                <div className="space-y-3">
                  {detail.events.map((event) => (
                    <EventItem key={event.id} event={event} />
                  ))}
                </div>
              )}
            </section>

            <Separator />

            <section className="space-y-3">
              <h2 className="text-sm font-semibold">
                {m['admin.code_sessions.billing_events']()}
              </h2>
              {detail.billingEvents.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  {m['admin.code_sessions.no_billing_events']()}
                </p>
              ) : (
                <div className="space-y-3">
                  {detail.billingEvents.map((event) => (
                    <BillingItem key={event.id} event={event} />
                  ))}
                </div>
              )}
            </section>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function SummaryCard({
  icon,
  label,
  value,
  subValue,
  danger,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  subValue: string;
  danger?: boolean;
}) {
  return (
    <div className="border-border rounded-lg border p-3">
      <div className="text-muted-foreground mb-2 flex items-center gap-2 text-xs">
        {icon}
        {label}
      </div>
      <p className={cn('text-lg font-semibold', danger && 'text-destructive')}>
        {value}
      </p>
      <p className="text-muted-foreground mt-1 text-xs">{subValue}</p>
    </div>
  );
}

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div>
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className="mt-1 break-words">{children || '—'}</p>
    </div>
  );
}

function EventItem({ event }: { event: SessionEvent }) {
  return (
    <div className="border-border rounded-lg border p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <SeverityBadge severity={event.severity} />
            <span className="font-mono text-xs font-medium">
              {event.eventType}
            </span>
            <span className="text-muted-foreground text-xs">
              {event.source}
            </span>
          </div>
          {event.message && <p className="mt-2 text-sm">{event.message}</p>}
        </div>
        <span className="text-muted-foreground shrink-0 text-xs">
          {formatDate(event.createdAt)}
        </span>
      </div>
      {hasMetadata(event.metadata) && (
        <pre className="bg-muted/50 text-muted-foreground mt-3 max-h-36 overflow-auto rounded-md p-2 text-xs">
          {jsonPreview(event.metadata)}
        </pre>
      )}
    </div>
  );
}

function BillingItem({ event }: { event: BillingEvent }) {
  return (
    <div className="border-border rounded-lg border p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{event.status}</Badge>
            <span className="font-mono text-xs font-medium">
              {event.eventType}
            </span>
            {event.provider && (
              <span className="text-muted-foreground text-xs">
                {event.provider}
              </span>
            )}
          </div>
          <p className="mt-2 text-sm">
            {m['admin.code_sessions.credits_count']({
              count: event.chargedCredits,
            })}
            {' · '}
            {m['admin.code_sessions.tokens_summary']({
              input: event.inputTokens,
              output: event.outputTokens,
            })}
          </p>
          {event.description && (
            <p className="text-muted-foreground mt-1 text-xs">
              {event.description}
            </p>
          )}
        </div>
        <span className="text-muted-foreground shrink-0 text-xs">
          {formatDate(event.createdAt)}
        </span>
      </div>
      {(hasMetadata(event.metadata) || hasMetadata(event.rawUsage)) && (
        <pre className="bg-muted/50 text-muted-foreground mt-3 max-h-36 overflow-auto rounded-md p-2 text-xs">
          {jsonPreview({
            metadata: event.metadata,
            rawUsage: event.rawUsage,
            requestId: event.requestId,
            endpoint: event.endpoint,
            upstreamStatus: event.upstreamStatus,
          })}
        </pre>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const label = statusLabel(status);
  if (status === 'active') return <Badge>{label}</Badge>;
  if (status === 'error') {
    return (
      <Badge variant="destructive" className="gap-1">
        <AlertTriangle className="size-3" />
        {label}
      </Badge>
    );
  }
  if (status === 'suspended') return <Badge variant="secondary">{label}</Badge>;
  return <Badge variant="outline">{label}</Badge>;
}

function SeverityBadge({ severity }: { severity: string }) {
  if (severity === 'error') {
    return <Badge variant="destructive">{severity}</Badge>;
  }
  if (severity === 'warn') {
    return (
      <Badge
        variant="secondary"
        className="bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200"
      >
        {severity}
      </Badge>
    );
  }
  return <Badge variant="outline">{severity || 'info'}</Badge>;
}

function statusFilterLabel(status: StatusFilter) {
  if (status === 'all') return m['admin.code_sessions.filter_all_status']();
  return statusLabel(status);
}

function agentFilterLabel(agent: AgentFilter) {
  if (agent === 'all') return m['admin.code_sessions.filter_all_agents']();
  return agentLabel(agent);
}

function statusLabel(status: string) {
  switch (status) {
    case 'active':
      return m['admin.code_sessions.status_active']();
    case 'suspended':
      return m['admin.code_sessions.status_suspended']();
    case 'ended':
      return m['admin.code_sessions.status_ended']();
    case 'error':
      return m['admin.code_sessions.status_error']();
    default:
      return status || '—';
  }
}

function agentLabel(agent: string) {
  if (agent === 'codex') return 'Codex CLI';
  if (agent === 'claude') return 'Claude Code';
  return agent || '—';
}

function formatDate(value: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function hasMetadata(value: unknown) {
  if (!value) return false;
  if (typeof value === 'string') return value.length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
}

function jsonPreview(value: unknown) {
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2);
}

export const Route = createFileRoute('/admin/code-sessions')({
  component: CodeSessionsPage,
});
