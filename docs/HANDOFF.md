# hicode — Handoff / Continuation Doc

_Last updated: 2026-07-11. For an agent picking up this project cold._

## 1. What this project is

hicode = a web app where a logged-in user opens `/code` and drives a **real
Claude Code CLI running in a Cloudflare cloud sandbox**, streamed to the browser
via xterm.js over WebSocket. Domain (target): **hicode.run**. Product brief:
`/Users/apple/Documents/codegit/codeagent/claude-code-like-system-PRD.md`.

Two independent codebases:

| Piece                       | Path                                                                       | Role                                                                                                                                  |
| --------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| **Product app** (this repo) | `/Users/apple/Documents/codegit/hicode-run/codeagent/app`                  | TanStack Start (React 19) SaaS on Cloudflare Workers. Landing, auth, admin, `/code`. Built from `shipany-tanstack` template.          |
| **Runtime**                 | `/Users/apple/Documents/codegit/hicode-run/codeagent/app/packages/runtime` | Separate Cloudflare Worker + Container that runs tmux + Claude Code / Codex, exposes terminal WS / preview / archive / model-gateway. |

The two are **separate Cloudflare Workers**. The browser connects to the runtime
**directly** (WS + fetch + iframe); the app only gates login, generates ids, and
hands down the runtime URL.

## 2. Live state (deployed)

- **App (production):** https://codeagent.eric-wuyu1352.workers.dev — LIVE, D1-backed.
- **Runtime:** https://codeagent-spike-integrated-session-mvp.eric-wuyu1352.workers.dev — LIVE. Source is now versioned under `packages/runtime`; Worker name is still legacy to keep the production URL stable. Model gateway upstream = third-party `yunwu.ai`.
- **Cloudflare account:** `0ac42fe7fefbdae2e03a45c990af7e55` (eric.wuyu1352@gmail.com). `wrangler` is logged in.
- **D1:** `codeagent-db` (id `55c4ba3a-b07e-47d1-910b-77a3ccfe983d`, APAC), binding **`DB`**. Schema applied, RBAC seeded (4 roles / 29 perms / 34 maps).
- **Worker:** `codeagent`. Secrets set: `AUTH_SECRET`, `CONFIG_ENCRYPTION_KEY` (generated, not stored in repo).
- **Admin:** `eric.wuyu1352@gmail.com` = `super_admin` (user self-signed-up, then promoted via SQL). `/admin` for the console.
- **Git:** `origin` = https://github.com/Eric-meiyan/codeagent , `main` pushed & in sync. `upstream` = the shipany-tanstack template.

## 3. What has been built (round 1: real terminal closed loop)

`/code` went from a static mockup to a working closed loop. Verified in a real
browser: login-gated, terminal connects to the live runtime, streams Claude Code,
accepts input, correct layout, preview/health/archive actions hit real endpoints.

Design + plan (committed, read these first for round-1 rationale):

- Spec: `docs/superpowers/specs/2026-07-02-runtime-terminal-integration-design.md`
- Plan: `docs/superpowers/plans/2026-07-02-runtime-terminal-integration.md`

Key files added/changed:

- `src/modules/code/runtime.ts` — pure helpers: `sanitizeUserId`, `generateSessionId`, `terminalWsUrl`, `actionUrl`, `previewUrl` (+ `runtime.test.ts`, run via `pnpm exec tsx`).
- `src/modules/code/use-terminal-session.ts` — xterm + WebSocket hook (client-only, dynamic import).
- `src/routes/code.tsx` — auth-gated loader (`getCodeSession` server fn → `{userId, sessionId, runtimeBase}`; redirects to `/sign-in` if unauth) + the real terminal UI.
- `src/config/index.ts` — added `runtime_base_url` (public `VITE_RUNTIME_BASE_URL`).
- `messages/en.json` + `messages/zh.json` — `code.*` i18n.

Post-launch browser-smoke fixes (all merged to main):

- `9ae0736` auto-focus terminal (`term.focus()`) — input was dead without it.
- `4e3a638` ResizeObserver on the container — layout was garbled (PTY dims drifted from xterm's real size).
- `9451180` review cleanups (stale-WS-status guard, orphan i18n keys, health msg).

## 4. Critical facts / gotchas (read before touching runtime code)

- **Runtime WS protocol (frozen — must match verbatim):** connect `wss://<runtime>/terminal/:user/:session`, `binaryType='arraybuffer'`; incoming string→`term.write(string)`, binary→`term.write(new Uint8Array(data))`; send input `{type:'input',data}`, resize `{type:'resize',cols,rows}` as JSON. Actions: `GET /container-health/:user`, `POST /archive|restore|seed/:user/:session`, preview iframe `GET /preview/:user/:session/`. Runtime sets CORS `*` on JSON, so the browser talks to it directly (no app proxy).
- **Runtime PTY init size is hardcoded 30×120** in `container/server.py` (`set_winsize(master_fd, 30, 120)`); it honors resize frames via `TIOCSWINSZ`. This is why the ResizeObserver fix matters.
- **Gitignored deploy artifacts (NOT in git, exist locally):** app `wrangler.jsonc` (has D1 id + prod URL + `VITE_RUNTIME_BASE_URL`), `.env.production`, `drizzle/` migrations. Runtime `packages/runtime/wrangler.jsonc` is tracked because it contains no secrets and is needed for deployment.
- **Secrets** live in `wrangler secret` (AUTH_SECRET, CONFIG_ENCRYPTION_KEY), never in the repo. Don't ask the user to paste passwords; for admin, use sign-up-then-promote.
- **No test framework** in the app. Pure functions are checked via `pnpm exec tsx <file>.test.ts`; everything else via `pnpm build` + browser. Verified in this project via `pnpm build` + `pnpm format:check` + live curl smoke.
- **Round-1 auth posture (deferred to round 2):** the runtime `/terminal` has **no token auth** — anyone with the URL + a session id can spawn a container. Round 1 relies on page login + unguessable server-generated `sessionId`.

## 5. THE open problem (highest-value next work): session accumulation

Symptom seen live: after several "new session" clicks, new Claude launches **hang
at `[starting claude]`**. Root cause (proven — a brand-new user id starts Claude
in <1s): the runtime is **one container per user** (`getByName(userId)`), each
`sessionId` spawns its own ~240MB Claude+tmux, and **nothing ever reaps them** →
container resource exhaustion. NOT a client bug; NOT the model gateway (both healthy).

Recommended fix (matches the PRD's "session destroyed when done"), layered:

1. **D1 session table** (`session_id, user_id, status, last_active_at, container_ref`) + **per-user active-session cap**; `/code` "new session" should reuse/list, not blindly spawn.
2. **Teardown = archive→R2 then kill tmux+Claude** (runtime already has `kill_tmux`, UI never calls it) on: explicit "end session", WS disconnect + grace, and an **idle reaper via a Cloudflare Cron Trigger** on the app Worker.
3. **Container granularity — the big lever:** move toward **one sandbox per session, destroyed on end** (structurally kills accumulation, matches PRD). Alternative: keep per-user containers + hard cap + LRU eviction. Either way the **runtime must return a clear "at capacity" error instead of hanging** (backpressure).

This is the recommended next round. It's already in the round-1 spec's "leftovers".

## 6. Other deferred items

- Attach **hicode.run** custom domain: `pnpm exec` the `deploy-cloudflare` skill with `--domain=hicode.run` (needs the zone added to this Cloudflare account first). Currently on workers.dev.
- **R2 storage** for image uploads (admin → Settings → Storage) — local-disk fallback doesn't work on Workers.
- Stripe / OAuth (Google) — not configured.
- Diff panel in `/code` is a placeholder ("coming in a later release").
- `sanitizeUserId` is lossy (collision → shared container namespace) — fine for random better-auth ids, revisit with token auth.

## 7. How to re-deploy (idempotent)

The template ships a **`deploy-cloudflare` skill** at `.claude/skills/deploy-cloudflare/SKILL.md`
— read it; it's the authoritative runbook. Re-running is safe/idempotent: it
auto-skips existing D1/secrets/RBAC and just rebuilds+redeploys. Manual path:
`pnpm cf:deploy` (sources `.env.production` → `NITRO_PRESET=cloudflare_module vite build` → `wrangler deploy`).

Runtime deploy:

- `pnpm runtime:check`
- `pnpm runtime:vendor` if `packages/runtime/container/vendor/*.tgz` is missing
- `pnpm runtime:deploy` when rebuilding the container image
- `pnpm runtime:deploy:worker` when only Worker code changed
  Gotcha hit during first deploy: the RBAC "local-sqlite dump dance" — the real local
  D1 file is the hashed `.sqlite` (25 tables), NOT `metadata.sqlite`; find it by
  checking for a `role` table.

## 8. Durable records

- **Working ledger** (gitignored scratch, detailed step log): `.superpowers/sdd/progress.md` — read this for the blow-by-blow of round 1 + fixes + deploy.
- Specs/plans: `docs/superpowers/specs/`, `docs/superpowers/plans/`.
- This file: `docs/HANDOFF.md`.

## 9. Process used (so you can continue the same way)

Superpowers skills: `brainstorming` → `writing-plans` → `subagent-driven-development`
(fresh implementer + task reviewer per task, whole-branch review at the end) →
`finishing-a-development-branch`. `systematic-debugging` for the browser-smoke bugs.
Branch per unit of work, `--no-ff` merge to `main`, push. Recommended next: run
`brainstorming` on the session-lifecycle problem (§5), decide container granularity,
then spec → plan → execute.
