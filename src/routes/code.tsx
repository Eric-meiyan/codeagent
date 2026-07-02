import { useRef, useState, type ReactNode } from 'react';
import { createFileRoute, redirect } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import {
  Archive,
  Cloud,
  FileDiff,
  Play,
  Plus,
  Terminal,
  type LucideIcon,
} from 'lucide-react';

import '@xterm/xterm/css/xterm.css';

import { Link } from '@/core/i18n/navigation';
import { envConfigs } from '@/config';
import {
  actionUrl,
  generateSessionId,
  previewUrl,
} from '@/modules/code/runtime';
import {
  useTerminalSession,
  type TerminalStatus,
} from '@/modules/code/use-terminal-session';
import { cn } from '@/lib/utils';
import { m } from '@/paraglide/messages.js';
import { Button, buttonVariants } from '@/components/ui/button';

function CodeWorkspacePage() {
  const loader = Route.useLoaderData();
  const [sessionId, setSessionId] = useState(loader.sessionId);
  const terminalRef = useRef<HTMLDivElement | null>(null);
  const { status, reconnect } = useTerminalSession({
    runtimeBase: loader.runtimeBase,
    userId: loader.userId,
    sessionId,
    containerRef: terminalRef,
  });

  const newSession = () => setSessionId(generateSessionId());

  const [actionMsg, setActionMsg] = useState<string>('');
  const [previewNonce, setPreviewNonce] = useState(0);

  const runAction = async (
    label: string,
    url: string,
    method: 'GET' | 'POST'
  ) => {
    setActionMsg(m['code.actions.running']());
    try {
      const res = await fetch(url, { method });
      const payload = await res.json().catch(() => ({ ok: false }));
      if (!res.ok || payload.ok === false) {
        throw new Error(payload.error || res.statusText);
      }
      if (label === 'health') {
        setActionMsg(
          [payload.tmux, payload.claude].filter(Boolean).join(' / ') || 'ok'
        );
      } else if (payload.digest) {
        setActionMsg(`${label}: ${String(payload.digest).slice(0, 12)}…`);
      } else {
        setActionMsg(`${label}: ok`);
      }
    } catch (err) {
      setActionMsg((err as Error).message || 'error');
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

      <main className="mx-auto grid max-w-7xl gap-4 px-4 py-4 sm:px-6 lg:grid-cols-[260px_1fr]">
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
              onClick={newSession}
            >
              <Plus className="size-4" />
            </Button>
          </div>

          <div className="mt-6 space-y-2">
            <div className="bg-muted flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm">
              <span className="bg-primary size-2 rounded-full" />
              <span className="truncate font-mono text-xs">{sessionId}</span>
            </div>
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
                label={m['code.runtime.tmux']()}
                value={m['code.runtime.attached']()}
              />
              <Metric label={m['code.runtime.archive']()} value="R2" />
            </div>
          </div>
        </aside>

        <section className="grid gap-4 xl:grid-cols-[1fr_360px]">
          <div className="border-border bg-card overflow-hidden rounded-lg border">
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
                  onClick={reconnect}
                >
                  {m['code.terminal.reconnect']()}
                </Button>
              </div>
            </div>
            <div className="relative min-h-[520px] bg-[#17130f] p-3">
              <div ref={terminalRef} className="h-[520px] w-full" />
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
                <iframe
                  title="preview"
                  className="h-56 w-full"
                  src={`${previewUrl(loader.runtimeBase, loader.userId, sessionId)}?t=${previewNonce}`}
                />
              </div>
              <Button
                size="sm"
                variant="outline"
                className="mt-3 h-7 rounded-full text-xs"
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
                  onClick={() =>
                    runAction(
                      'health',
                      actionUrl(
                        loader.runtimeBase,
                        'container-health',
                        loader.userId
                      ),
                      'GET'
                    )
                  }
                >
                  {m['code.actions.health']()}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 rounded-full text-xs"
                  onClick={() =>
                    runAction(
                      'archive',
                      actionUrl(
                        loader.runtimeBase,
                        'archive',
                        loader.userId,
                        sessionId
                      ),
                      'POST'
                    )
                  }
                >
                  {m['code.actions.archive']()}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 rounded-full text-xs"
                  onClick={() =>
                    runAction(
                      'restore',
                      actionUrl(
                        loader.runtimeBase,
                        'restore',
                        loader.userId,
                        sessionId
                      ),
                      'POST'
                    )
                  }
                >
                  {m['code.actions.restore']()}
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

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
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
  const { sanitizeUserId, generateSessionId } =
    await import('@/modules/code/runtime');

  const request = getRequest();
  const session = await getAuth().api.getSession({ headers: request.headers });
  if (!session?.user) return null;

  return {
    userId: sanitizeUserId(session.user.id),
    sessionId: generateSessionId(),
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
