# CodeAgent

CodeAgent is a browser-based AI coding workspace for running Claude Code-like agents inside secure cloud sandboxes. The product combines a SaaS control plane with a terminal-first coding workspace: auth, billing, credits, admin settings, `/code` workspace UI, and a path to connect Cloudflare Container runtime spikes.

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
- `/code` workspace shell with sessions, runtime status, terminal, diff, preview, and archive panels
- Auth, billing, credits, API keys, admin settings, CMS, and support modules from the ShipAny TanStack foundation
- Local SQLite schema and RBAC roles initialized
- Legal pages and blog posts rewritten for CodeAgent

## Runtime Path

The runtime integration is expected to build from the verified spike chain in `../spikes/06-integrated-session-mvp`:

```text
Browser xterm.js
-> Worker WebSocket
-> Cloudflare Container
-> PTY / tmux
-> Claude Code-like CLI
-> Platform model gateway
-> Preview proxy and R2 archive/restore
```

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

- Connect `/code` to the Worker/Container terminal WebSocket
- Move preview proxy and archive/restore routes from the integrated spike into the product runtime
- Add production-grade model gateway accounting, limits, retries, and audit logs
- Configure production database, payments, email, storage, and Cloudflare deployment
