import {
  CheckCircle2,
  Cloud,
  Code2,
  FileText,
  Play,
  Sparkles,
  Terminal,
} from 'lucide-react';

import { Link } from '@/core/i18n/navigation';
import { envConfigs } from '@/config';
import { cn } from '@/lib/utils';
import { m } from '@/paraglide/messages.js';
import { DotPattern } from '@/components/ui/dot-pattern';

export function Hero() {
  const recentSessions = [
    m['landing.hero.preview_session_1'](),
    m['landing.hero.preview_session_2'](),
  ];

  return (
    <section className="relative isolate flex flex-col items-center justify-center overflow-hidden px-4 pt-24 pb-16 sm:pt-34 sm:pb-24">
      <DotPattern
        className={cn(
          '[mask-image:radial-gradient(ellipse_at_center,white,transparent_75%)]',
          'text-foreground/15'
        )}
      />
      <div className="relative mx-auto w-full max-w-6xl text-center">
        <h1 className="text-foreground mx-auto max-w-5xl font-serif text-5xl leading-[1.05] font-normal tracking-tight sm:text-6xl lg:text-[5.25rem]">
          {m['landing.hero.headline']()}
        </h1>
        <p className="text-muted-foreground mx-auto mt-8 max-w-2xl text-lg leading-relaxed sm:text-xl">
          {m['landing.hero.subheadline']()}
        </p>

        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            href="/code?new=1"
            className="bg-primary text-primary-foreground inline-flex h-13 w-full items-center justify-center gap-2 rounded-full px-8 text-base font-semibold shadow-sm transition-transform hover:-translate-y-0.5 hover:shadow-md sm:w-auto"
          >
            <Sparkles className="size-4" />
            {m['landing.hero.cta']()}
          </Link>
          <Link
            href="/pricing"
            className="border-border bg-background text-foreground hover:border-foreground/30 hover:bg-muted inline-flex h-13 w-full items-center justify-center gap-2 rounded-full border px-8 text-base font-semibold transition-colors sm:w-auto"
          >
            {m['landing.hero.secondary']()}
          </Link>
        </div>

        <div className="relative mx-auto mt-18 w-full max-w-5xl">
          <div className="from-primary/15 via-primary/5 absolute inset-x-10 -top-8 h-24 rounded-full bg-gradient-to-r to-transparent blur-3xl" />
          <div className="border-border/70 bg-card/90 relative overflow-hidden rounded-[1.5rem] border shadow-[0_24px_80px_rgba(40,32,24,0.12)]">
            <div className="border-border/70 bg-background/80 flex items-center justify-between border-b px-4 py-3 text-left">
              <div className="flex items-center gap-2">
                <img
                  src={envConfigs.app_logo}
                  alt=""
                  className="size-6 rounded-md"
                />
                <span className="font-serif text-sm italic">
                  {envConfigs.app_name}
                </span>
              </div>
              <div className="text-muted-foreground hidden items-center gap-2 text-xs sm:flex">
                <Cloud className="size-3.5" />
                <span>{m['landing.hero.preview_status']()}</span>
              </div>
            </div>

            <div className="grid min-h-[420px] grid-cols-1 text-left lg:grid-cols-[220px_1fr]">
              <aside className="border-border/70 bg-muted/30 hidden border-r p-4 lg:block">
                <button className="text-foreground flex items-center gap-2 text-sm font-medium">
                  <Code2 className="size-4" />
                  {m['landing.hero.preview_new_session']()}
                </button>
                <div className="mt-8 space-y-2">
                  <p className="text-muted-foreground text-xs">
                    {m['landing.hero.preview_recent']()}
                  </p>
                  {recentSessions.map((label) => (
                    <div
                      key={label}
                      className="bg-background/70 flex items-center gap-2 rounded-lg px-3 py-2 text-sm"
                    >
                      <span className="bg-primary size-1.5 rounded-full" />
                      {label}
                    </div>
                  ))}
                </div>
              </aside>

              <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px]">
                <div className="flex min-w-0 flex-col">
                  <div className="border-border/70 flex items-center gap-2 border-b px-4 py-3">
                    <Terminal className="text-muted-foreground size-4" />
                    <span className="text-sm font-medium">
                      {m['landing.hero.preview_terminal']()}
                    </span>
                  </div>
                  <div className="bg-[#17130f] p-4 font-mono text-[13px] leading-6 text-[#f4eadf] sm:p-6">
                    <p className="text-[#d9603a]">$ codeagent run</p>
                    <p>{m['landing.hero.preview_command']()}</p>
                    <p className="mt-4 text-[#9ee493]">
                      <CheckCircle2 className="mr-2 inline size-4" />
                      {m['landing.hero.preview_step_1']()}
                    </p>
                    <p className="text-[#9ee493]">
                      <CheckCircle2 className="mr-2 inline size-4" />
                      {m['landing.hero.preview_step_2']()}
                    </p>
                    <p className="text-[#9ee493]">
                      <CheckCircle2 className="mr-2 inline size-4" />
                      {m['landing.hero.preview_step_3']()}
                    </p>
                    <p className="mt-4 text-[#f3c98b]">
                      {m['landing.hero.preview_output']()}
                    </p>
                  </div>
                </div>

                <div className="border-border/70 bg-background hidden border-l p-4 lg:block">
                  <div className="mb-4 flex items-center gap-2">
                    <FileText className="text-muted-foreground size-4" />
                    <span className="text-sm font-medium">
                      {m['landing.hero.preview_file']()}
                    </span>
                  </div>
                  <div className="border-border bg-card rounded-xl border p-3 text-xs">
                    <div className="text-muted-foreground mb-3 flex items-center justify-between">
                      <span>app/page.tsx</span>
                      <span>+42</span>
                    </div>
                    <div className="space-y-1 font-mono">
                      <p className="text-emerald-700">
                        + export function App()
                      </p>
                      <p className="text-emerald-700">
                        + &nbsp;return &lt;Preview /&gt;
                      </p>
                      <p className="text-muted-foreground"> npm test</p>
                      <p className="text-emerald-700">+ tests passed</p>
                    </div>
                  </div>
                  <div className="border-border bg-card mt-4 rounded-xl border p-3">
                    <div className="mb-3 flex items-center gap-2 text-sm font-medium">
                      <Play className="text-primary size-4" />
                      {m['landing.hero.preview_live']()}
                    </div>
                    <div className="bg-muted h-24 rounded-lg p-3">
                      <div className="bg-primary/80 h-3 w-20 rounded-full" />
                      <div className="mt-4 grid grid-cols-3 gap-2">
                        <div className="bg-background h-10 rounded-md" />
                        <div className="bg-background h-10 rounded-md" />
                        <div className="bg-background h-10 rounded-md" />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
