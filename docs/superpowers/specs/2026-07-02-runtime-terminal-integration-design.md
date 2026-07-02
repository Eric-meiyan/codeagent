# CodeAgent 运行时集成设计（第一轮：真实终端闭环）

**日期：** 2026-07-02
**状态：** 已批准，待实现计划
**范围：** 单一子项目 —— 把 `/code` 从静态 mockup 变成能真正启动云端会话、流式操作 Claude Code 终端的闭环。

---

## 1. 目标与非目标

### 目标

把产品应用 `/code` 页面接上现有已部署的 spike 06 运行时，实现：

- 登录用户打开 `/code` 后，浏览器内真正启动一个云端会话（Cloudflare Container + tmux + Claude Code CLI）。
- xterm.js 流式双向终端：能输入命令、看到 Claude Code TUI、断线重连保留 tmux 会话状态。
- preview / archive / restore / health 动作接真实运行时端点。

### 非目标（本轮明确不做，留待下一轮）

- 运行时 `/terminal` 的 token 鉴权（本轮靠**页面登录门禁 + 服务端生成不可猜 sessionId**）。
- D1 会话表、多会话持久化、每用户隔离配额、计费归属。
- 空闲自动 archive、终端日志/tmux 元数据归档。
- Diff 面板真实化（本轮降级为占位或静态）。
- 修改 spike 06 代码（保持不动，仅作为配置化的运行时端点消费）。

---

## 2. 架构

独立运行时 Worker 拓扑。产品 app 与运行时是两个独立 Cloudflare Worker，浏览器直连运行时。

```
浏览器 (https://hicode.run/code, 已登录)
  │  xterm.js  ──WebSocket──▶  RUNTIME/terminal/:user/:session      (直连，流式 PTY 字节)
  │  fetch     ──JSON──────▶  RUNTIME/container-health/:user
  │  fetch     ──JSON POST─▶  RUNTIME/seed|archive|restore/:user/:session
  │  iframe    ────────────▶  RUNTIME/preview/:user/:session/       (跨源文档加载)
  │
产品 app (TanStack Start Worker)
  只负责：① 登录门禁  ② 服务端派生 userId + 生成不可猜 sessionId  ③ 下发 RUNTIME 配置
```

- `RUNTIME` = 现有部署 `https://codeagent-spike-integrated-session-mvp.eric-wuyu1352.workers.dev`，配成公开环境变量。
- **关键事实：** spike 的 `json()` helper 给所有 JSON 响应设了 `access-control-allow-origin: *`，preview 是 iframe 文档加载，WebSocket 不走 CORS —— 因此浏览器可直连运行时全部端点，本轮无需 app 侧代理。

### 运行时 WebSocket 协议（严格复用，不可改）

来源：`spikes/06-integrated-session-mvp/src/index.ts`。

- 连接：`wss://<runtime>/terminal/:user/:session`，`socket.binaryType = "arraybuffer"`。
- 收：`typeof data === "string"` → `term.write(data)`；否则 `term.write(new Uint8Array(data))`。
- 发输入：`socket.send(JSON.stringify({ type: "input", data }))`。
- 发 resize：`socket.send(JSON.stringify({ type: "resize", cols, rows }))`。
- 动作端点（GET / POST 见路由）：
  - `GET  /container-health/:user`
  - `POST /seed/:user/:session`
  - `POST /archive/:user/:session`
  - `POST /restore/:user/:session`
  - `GET  /preview/:user/:session/`（iframe src）
  - 断线重连 = 重新 `new WebSocket(...)`，attach 回同一 tmux session。

---

## 3. 组件与改动清单

### 3.1 依赖

新增打包依赖（不用 CDN，修掉 spike 记录的已知缺口）：

- `@xterm/xterm`
- `@xterm/addon-fit`

### 3.2 配置 `src/config/index.ts`

新增字段：

```ts
runtime_base_url: publicEnv('VITE_RUNTIME_BASE_URL')
  ?? 'https://codeagent-spike-integrated-session-mvp.eric-wuyu1352.workers.dev',
```

- 公开变量（`VITE_` 前缀），因为浏览器需要直连。
- 同步补 `.env.example`、`.env.development`。

### 3.3 页面门禁

`/code` 路由加 `beforeLoad`：服务端用 `getAuth().api.getSession({ headers })` 校验，未登录 `redirect` 到 `/sign-in`。沿用 app 现有 API 路由的鉴权模式。

### 3.4 服务端 loader

`/code` 的 loader（server-side）返回：

```ts
{ userId: string, sessionId: string, runtimeBase: string }
```

- `userId`：由登录用户 `session.user.id` 派生并 sanitize 成运行时可接受的 `[a-z0-9-]` slug（运行时会 encodeURIComponent，但仍用保守 slug 规避边界问题）。
- `sessionId`：**服务端随机生成**（如 crypto 随机 + 时间片），不可猜。本轮不持久化。
- `runtimeBase`：来自 `envConfigs.runtime_base_url`。

### 3.5 终端会话 hook

新增 `src/modules/code/use-terminal-session.ts`（或 `src/hooks/`，跟随现有约定）：

- 输入：`{ runtimeBase, userId, sessionId }` + 一个挂载 DOM ref。
- 职责：懒加载 `@xterm/xterm` + `addon-fit`；建立 WS；实现上面协议；`window.resize` → fit + 发 resize；暴露 `reconnect()`、`status`（connecting/connected/closed/error）、`connect()`。
- 严格复用 spike 帧协议。xterm 仅客户端加载（避免 SSR 引入 DOM 依赖）。

### 3.6 重写 `/code` 组件 `src/routes/code.tsx`

- **左侧会话栏**：显示当前真实 sessionId；"新会话"按钮客户端生成新 sessionId 并重连（本轮不落 D1，会话列表为当前会话 + 本地态）。
- **中间终端**：真实 xterm 容器，替换写死的假终端行。顶部状态显示 WS status。
- **右侧面板**：
  - preview：真实 iframe（`RUNTIME/preview/:user/:session/`）+ 刷新按钮。
  - archive / restore / health：接真实按钮，调用运行时动作端点，展示返回（digest / tmux+claude 版本）。
  - diff：本轮降级为占位（保留卡片，标注"即将支持"或静态示例）。

### 3.7 i18n

调整 `code.*` 文案：移除写死的假 diff/preview 行，换成真实状态标签（连接中/已连接/已归档 digest 等）。中英文 messages 同步。

---

## 4. 数据流

1. 浏览器 GET `/code` → app `beforeLoad` 校验登录 → loader 生成 `{userId, sessionId, runtimeBase}` → 渲染页面。
2. 页面挂载 → hook 连接 `wss://runtime/terminal/userId/sessionId` → 运行时起容器 → tmux + Claude Code → PTY 字节流回浏览器 xterm。
3. 用户输入 → `{type:"input"}` → 运行时 PTY。
4. 断线/点重连 → 新 WS attach 回同一 tmux → 状态保留。
5. 点 health/archive/preview → 跨源 fetch/iframe 直达运行时（CORS 已开）。

---

## 5. 错误处理

- WS 连接失败 / 关闭 → status 显示 `closed`/`error`，提供重连按钮（不自动无限重连，避免刷容器）。
- 动作 fetch 失败 → 面板内展示错误信息，不崩页。
- 运行时首次冷启动可能短暂 provisioning 错误 → 提示"运行时启动中，稍后重连"。
- xterm 客户端加载失败 → 降级提示，不影响页面其它部分。

---

## 6. 验证

- `pnpm format:check` 通过。
- `pnpm build` 通过。
- 浏览器登录后打开 `/code`：
  - 终端出现 `Welcome to Claude Code v2.1.197`。
  - 可输入命令并看到回显 / TUI。
  - 断开重连后 tmux 会话状态保留。
  - health 按钮返回真实 `tmux 3.5a` / `2.1.197 (Claude Code)`。
- 桌面 + 移动无横向溢出。

---

## 7. 已知遗留（下一轮 spec）

- 运行时 token 鉴权（app 签发短期 token，运行时验证）。
- D1 会话表 + 多会话列表 + 每用户隔离 + 配额/计费。
- 空闲触发 archive、终端日志归档。
- Diff 面板真实化。
- 把运行时从 spike 部署迁到 `runtime.hicode.run` 正式端点。
