import type { ReactNode } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import {
  Archive,
  CheckCircle2,
  Cloud,
  FileDiff,
  Gauge,
  Play,
  Plus,
  Terminal,
  type LucideIcon,
} from 'lucide-react';

import { Link } from '@/core/i18n/navigation';
import { envConfigs } from '@/config';
import { cn } from '@/lib/utils';
import { m } from '@/paraglide/messages.js';
import { Button, buttonVariants } from '@/components/ui/button';

function CodeWorkspacePage() {
  const sessions = [
    m['code.sessions.current'](),
    m['code.sessions.preview'](),
    m['code.sessions.archive'](),
  ];

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
            >
              <Plus className="size-4" />
            </Button>
          </div>

          <div className="mt-6 space-y-2">
            {sessions.map((session, index) => (
              <button
                key={session}
                className="hover:bg-muted flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors"
              >
                <span
                  className={
                    index === 0
                      ? 'bg-primary size-2 rounded-full'
                      : 'bg-muted-foreground/30 size-2 rounded-full'
                  }
                />
                <span className="truncate">{session}</span>
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
              <span className="text-muted-foreground text-xs">
                {m['code.terminal.status']()}
              </span>
            </div>
            <div className="min-h-[520px] bg-[#17130f] p-5 font-mono text-sm leading-7 text-[#f4eadf]">
              <p className="text-[#d9603a]">
                $ codeagent start --session current
              </p>
              <p>{m['code.terminal.line_1']()}</p>
              <p className="mt-4 text-[#9ee493]">
                <CheckCircle2 className="mr-2 inline size-4" />
                {m['code.terminal.line_2']()}
              </p>
              <p className="text-[#9ee493]">
                <CheckCircle2 className="mr-2 inline size-4" />
                {m['code.terminal.line_3']()}
              </p>
              <p className="text-[#9ee493]">
                <CheckCircle2 className="mr-2 inline size-4" />
                {m['code.terminal.line_4']()}
              </p>
              <p className="mt-4 text-[#f3c98b]">
                {m['code.terminal.line_5']()}
              </p>
              <p className="mt-6 text-[#f4eadf]/70">▌</p>
            </div>
          </div>

          <div className="grid gap-4">
            <Panel
              icon={FileDiff}
              title={m['code.diff.title']()}
              subtitle={m['code.diff.subtitle']()}
            >
              <div className="bg-muted/50 rounded-md p-3 font-mono text-xs leading-6">
                <p className="text-emerald-700">+ app/routes/code.tsx</p>
                <p className="text-emerald-700">+ terminal websocket hook</p>
                <p className="text-muted-foreground"> pnpm build</p>
                <p className="text-emerald-700">+ production bundle ready</p>
              </div>
            </Panel>

            <Panel
              icon={Play}
              title={m['code.preview.title']()}
              subtitle={m['code.preview.subtitle']()}
            >
              <div className="border-border bg-background rounded-md border p-3">
                <div className="bg-primary/80 h-3 w-24 rounded-full" />
                <div className="mt-4 grid grid-cols-3 gap-2">
                  <div className="bg-muted h-14 rounded-md" />
                  <div className="bg-muted h-14 rounded-md" />
                  <div className="bg-muted h-14 rounded-md" />
                </div>
              </div>
            </Panel>

            <Panel
              icon={Archive}
              title={m['code.archive.title']()}
              subtitle={m['code.archive.subtitle']()}
            >
              <div className="flex items-center gap-3 text-sm">
                <Gauge className="text-primary size-5" />
                <div>
                  <p className="font-medium">{m['code.archive.digest']()}</p>
                  <p className="text-muted-foreground text-xs">
                    workspaces/demo/current/workspace.tar.gz
                  </p>
                </div>
              </div>
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

export const Route = createFileRoute('/code')({
  component: CodeWorkspacePage,
});
