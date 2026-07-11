# hicode Runtime

This is the Cloudflare Worker + Container runtime used by hicode's `/code`
workspace. It runs terminal agents inside Cloudflare Containers and exposes the
terminal WebSocket, preview proxy, R2 archive/restore actions, and model gateway.

The Cloudflare Worker name is still `codeagent-spike-integrated-session-mvp` to
keep the existing production URL stable. The source now lives in the app repo as
a first-class package.

## Runtime Chain

```text
Worker
-> session-named Cloudflare Container
-> tmux session
-> Claude Code / Codex CLI
-> platform model gateway
-> preview proxy
-> R2 archive / clear / restore
```

## Commands

```sh
pnpm install
pnpm run vendor:fetch
pnpm run check
pnpm run deploy
pnpm run smoke
```

`pnpm run deploy` rebuilds the configured Cloudflare Container and needs Docker
running locally. If only `src/index.ts` changed and the container image did not,
use:

```sh
pnpm run deploy:worker
```

That deploys the Worker with `--containers-rollout=none` and skips Docker.

## Vendor Packages

The container image needs exact CLI packages for Claude Code and Codex. They are
large third-party binary tarballs, so they are intentionally not committed.
Restore them with:

```sh
pnpm run vendor:fetch
```

This downloads:

- `@anthropic-ai/claude-code-linux-x64@2.1.197`
- `@anthropic-ai/claude-code-linux-arm64@2.1.197`
- `@openai/codex@0.39.0`

## Secrets

Required Cloudflare Worker secrets:

- `ANTHROPIC_API_KEY`
- `BILLING_USAGE_WEBHOOK_SECRET`

`BILLING_USAGE_WEBHOOK_SECRET` must match the app D1 `config` row with
`name = 'billing_usage_webhook_secret'`.

## Routes

```text
/terminal/:user/:session
/preview/:user/:session/*
/seed/:user/:session
/inspect/:user/:session
/archive/:user/:session
/clear/:user/:session
/restore/:user/:session
/tmux/:user/:session
/api/model/v1/messages
/api/model/v1/responses
/api/model/v1/chat/completions
```
