# hicode

hicode is a browser-based AI coding workspace for running Claude Code and Codex inside secure cloud workspaces. The product combines a SaaS control plane with a terminal-first coding workspace: auth, billing, credits, admin settings, `/code` workspace UI, and a Cloudflare Container runtime path for terminal agents, previews, archive, and restore.

## Quick Start

```bash
pnpm install
cp .env.example .env.development
pnpm db:setup
pnpm db:push
pnpm rbac:init --admin-email=eric.wuyu1352@gmail.com
pnpm dev
```

Local development defaults to SQLite at `data/local.db`. Production URL is configured as `https://hicode.run`.

## Current Scope

- Landing page based on the `cconline.sh` visual structure
- `/code` workspace shell with agent/model selection, active sessions, archived sessions, terminal, preview, runtime status, and archive/restore actions
- Cloudflare Container runtime integration for terminal WebSocket, tmux-backed Claude Code / Codex CLI sessions, preview proxy, and R2 workspace archive/restore
- D1 session event tracking for session lifecycle, terminal connection events, archive/restore, inspect, and failure diagnosis
- Auth, billing, credits, API keys, admin settings, CMS, and support modules from the ShipAny TanStack foundation
- Local SQLite schema and RBAC roles initialized
- Legal pages and blog posts rewritten for hicode

## Runtime Path

The runtime integration now lives in `packages/runtime`:

```text
Browser xterm.js
-> Worker WebSocket
-> Cloudflare Container
-> PTY / tmux
-> Claude Code / Codex CLI
-> Platform model gateway
-> Preview proxy and R2 archive/restore
```

Runtime commands are exposed from the root package:

| Command                      | Description                                         |
| ---------------------------- | --------------------------------------------------- |
| `pnpm runtime:check`         | Type-check the runtime Worker                       |
| `pnpm runtime:vendor`        | Download exact CLI tarballs for container builds    |
| `pnpm runtime:deploy`        | Deploy Worker + rebuild Cloudflare Container        |
| `pnpm runtime:deploy:worker` | Deploy only Worker code, skipping container rebuild |
| `pnpm runtime:smoke`         | Run the runtime remote smoke test                   |

## Commands

| Command          | Description                                                  |
| ---------------- | ------------------------------------------------------------ |
| `pnpm dev`       | Start the Vite dev server on port 3000                       |
| `pnpm build`     | Production build                                             |
| `pnpm start`     | Run the production server                                    |
| `pnpm db:setup`  | Generate `src/config/db/schema.ts` from the selected dialect |
| `pnpm db:push`   | Push schema to the development database                      |
| `pnpm rbac:init` | Initialize roles and permissions                             |

## Next Work

- Reduce automatic archive event noise. The current workspace auto-archive runs while a terminal is connected and records every successful archive event; next pass should record only failures, first archive, digest changes, or a summarized heartbeat.
- Add an admin/debug view for `code_session_event` so session failures can be inspected without direct D1 queries.
- Move the production runtime endpoint from the legacy workers.dev spike URL to a first-class hicode subdomain.
- Add production-grade model gateway accounting, limits, retries, audit logs, and BYOK support.
- Formalize D1 migration tracking. `/drizzle/` is currently ignored; SQL needed for production schema changes is mirrored under `docs/sql/` until the migration workflow is made explicit.
