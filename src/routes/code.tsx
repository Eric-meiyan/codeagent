import { useRef, useState, type ReactNode } from 'react';
import { createFileRoute, redirect } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import {
  Archive,
  Bot,
  Cloud,
  FileDiff,
  Play,
  Plus,
  Square,
  Terminal,
  type LucideIcon,
} from 'lucide-react';

import '@xterm/xterm/css/xterm.css';

import { Link } from '@/core/i18n/navigation';
import { envConfigs } from '@/config';
import type { CodeModelView } from '@/modules/code/models';
import {
  CODE_SESSION_AGENTS,
  normalizeAgent,
  previewUrl,
  type CodeSessionAgent,
} from '@/modules/code/runtime';
import type { CodeSessionView } from '@/modules/code/service';
import {
  useTerminalSession,
  type TerminalStatus,
} from '@/modules/code/use-terminal-session';
import { apiPost } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { m } from '@/paraglide/messages.js';
import { Button, buttonVariants } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type CodeAction = 'health' | 'archive' | 'restore' | 'end';

interface CodeActionResponse {
  session?: CodeSessionView;
  archive?: Record<string, unknown> | null;
  restore?: Record<string, unknown>;
  clear?: Record<string, unknown>;
  archiveError?: string | null;
  tmux?: string;
  claude?: string;
  codex?: string;
  codexConfigured?: boolean;
  ok?: boolean;
  [key: string]: unknown;
}

interface CodeLoaderData {
  runtimeUserId: string;
  session: CodeSessionView | null;
  sessions: CodeSessionView[];
  models: CodeModelView[];
  runtimeBase: string;
}

function CodeWorkspacePage() {
  const loader = Route.useLoaderData() as CodeLoaderData;
  const initialAgent = loader.session?.agent ?? 'claude';
  const [sessions, setSessions] = useState<CodeSessionView[]>(loader.sessions);
  const [sessionId, setSessionId] = useState<string | null>(
    loader.session?.id ?? null
  );
  const [models] = useState<CodeModelView[]>(loader.models);
  const [selectedAgent, setSelectedAgent] =
    useState<CodeSessionAgent>(initialAgent);
  const [selectedModel, setSelectedModel] = useState<string>(
    loader.session?.model || defaultModelFor(models, initialAgent)?.model || ''
  );
  const [actionMsg, setActionMsg] = useState<string>('');
  const [busyAction, setBusyAction] = useState<string>('');
  const [previewNonce, setPreviewNonce] = useState(0);
  const terminalRef = useRef<HTMLDivElement | null>(null);

  const currentSession =
    sessions.find((session) => session.id === sessionId) ?? null;
  const currentAgent = currentSession?.agent ?? selectedAgent;
  const currentModel = currentSession?.model || selectedModel;
  const availableModels = models.filter(
    (model) => model.agent === selectedAgent
  );
  const canCreateSession = Boolean(selectedModel && availableModels.length);
  const hasSession = Boolean(sessionId);
  const controlsDisabled = !hasSession || Boolean(busyAction);

  const { status, reconnect } = useTerminalSession({
    runtimeBase: loader.runtimeBase,
    userId: loader.runtimeUserId,
    sessionId,
    agent: currentSession?.agent ?? selectedAgent,
    model: currentSession?.model || selectedModel,
    containerRef: terminalRef,
  });

  const newSession = async () => {
    if (!canCreateSession) {
      setActionMsg(m['code.model.configure_required']());
      return;
    }
    setBusyAction('new');
    setActionMsg(m['code.actions.running']());
    try {
      const idsToEnd = sessionId ? [sessionId] : sessions.map((s) => s.id);
      const cleanupErrors: string[] = [];
      for (const id of idsToEnd) {
        try {
          await runSessionAction(id, 'end');
        } catch (error) {
          cleanupErrors.push((error as Error).message || 'cleanup failed');
        }
      }

      const session = await apiPost<CodeSessionView>('/api/code/sessions', {
        agent: selectedAgent,
        model: selectedModel,
      });
      setSessions([session]);
      setSessionId(session.id);
      setSelectedAgent(session.agent);
      setSelectedModel(session.model);
      setPreviewNonce(Date.now());
      const message = `${m['code.actions.started']()}: ${shortId(session.id)}`;
      setActionMsg(
        cleanupErrors.length
          ? `${message} - ${m['code.actions.cleanup_warning']()}`
          : message
      );
    } catch (err) {
      setActionMsg((err as Error).message || 'error');
    } finally {
      setBusyAction('');
    }
  };

  const endCurrentSession = async () => {
    if (!sessionId) return;
    const endingId = sessionId;
    setBusyAction('end');
    setActionMsg(m['code.actions.running']());
    try {
      const payload = await runSessionAction(endingId, 'end');
      setSessions((prev) => prev.filter((session) => session.id !== endingId));
      setSessionId(null);
      setActionMsg(formatActionMessage('end', payload));
    } catch (err) {
      setActionMsg((err as Error).message || 'error');
    } finally {
      setBusyAction('');
    }
  };

  const runAction = async (action: CodeAction) => {
    if (!sessionId) return;
    setBusyAction(action);
    setActionMsg(m['code.actions.running']());
    try {
      const payload = await runSessionAction(sessionId, action);
      if (payload.session) {
        setSessions((prev) => upsertSession(prev, payload.session!));
      }
      setActionMsg(formatActionMessage(action, payload));
    } catch (err) {
      setActionMsg((err as Error).message || 'error');
    } finally {
      setBusyAction('');
    }
  };

  return (
    <div className="bg-background text-foreground min-h-screen">
      <header className="border-border bg-background/90 sticky top-0 z-40 border-b backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5">
            <img
              src={envConfigs.app_logo}
              alt=""
              className="size-7 rounded-[7px]"
            />
            <span className="font-serif text-lg italic">
              {envConfigs.app_name}
            </span>
          </Link>
          <div className="flex items-center gap-2">
            <Link
              href="/settings"
              className={cn(buttonVariants({ size: 'sm' }), 'rounded-full')}
            >
              {m['code.header.settings']()}
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-[1600px] gap-4 px-4 py-4 sm:px-6 lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="border-border bg-card rounded-lg border p-4 lg:min-h-[calc(100vh-6rem)]">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold">
                {m['code.sessions.title']()}
              </p>
              <p className="text-muted-foreground mt-1 text-xs">
                {m['code.sessions.subtitle']()}
              </p>
            </div>
            <Button
              size="icon"
              className="size-8 rounded-full"
              aria-label={m['code.sessions.new']()}
              disabled={Boolean(busyAction) || !canCreateSession}
              onClick={() => void newSession()}
            >
              <Plus className="size-4" />
            </Button>
          </div>

          <div className="mt-5 space-y-2">
            <Label className="text-muted-foreground text-xs">
              {m['code.agent.new_session']()}
            </Label>
            <Select
              value={selectedAgent}
              onValueChange={(value) => {
                const agent = normalizeAgent(value);
                setSelectedAgent(agent);
                setSelectedModel(defaultModelFor(models, agent)?.model || '');
              }}
              disabled={Boolean(busyAction)}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="start">
                {CODE_SESSION_AGENTS.map((agent) => (
                  <SelectItem key={agent} value={agent}>
                    {agentLabel(agent)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="mt-4 space-y-2">
            <Label className="text-muted-foreground text-xs">
              {m['code.model.new_session']()}
            </Label>
            <Select
              value={selectedModel}
              onValueChange={(value) => value && setSelectedModel(value)}
              disabled={Boolean(busyAction) || availableModels.length === 0}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder={m['code.model.select']()} />
              </SelectTrigger>
              <SelectContent align="start">
                {availableModels.map((model) => (
                  <SelectItem key={model.id} value={model.model}>
                    {model.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {availableModels.length === 0 && (
              <p className="text-muted-foreground text-xs">
                {m['code.model.configure_required']()}
              </p>
            )}
          </div>

          <div className="mt-6 space-y-2">
            {sessions.length === 0 && (
              <p className="text-muted-foreground rounded-md border border-dashed px-3 py-2 text-xs">
                {m['code.sessions.empty']()}
              </p>
            )}
            {sessions.map((session) => (
              <button
                key={session.id}
                type="button"
                className={cn(
                  'flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors',
                  session.id === sessionId ? 'bg-muted' : 'hover:bg-muted/70'
                )}
                onClick={() => {
                  setSessionId(session.id);
                  setSelectedAgent(session.agent);
                  setSelectedModel(session.model);
                }}
              >
                <span
                  className={cn(
                    'size-2 rounded-full',
                    session.id === sessionId
                      ? 'bg-primary'
                      : 'bg-muted-foreground'
                  )}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-mono text-xs">
                    {session.id}
                  </span>
                  <span className="text-muted-foreground mt-0.5 flex items-center gap-1 text-[11px]">
                    <Bot className="size-3" />
                    {agentLabel(session.agent)}
                  </span>
                  <span className="text-muted-foreground mt-0.5 block truncate text-[11px]">
                    {modelLabel(models, session)}
                  </span>
                </span>
              </button>
            ))}
          </div>

          <div className="border-border mt-6 rounded-lg border p-3">
            <div className="mb-3 flex items-center gap-2 text-sm font-medium">
              <Cloud className="text-primary size-4" />
              {m['code.runtime.title']()}
            </div>
            <div className="space-y-3 text-xs">
              <Metric
                label={m['code.runtime.sandbox']()}
                value={m['code.runtime.ready']()}
              />
              <Metric
                label={m['code.agent.current']()}
                value={agentLabel(currentAgent)}
              />
              <Metric
                label={m['code.model.current']()}
                value={modelLabel(models, currentModel)}
              />
              <Metric
                label={m['code.runtime.tmux']()}
                value={statusLabel(status)}
              />
              <Metric
                label={m['code.runtime.archive']()}
                value={currentSession?.archiveKey ? 'R2 saved' : 'R2'}
              />
            </div>
          </div>
        </aside>

        <section className="grid min-w-0 gap-4 2xl:grid-cols-[minmax(800px,1fr)_320px]">
          <div className="border-border bg-card min-w-0 overflow-hidden rounded-lg border">
            <div className="border-border bg-background/80 flex items-center justify-between border-b px-4 py-3">
              <div className="flex items-center gap-2">
                <Terminal className="text-muted-foreground size-4" />
                <span className="text-sm font-medium">
                  {m['code.terminal.title']()}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground text-xs">
                  {statusLabel(status)}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 rounded-full text-xs"
                  disabled={!sessionId}
                  onClick={reconnect}
                >
                  {m['code.terminal.reconnect']()}
                </Button>
              </div>
            </div>
            <div className="relative h-[620px] min-h-0 overflow-hidden bg-[#17130f] p-3">
              <div ref={terminalRef} className="h-full min-h-0 w-full" />
              {!sessionId && (
                <div className="absolute inset-0 flex items-center justify-center bg-[#17130f] px-6 text-center text-sm text-[#f4eadf]/70">
                  {m['code.sessions.empty']()}
                </div>
              )}
            </div>
          </div>

          <div className="grid gap-4">
            <Panel
              icon={FileDiff}
              title={m['code.diff.title']()}
              subtitle={m['code.diff.subtitle']()}
            >
              <p className="text-muted-foreground text-xs">
                {m['code.diff.soon']()}
              </p>
            </Panel>

            <Panel
              icon={Play}
              title={m['code.preview.title']()}
              subtitle={m['code.preview.subtitle']()}
            >
              <div className="border-border bg-background overflow-hidden rounded-md border">
                {sessionId ? (
                  <iframe
                    title="preview"
                    className="h-56 w-full"
                    src={`${previewUrl(
                      loader.runtimeBase,
                      loader.runtimeUserId,
                      sessionId
                    )}?t=${previewNonce}`}
                  />
                ) : (
                  <div className="text-muted-foreground flex h-56 items-center justify-center px-4 text-center text-xs">
                    {m['code.preview.empty']()}
                  </div>
                )}
              </div>
              <Button
                size="sm"
                variant="outline"
                className="mt-3 h-7 rounded-full text-xs"
                disabled={!sessionId}
                onClick={() => setPreviewNonce(Date.now())}
              >
                {m['code.actions.refresh_preview']()}
              </Button>
            </Panel>

            <Panel
              icon={Archive}
              title={m['code.archive.title']()}
              subtitle={m['code.archive.subtitle']()}
            >
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 rounded-full text-xs"
                  disabled={controlsDisabled}
                  onClick={() => void runAction('health')}
                >
                  {m['code.actions.health']()}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 rounded-full text-xs"
                  disabled={controlsDisabled}
                  onClick={() => void runAction('archive')}
                >
                  {m['code.actions.archive']()}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 rounded-full text-xs"
                  disabled={controlsDisabled}
                  onClick={() => void runAction('restore')}
                >
                  {m['code.actions.restore']()}
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  className="h-7 rounded-full text-xs"
                  disabled={controlsDisabled}
                  onClick={() => void endCurrentSession()}
                >
                  <Square className="size-3" />
                  {m['code.actions.end']()}
                </Button>
              </div>
              <p className="text-muted-foreground mt-3 min-h-4 font-mono text-xs">
                {actionMsg}
              </p>
            </Panel>
          </div>
        </section>
      </main>
    </div>
  );
}

async function runSessionAction(sessionId: string, action: CodeAction) {
  return apiPost<CodeActionResponse>(
    `/api/code/sessions/${encodeURIComponent(sessionId)}/actions`,
    { action }
  );
}

function upsertSession(sessions: CodeSessionView[], session: CodeSessionView) {
  const rest = sessions.filter((item) => item.id !== session.id);
  if (session.status !== 'active') return rest;
  return [session, ...rest].slice(0, 10);
}

function shortId(sessionId: string) {
  return sessionId.length > 18 ? `${sessionId.slice(0, 18)}...` : sessionId;
}

function formatActionMessage(action: CodeAction, payload: CodeActionResponse) {
  if (action === 'health') {
    return (
      [payload.tmux, payload.claude, payload.codex]
        .filter(Boolean)
        .join(' / ') || 'ok'
    );
  }

  if (action === 'end') {
    return payload.archiveError
      ? `${m['code.actions.ended']()}: ${payload.archiveError}`
      : m['code.actions.ended']();
  }

  const detail =
    action === 'archive'
      ? payload.archive
      : action === 'restore'
        ? payload.restore
        : payload;
  const digest = digestFrom(detail) || digestFrom(payload);

  if (digest) return `${action}: ${digest.slice(0, 12)}...`;
  return `${action}: ok`;
}

function digestFrom(payload: unknown) {
  if (!payload || typeof payload !== 'object') return '';
  const value =
    (payload as Record<string, unknown>).workspaceDigest ||
    (payload as Record<string, unknown>).archiveSha256 ||
    (payload as Record<string, unknown>).digest;
  return typeof value === 'string' ? value : '';
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

function agentLabel(agent: CodeSessionAgent) {
  switch (agent) {
    case 'codex':
      return m['code.agent.codex']();
    case 'claude':
    default:
      return m['code.agent.claude']();
  }
}

function defaultModelFor(models: CodeModelView[], agent: CodeSessionAgent) {
  return (
    models.find((model) => model.agent === agent && model.isDefault) ??
    models.find((model) => model.agent === agent)
  );
}

function modelLabel(
  models: CodeModelView[],
  value: CodeSessionView | string | null | undefined
) {
  const modelId = typeof value === 'string' ? value : value?.model || '';
  if (!modelId) return m['code.model.unselected']();
  const model = models.find((item) => item.model === modelId);
  return model?.label || modelId;
}

function statusLabel(status: TerminalStatus): string {
  switch (status) {
    case 'connecting':
      return m['code.terminal.connecting']();
    case 'connected':
      return m['code.terminal.connected']();
    case 'error':
      return m['code.terminal.error']();
    case 'closed':
      return m['code.terminal.closed']();
    default:
      return m['code.terminal.idle']();
  }
}

function Panel({
  icon: Icon,
  title,
  subtitle,
  children,
}: {
  icon: LucideIcon;
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <div className="border-border bg-card rounded-lg border p-4">
      <div className="mb-4 flex items-start gap-3">
        <div className="bg-muted text-foreground flex size-9 shrink-0 items-center justify-center rounded-md">
          <Icon className="size-4" />
        </div>
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          <p className="text-muted-foreground mt-1 text-xs leading-5">
            {subtitle}
          </p>
        </div>
      </div>
      {children}
    </div>
  );
}

const getCodeSession = createServerFn().handler(async () => {
  const { getRequest } = await import('@tanstack/react-start/server');
  const { getAuth } = await import('@/core/auth');
  const { listSessions } = await import('@/modules/code/service');
  const { listEnabledCodeModels } = await import('@/modules/code/models');
  const { sanitizeUserId } = await import('@/modules/code/runtime');

  const request = getRequest();
  const session = await getAuth().api.getSession({ headers: request.headers });
  if (!session?.user) return null;

  const sessions = await listSessions(session.user.id);
  const activeSession = sessions[0] ?? null;
  const models = await listEnabledCodeModels();

  return {
    runtimeUserId:
      activeSession?.runtimeUserId ?? sanitizeUserId(session.user.id),
    session: activeSession,
    sessions,
    models,
  };
});

export const Route = createFileRoute('/code')({
  loader: async () => {
    const session = await getCodeSession();
    if (!session) {
      throw redirect({ to: '/sign-in' });
    }
    return {
      ...session,
      runtimeBase: envConfigs.runtime_base_url,
    };
  },
  component: CodeWorkspacePage,
});
