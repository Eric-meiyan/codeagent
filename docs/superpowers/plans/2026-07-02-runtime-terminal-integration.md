# CodeAgent 运行时终端集成 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `/code` 页面从静态 mockup 变成能在浏览器里真正启动云端会话、流式操作 Claude Code 终端的闭环，直连现有已部署的 spike 06 运行时。

**Architecture:** 独立运行时 Worker 拓扑。产品 app（TanStack Start Worker）只负责登录门禁、服务端派生 `userId` + 生成不可猜 `sessionId`、下发运行时配置；浏览器 xterm.js 直连运行时 `/terminal/:user/:session` WebSocket 做流式 PTY，动作/预览端点也直连（运行时已开 CORS）。不修改 spike 代码。

**Tech Stack:** TanStack Start 1.168 (React 19)、better-auth、`@xterm/xterm` + `@xterm/addon-fit`、Cloudflare（运行时为独立 spike Worker）、paraglide i18n、prettier。

## Global Constraints

- 运行时端点默认值（verbatim）：`https://codeagent-spike-integrated-session-mvp.eric-wuyu1352.workers.dev`
- 运行时 WebSocket 协议**严格复用不可改**：`binaryType="arraybuffer"`；收到 string → `term.write(string)`，收到 binary → `term.write(new Uint8Array(data))`；发输入 `JSON.stringify({type:"input",data})`；发 resize `JSON.stringify({type:"resize",cols,rows})`。
- 终端路径 `/terminal/:user/:session`；动作 `GET /container-health/:user`、`POST /seed|archive|restore/:user/:session`；预览 `GET /preview/:user/:session/`。
- 公开给浏览器的 env 用 `VITE_` 前缀（`publicEnv`）；服务端秘密不加 `VITE_`。
- 不修改 `spikes/06-integrated-session-mvp/` 任何文件。
- 不引入测试框架；纯函数用 `tsx` + `node:assert` 跑断言，集成部分用 `pnpm build` + 浏览器验证（沿用仓库既有验证方式）。
- 全程 `pnpm format:check` 必须通过；提交由 husky+lint-staged 自动 prettier。
- 分支：`feat/runtime-terminal-integration`（已创建，spec 已提交）。

---

## File Structure

- `src/config/index.ts` — 修改：新增 `runtime_base_url` 公开配置字段。
- `.env.example` / `.env.development` — 修改：新增 `VITE_RUNTIME_BASE_URL`。
- `src/modules/code/runtime.ts` — 新建：纯函数（sanitize/生成 id/构造 URL），无 DOM 依赖。
- `src/modules/code/runtime.test.ts` — 新建：`tsx` 可跑的 `node:assert` 断言。
- `src/modules/code/use-terminal-session.ts` — 新建：客户端 xterm + WebSocket hook。
- `src/routes/code.tsx` — 修改：loader（鉴权+派生 id+下发配置）+ 重写组件接真实终端/预览/动作。
- `messages/en.json` / `messages/zh.json` — 修改：`code.*` 文案改为真实状态标签。
- `package.json` — 修改：新增 `@xterm/xterm`、`@xterm/addon-fit` 依赖。

---

## Task 1: 运行时配置与环境变量

**Files:**

- Modify: `src/config/index.ts`
- Modify: `.env.example`
- Modify: `.env.development`

**Interfaces:**

- Produces: `envConfigs.runtime_base_url: string`（后续 loader 消费）。

- [ ] **Step 1: 在 config 增加字段**

在 `src/config/index.ts` 的 `envConfigs` 对象里，紧跟 `app_logo` 那一组 App 公开变量之后加入：

```ts
  // Runtime (public — browser connects directly)
  runtime_base_url:
    publicEnv('VITE_RUNTIME_BASE_URL') ??
    'https://codeagent-spike-integrated-session-mvp.eric-wuyu1352.workers.dev',
```

- [ ] **Step 2: 补 .env.example**

在 `.env.example` 中 App 变量区块末尾追加一行：

```
# Runtime Worker base URL (spike 06 deployment). Public — browser connects directly.
VITE_RUNTIME_BASE_URL=https://codeagent-spike-integrated-session-mvp.eric-wuyu1352.workers.dev
```

- [ ] **Step 3: 补 .env.development**

在 `.env.development` 中同样追加相同两行（值相同）。

- [ ] **Step 4: 验证读取正确**

Run: `cd /Users/apple/Documents/codegit/hicode-run/codeagent/app && pnpm exec tsx -e "import('./src/config/index.ts').then(m=>console.log(m.envConfigs.runtime_base_url))"`
Expected: 打印 `https://codeagent-spike-integrated-session-mvp.eric-wuyu1352.workers.dev`（或你 .env.development 里配置的值）。

- [ ] **Step 5: 提交**

```bash
cd /Users/apple/Documents/codegit/hicode-run/codeagent/app
git add src/config/index.ts .env.example .env.development
git commit -m "feat(code): add runtime_base_url config"
```

---

## Task 2: 运行时纯函数模块（TDD）

**Files:**

- Create: `src/modules/code/runtime.ts`
- Create: `src/modules/code/runtime.test.ts`

**Interfaces:**

- Produces:
  - `sanitizeUserId(raw: string): string` — 小写、非 `[a-z0-9-]` 转 `-`、折叠连续 `-`、去首尾 `-`；空则返回 `'user'`。
  - `generateSessionId(): string` — 形如 `s-<base36时间>-<随机>`，全匹配 `/^[a-z0-9-]+$/`，两次调用不同。
  - `terminalWsUrl(base: string, userId: string, sessionId: string): string` — `https→wss`、`http→ws`，路径 `/terminal/:user/:session`（对段做 encodeURIComponent）。
  - `actionUrl(base: string, action: string, userId: string, sessionId?: string): string` — `base/action/:user[/:session]`。
  - `previewUrl(base: string, userId: string, sessionId: string): string` — `base/preview/:user/:session/`。

- [ ] **Step 1: 写失败测试**

创建 `src/modules/code/runtime.test.ts`：

```ts
import assert from 'node:assert/strict';

import {
  actionUrl,
  generateSessionId,
  previewUrl,
  sanitizeUserId,
  terminalWsUrl,
} from './runtime.ts';

// sanitizeUserId
assert.equal(sanitizeUserId('User_123!@#'), 'user-123');
assert.equal(sanitizeUserId('  --Ab--  '), 'ab');
assert.equal(sanitizeUserId(''), 'user');
assert.equal(sanitizeUserId('已经abc'), 'abc');

// generateSessionId
const a = generateSessionId();
const b = generateSessionId();
assert.match(a, /^[a-z0-9-]+$/);
assert.notEqual(a, b);

// terminalWsUrl
assert.equal(
  terminalWsUrl('https://rt.example.dev', 'u1', 's1'),
  'wss://rt.example.dev/terminal/u1/s1'
);
assert.equal(
  terminalWsUrl('http://localhost:8787', 'u1', 's1'),
  'ws://localhost:8787/terminal/u1/s1'
);

// actionUrl
assert.equal(
  actionUrl('https://rt.example.dev', 'container-health', 'u1'),
  'https://rt.example.dev/container-health/u1'
);
assert.equal(
  actionUrl('https://rt.example.dev', 'archive', 'u1', 's1'),
  'https://rt.example.dev/archive/u1/s1'
);

// previewUrl
assert.equal(
  previewUrl('https://rt.example.dev', 'u1', 's1'),
  'https://rt.example.dev/preview/u1/s1/'
);

console.log('runtime.test.ts OK');
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd /Users/apple/Documents/codegit/hicode-run/codeagent/app && pnpm exec tsx src/modules/code/runtime.test.ts`
Expected: FAIL —— 报错找不到 `./runtime.ts`（模块不存在）。

- [ ] **Step 3: 写最小实现**

创建 `src/modules/code/runtime.ts`：

```ts
// Pure helpers for the CodeAgent runtime session. No DOM / browser deps —
// safe to run under tsx and to import from server functions.

export function sanitizeUserId(raw: string): string {
  const slug = (raw ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return slug || 'user';
}

export function generateSessionId(): string {
  const time = Date.now().toString(36);
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 10)
      : Math.floor(Math.random() * 1e16).toString(36);
  return `s-${time}-${rand}`.toLowerCase();
}

function trimSlashes(base: string): string {
  return base.replace(/\/+$/, '');
}

export function terminalWsUrl(
  base: string,
  userId: string,
  sessionId: string
): string {
  const wsBase = trimSlashes(base).replace(/^http/, 'ws');
  return `${wsBase}/terminal/${encodeURIComponent(userId)}/${encodeURIComponent(sessionId)}`;
}

export function actionUrl(
  base: string,
  action: string,
  userId: string,
  sessionId?: string
): string {
  const parts = [
    trimSlashes(base),
    encodeURIComponent(action),
    encodeURIComponent(userId),
  ];
  if (sessionId) parts.push(encodeURIComponent(sessionId));
  return parts.join('/');
}

export function previewUrl(
  base: string,
  userId: string,
  sessionId: string
): string {
  return `${trimSlashes(base)}/preview/${encodeURIComponent(userId)}/${encodeURIComponent(sessionId)}/`;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd /Users/apple/Documents/codegit/hicode-run/codeagent/app && pnpm exec tsx src/modules/code/runtime.test.ts`
Expected: PASS —— 输出 `runtime.test.ts OK`。

- [ ] **Step 5: 提交**

```bash
cd /Users/apple/Documents/codegit/hicode-run/codeagent/app
git add src/modules/code/runtime.ts src/modules/code/runtime.test.ts
git commit -m "feat(code): runtime session pure helpers"
```

---

## Task 3: 服务端会话引导 + 路由鉴权/loader

**Files:**

- Modify: `src/routes/code.tsx`（仅 Route 定义 + loader；组件在 Task 5/6 重写）

**Interfaces:**

- Consumes: `sanitizeUserId`、`generateSessionId`（Task 2）；`envConfigs.runtime_base_url`（Task 1）；`getAuth`（`@/core/auth`）；`getRequest`（`@tanstack/react-start/server`）。
- Produces: `/code` loader 返回 `{ userId: string; sessionId: string; runtimeBase: string }`；未登录抛 `redirect({ to: '/sign-in' })`。组件用 `Route.useLoaderData()` 获取。

- [ ] **Step 1: 加 createServerFn 会话引导 + loader**

在 `src/routes/code.tsx` 顶部 import 区加入：

```ts
import { redirect } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
```

（`createFileRoute` 已存在，保留。）

在文件底部、`export const Route` **之前**加入服务端函数：

```ts
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
```

- [ ] **Step 2: 改写 Route 定义为 loader 版**

把现有：

```ts
export const Route = createFileRoute('/code')({
  component: CodeWorkspacePage,
});
```

替换为：

```ts
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
```

（`envConfigs` 已在文件顶部 import；若无则补 `import { envConfigs } from '@/config';`。）

- [ ] **Step 3: 让现有组件先编译通过（临时读 loaderData）**

在 `CodeWorkspacePage` 函数体第一行加入（暂不使用，只为验证 loader 打通、避免未使用告警可先 console）：

```ts
const { userId, sessionId, runtimeBase } = Route.useLoaderData();
void runtimeBase;
```

并把左侧 header/会话区里任意一处展示 `sessionId`（例如把 `code.sessions.subtitle` 那行下方临时加 `<p className="text-muted-foreground mt-1 text-[11px]">{sessionId}</p>`）以证明数据流通。userId 同理保留供 Task 5 使用（可 `void userId;`）。

- [ ] **Step 4: 构建验证**

Run: `cd /Users/apple/Documents/codegit/hicode-run/codeagent/app && pnpm build`
Expected: 构建成功，无类型/导入错误。

- [ ] **Step 5: 浏览器验证鉴权门禁**

启动 `pnpm dev`（若未运行）。未登录访问 `http://localhost:3000/code` 应被重定向到 `/sign-in`；登录后访问 `/code` 正常渲染并显示一个 `s-...` 的 sessionId。

- [ ] **Step 6: 提交**

```bash
cd /Users/apple/Documents/codegit/hicode-run/codeagent/app
git add src/routes/code.tsx
git commit -m "feat(code): auth-gated loader with server-generated session id"
```

---

## Task 4: xterm 终端会话 hook + 依赖

**Files:**

- Modify: `package.json`（新增依赖）
- Create: `src/modules/code/use-terminal-session.ts`

**Interfaces:**

- Consumes: `terminalWsUrl`（Task 2）；`@xterm/xterm`、`@xterm/addon-fit`。
- Produces:
  - `type TerminalStatus = 'idle' | 'connecting' | 'connected' | 'closed' | 'error'`
  - `useTerminalSession(opts: { runtimeBase: string; userId: string; sessionId: string; containerRef: React.RefObject<HTMLDivElement | null> }): { status: TerminalStatus; reconnect: () => void }`

- [ ] **Step 1: 安装 xterm 依赖**

Run: `cd /Users/apple/Documents/codegit/hicode-run/codeagent/app && pnpm add @xterm/xterm @xterm/addon-fit`
Expected: 两个包写入 `package.json` dependencies，`pnpm-lock.yaml` 更新。

- [ ] **Step 2: 写 hook 实现**

创建 `src/modules/code/use-terminal-session.ts`：

```ts
import { useCallback, useEffect, useRef, useState } from 'react';
import type { FitAddon } from '@xterm/addon-fit';
import type { Terminal } from '@xterm/xterm';

import { terminalWsUrl } from './runtime';

export type TerminalStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'closed'
  | 'error';

interface Options {
  runtimeBase: string;
  userId: string;
  sessionId: string;
  containerRef: React.RefObject<HTMLDivElement | null>;
}

export function useTerminalSession({
  runtimeBase,
  userId,
  sessionId,
  containerRef,
}: Options): { status: TerminalStatus; reconnect: () => void } {
  const [status, setStatus] = useState<TerminalStatus>('idle');
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const socketRef = useRef<WebSocket | null>(null);

  const sendResize = useCallback(() => {
    const term = termRef.current;
    const fit = fitRef.current;
    const socket = socketRef.current;
    if (!term || !fit) return;
    fit.fit();
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(
        JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows })
      );
    }
  }, []);

  const connect = useCallback(() => {
    const term = termRef.current;
    if (!term) return;
    if (socketRef.current) {
      socketRef.current.close();
      socketRef.current = null;
    }
    setStatus('connecting');
    const socket = new WebSocket(terminalWsUrl(runtimeBase, userId, sessionId));
    socket.binaryType = 'arraybuffer';
    socketRef.current = socket;

    socket.addEventListener('open', () => {
      setStatus('connected');
      sendResize();
    });
    socket.addEventListener('message', (event) => {
      if (typeof event.data === 'string') {
        term.write(event.data);
      } else {
        term.write(new Uint8Array(event.data as ArrayBuffer));
      }
    });
    socket.addEventListener('close', () => setStatus('closed'));
    socket.addEventListener('error', () => setStatus('error'));
  }, [runtimeBase, userId, sessionId, sendResize]);

  const reconnect = useCallback(() => connect(), [connect]);

  useEffect(() => {
    let disposed = false;
    const container = containerRef.current;
    if (!container) return;

    (async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import('@xterm/xterm'),
        import('@xterm/addon-fit'),
      ]);
      if (disposed) return;

      const term = new Terminal({
        cursorBlink: true,
        convertEol: true,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        fontSize: 13,
        theme: {
          background: '#17130f',
          foreground: '#f4eadf',
          cursor: '#ffffff',
        },
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(container);
      fit.fit();
      term.onData((data) => {
        const socket = socketRef.current;
        if (socket && socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: 'input', data }));
        }
      });

      termRef.current = term;
      fitRef.current = fit;

      window.addEventListener('resize', sendResize);
      connect();
    })();

    return () => {
      disposed = true;
      window.removeEventListener('resize', sendResize);
      socketRef.current?.close();
      socketRef.current = null;
      termRef.current?.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
    // Re-init on session change so "new session" starts a fresh terminal.
  }, [sessionId, connect, sendResize, containerRef]);

  return { status, reconnect };
}
```

- [ ] **Step 3: 构建验证（类型/打包）**

Run: `cd /Users/apple/Documents/codegit/hicode-run/codeagent/app && pnpm build`
Expected: 构建成功（hook 尚未被引用也应能编译；若 tree-shaking 报未使用可忽略，无错误即可）。

- [ ] **Step 4: 提交**

```bash
cd /Users/apple/Documents/codegit/hicode-run/codeagent/app
git add package.json pnpm-lock.yaml src/modules/code/use-terminal-session.ts
git commit -m "feat(code): xterm terminal session hook + deps"
```

---

## Task 5: `/code` 接入真实终端

**Files:**

- Modify: `src/routes/code.tsx`（组件：替换写死终端为真实 xterm；接入 hook；新会话按钮）

**Interfaces:**

- Consumes: `useTerminalSession`、`TerminalStatus`（Task 4）；`generateSessionId`（Task 2）；`Route.useLoaderData()`（Task 3）。

- [ ] **Step 1: 引入 hook 与 CSS，改组件顶部**

在 `src/routes/code.tsx` import 区加入：

```ts
import { useRef, useState } from 'react';

import '@xterm/xterm/css/xterm.css';

import { generateSessionId } from '@/modules/code/runtime';
import {
  useTerminalSession,
  type TerminalStatus,
} from '@/modules/code/use-terminal-session';
```

把 `CodeWorkspacePage` 顶部（Task 3 Step 3 加的临时行）替换为：

```ts
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
```

删除原先写死的 `const sessions = [...]` 数组（不再使用）。

- [ ] **Step 2: 替换中间“终端”块为真实 xterm 容器**

把 `<section>` 内那段 `min-h-[520px] bg-[#17130f] ...` 的假终端 `<div>`（包含 `code.terminal.line_*` 的所有 `<p>`）整体替换为：

```tsx
<div className="relative min-h-[520px] bg-[#17130f] p-3">
  <div ref={terminalRef} className="h-[520px] w-full" />
</div>
```

并把该块顶部状态栏右侧的 `{m['code.terminal.status']()}` 替换为动态状态：

```tsx
<span className="text-muted-foreground text-xs">{statusLabel(status)}</span>
```

- [ ] **Step 3: 加状态标签辅助函数**

在文件底部（`Metric` 函数附近）加入：

```tsx
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
```

（对应文案在 Task 6 补入 messages；本任务先用占位英文，若 `m['code.terminal.connecting']` 尚未存在会导致类型错误——因此本步骤依赖 Task 6 的 key。为避免顺序问题，**先执行 Task 6 的 messages 追加，再回到本步**，或本步临时用字面量字符串 `'connecting'` 等，Task 6 再替换为 `m[...]`。采用后者：本步先用字面量。）

因此本步实际写：

```tsx
function statusLabel(status: TerminalStatus): string {
  switch (status) {
    case 'connecting':
      return 'connecting…';
    case 'connected':
      return 'connected';
    case 'error':
      return 'socket error';
    case 'closed':
      return 'disconnected';
    default:
      return 'idle';
  }
}
```

- [ ] **Step 4: 接“新会话”和“重连”按钮**

左侧 `aside` 顶部的“新建会话”按钮（`aria-label={m['code.sessions.new']()}` 的 `<Button>`）加 `onClick={newSession}`。
在中间终端状态栏或右侧合适位置加一个重连按钮：

```tsx
<Button
  size="sm"
  variant="outline"
  className="h-7 rounded-full text-xs"
  onClick={reconnect}
>
  {m['code.terminal.reconnect']()}
</Button>
```

（`code.terminal.reconnect` 文案由 Task 6 补入；本步先用字面量 `重连 / Reconnect`，Task 6 替换为 `m[...]`。先写 `>重连<`。）

同时更新左侧会话列表：不再渲染 `sessions` 数组，改为渲染当前会话一项：

```tsx
<div className="mt-6 space-y-2">
  <div className="bg-muted flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm">
    <span className="bg-primary size-2 rounded-full" />
    <span className="truncate font-mono text-xs">{sessionId}</span>
  </div>
</div>
```

- [ ] **Step 5: 构建验证**

Run: `cd /Users/apple/Documents/codegit/hicode-run/codeagent/app && pnpm build`
Expected: 构建成功。

- [ ] **Step 6: 浏览器闭环验证**

登录后打开 `http://localhost:3000/code`：

- 终端渲染真实 xterm，出现 `Welcome to Claude Code v2.1.197`（首次冷启动可能需数秒；若显示 `disconnected`，点重连）。
- 能输入命令并看到回显 / Claude Code TUI。
- 点“重连”后重新 attach 同一 tmux，历史保留。
- 点“新会话”生成新 `s-...` id 并起新终端。

- [ ] **Step 7: 提交**

```bash
cd /Users/apple/Documents/codegit/hicode-run/codeagent/app
git add src/routes/code.tsx
git commit -m "feat(code): wire real xterm terminal into /code"
```

---

## Task 6: 预览/健康/归档面板接真实端点 + i18n

**Files:**

- Modify: `src/routes/code.tsx`（右侧面板接真实动作 + 用 `m[...]` 替换 Task 5 的字面量）
- Modify: `messages/en.json`
- Modify: `messages/zh.json`

**Interfaces:**

- Consumes: `actionUrl`、`previewUrl`（Task 2）；`loader.runtimeBase/userId`、`sessionId`（Task 5）。

- [ ] **Step 1: 追加 i18n 文案（en）**

在 `messages/en.json` 中，替换/新增以下 `code.*` key（保留已有可复用的；删除 `code.terminal.line_1..5`、`code.sessions.current/preview/archive` 三个假会话名，改为新键）：

```json
  "code.terminal.connecting": "connecting…",
  "code.terminal.connected": "connected",
  "code.terminal.closed": "disconnected",
  "code.terminal.error": "socket error",
  "code.terminal.idle": "idle",
  "code.terminal.reconnect": "Reconnect",
  "code.actions.health": "Health",
  "code.actions.archive": "Archive",
  "code.actions.restore": "Restore",
  "code.actions.refresh_preview": "Refresh preview",
  "code.actions.running": "running…",
  "code.diff.soon": "Structured diff is coming in a later release."
```

- [ ] **Step 2: 追加 i18n 文案（zh）**

在 `messages/zh.json` 加入对应中文：

```json
  "code.terminal.connecting": "连接中…",
  "code.terminal.connected": "已连接",
  "code.terminal.closed": "已断开",
  "code.terminal.error": "连接错误",
  "code.terminal.idle": "空闲",
  "code.terminal.reconnect": "重连",
  "code.actions.health": "健康检查",
  "code.actions.archive": "归档",
  "code.actions.restore": "恢复",
  "code.actions.refresh_preview": "刷新预览",
  "code.actions.running": "执行中…",
  "code.diff.soon": "结构化 diff 将在后续版本支持。"
```

（同步删除两个语言文件里不再引用的 `code.terminal.line_1..5`、`code.sessions.current/preview/archive`。）

- [ ] **Step 3: 把 Task 5 的字面量替换为 `m[...]`**

在 `src/routes/code.tsx`：

- `statusLabel` 内 5 个 return 改回 `m['code.terminal.connecting']()` 等。
- 重连按钮文字改为 `{m['code.terminal.reconnect']()}`。

- [ ] **Step 4: 面板接真实动作**

在组件内加入动作状态与处理函数（放在 `newSession` 定义之后）：

```ts
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
      setActionMsg(`${payload.tmux ?? ''} / ${payload.claude ?? ''}`.trim());
    } else if (payload.digest) {
      setActionMsg(`${label}: ${String(payload.digest).slice(0, 12)}…`);
    } else {
      setActionMsg(`${label}: ok`);
    }
  } catch (err) {
    setActionMsg((err as Error).message || 'error');
  }
};
```

导入辅助：在 import 区把 Task 5 已导入的 runtime 模块补上 `actionUrl, previewUrl`：

```ts
import {
  actionUrl,
  generateSessionId,
  previewUrl,
} from '@/modules/code/runtime';
```

- [ ] **Step 5: 预览面板接真实 iframe**

把右侧 `Panel`（`code.preview.*`）内那段假的占位 `<div>`（`bg-primary/80 h-3 ...` 那块）替换为：

```tsx
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
```

- [ ] **Step 6: 归档面板接 health/archive/restore 按钮**

把 `code.archive.*` 那个 `Panel` 内容替换为一组真实按钮 + 状态：

```tsx
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 rounded-full text-xs"
                  onClick={() =>
                    runAction(
                      'health',
                      actionUrl(loader.runtimeBase, 'container-health', loader.userId),
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
                      actionUrl(loader.runtimeBase, 'archive', loader.userId, sessionId),
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
                      actionUrl(loader.runtimeBase, 'restore', loader.userId, sessionId),
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
```

- [ ] **Step 7: Diff 面板降级为占位**

把 `code.diff.*` 那个 `Panel` 内的假 diff `<div>` 替换为：

```tsx
<p className="text-muted-foreground text-xs">{m['code.diff.soon']()}</p>
```

- [ ] **Step 8: 构建 + 格式 + 浏览器验证**

Run:

```bash
cd /Users/apple/Documents/codegit/hicode-run/codeagent/app && pnpm build && pnpm format:check
```

Expected: 均通过。
浏览器：登录 `/code` →

- Health 按钮返回 `tmux 3.5a / 2.1.197 (Claude Code)`。
- Archive 返回 `archive: <digest 前12位>…`。
- Preview iframe 加载会话预览；刷新按钮生效。
- 桌面 + 移动无横向溢出。

- [ ] **Step 9: 提交**

```bash
cd /Users/apple/Documents/codegit/hicode-run/codeagent/app
git add src/routes/code.tsx messages/en.json messages/zh.json
git commit -m "feat(code): real preview/health/archive actions + i18n"
```

---

## Self-Review 结果

- **Spec 覆盖：** 依赖(3.1)→T4；config/env(3.2)→T1；页面门禁(3.3)→T3；服务端 loader(3.4)→T3；终端 hook(3.5)→T4；重写组件(3.6)→T5+T6；i18n(3.7)→T6；错误处理(§5)→hook 的 status + runAction 的 try/catch + 不自动重连；验证(§6)→各任务 Step。均有对应任务。
- **占位扫描：** 无 TBD/TODO；所有代码步骤含完整代码。T5 Step3/Step4 的“先用字面量、T6 再换 `m[...]`”是有意为之的顺序处理，已在 T6 Step3 明确回填，非占位。
- **类型一致：** `useTerminalSession` 签名（`containerRef: RefObject<HTMLDivElement | null>`、返回 `{status, reconnect}`）在 T4 定义、T5 消费一致；`TerminalStatus` 五值在 hook 与 `statusLabel` 一致；`actionUrl/previewUrl/generateSessionId/sanitizeUserId` 签名 T2 定义、T3/T5/T6 消费一致。
