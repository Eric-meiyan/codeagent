const baseUrl = (
  process.argv[2] ||
  'https://codeagent-spike-integrated-session-mvp.eric-wuyu1352.workers.dev'
).replace(/\/$/, '');
const userId = 'demo-user';
const sessionId = `integrated-${Date.now()}`;

async function requestJson(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    signal: AbortSignal.timeout(120000),
  });
  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(text);
  }
  if (!response.ok || payload.ok === false) {
    throw new Error(JSON.stringify(payload, null, 2));
  }
  return payload;
}

async function requestText(path) {
  const response = await fetch(`${baseUrl}${path}`, {
    signal: AbortSignal.timeout(120000),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${response.status} ${text}`);
  }
  return text;
}

async function requestError(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    signal: AbortSignal.timeout(120000),
  });
  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(
      `expected JSON failure response: status=${response.status} body=${text.slice(0, 500)}`
    );
  }
  if (response.ok || payload.ok !== false) {
    throw new Error(`expected request failure: ${JSON.stringify(payload)}`);
  }
  return { status: response.status, payload };
}

function stripAnsi(text) {
  return text.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '');
}

function connectTerminal() {
  const wsUrl = `${baseUrl.replace(/^http/, 'ws')}/terminal/${userId}/${sessionId}`;
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl);
    let output = '';
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error(output || 'timeout waiting for integrated terminal'));
    }, 45000);
    socket.addEventListener('open', () => {
      socket.send(JSON.stringify({ type: 'resize', cols: 120, rows: 30 }));
    });
    socket.addEventListener('message', async (event) => {
      if (typeof event.data === 'string') output += event.data;
      else if (event.data instanceof Blob)
        output += Buffer.from(await event.data.arrayBuffer()).toString('utf8');
      else if (event.data instanceof ArrayBuffer)
        output += Buffer.from(event.data).toString('utf8');
      else output += String(event.data);

      const compact = stripAnsi(output);
      if (compact.includes('Connected to integrated tmux session')) {
        clearTimeout(timeout);
        socket.close();
        resolve(compact);
      }
    });
    socket.addEventListener('error', (event) => {
      clearTimeout(timeout);
      reject(new Error(`websocket error ${String(event)}`));
    });
  });
}

const health = await requestJson(`/container-health/${userId}`);
if (!health.tmux || !health.claude) throw new Error(JSON.stringify(health));

const appHtml = await requestText(`/app/${userId}/${sessionId}`);
if (!appHtml.includes('CodeAgent Spike 7')) throw new Error(appHtml);
if (!appHtml.includes('xterm@5.3.0')) throw new Error(appHtml);
if (!appHtml.includes('var terminalPath = "/terminal/"'))
  throw new Error(appHtml);
if (!appHtml.includes(`var userId = "${userId}"`)) throw new Error(appHtml);
if (!appHtml.includes(`var sessionId = "${sessionId}"`))
  throw new Error(appHtml);

const seeded = await requestJson(`/seed/${userId}/${sessionId}`, {
  method: 'POST',
});
const previewHtml = await requestText(`/preview/${userId}/${sessionId}/`);
if (!previewHtml.includes('Integrated Preview')) throw new Error(previewHtml);

const previewApi = await requestJson(
  `/preview/${userId}/${sessionId}/api/session`
);
if (previewApi.userId !== userId || previewApi.sessionId !== sessionId) {
  throw new Error(JSON.stringify(previewApi, null, 2));
}

await connectTerminal();
const tmuxBefore = await requestJson(`/tmux/${userId}/${sessionId}`);
if (!tmuxBefore.exists) throw new Error(JSON.stringify(tmuxBefore, null, 2));
await connectTerminal();

const archived = await requestJson(`/archive/${userId}/${sessionId}`);
if (archived.archiveFormat !== '2') {
  throw new Error(`unexpected archive format: ${JSON.stringify(archived)}`);
}
const blockedRestore = await requestError(`/restore/${userId}/${sessionId}`, {
  method: 'POST',
});
if (
  blockedRestore.status !== 409 ||
  blockedRestore.payload.code !== 'active_workspace_restore_blocked' ||
  blockedRestore.payload.stage !== 'restore.guard'
) {
  throw new Error(JSON.stringify(blockedRestore, null, 2));
}
const afterBlockedRestore = await requestJson(
  `/inspect/${userId}/${sessionId}`
);
if (afterBlockedRestore.digest !== seeded.digest) {
  throw new Error('blocked restore changed the active workspace');
}
const cleared = await requestJson(`/clear/${userId}/${sessionId}`, {
  method: 'POST',
});
if (cleared.cleared?.exists !== false) {
  throw new Error(JSON.stringify(cleared, null, 2));
}
const restored = await requestJson(`/restore/${userId}/${sessionId}`);
const after = await requestJson(`/inspect/${userId}/${sessionId}`);
if (seeded.digest !== after.digest) {
  throw new Error(
    `digest mismatch before=${seeded.digest} after=${after.digest}`
  );
}

const previewAfterRestore = await requestText(
  `/preview/${userId}/${sessionId}/`
);
if (!previewAfterRestore.includes('Integrated Preview'))
  throw new Error(previewAfterRestore);

console.log('Remote integrated session MVP smoke test passed');
console.log(`session: ${sessionId}`);
console.log(`tmux: ${tmuxBefore.tmuxSession}`);
console.log(`archive: ${archived.key}`);
console.log(`digest: ${after.digest}`);
console.log(`restoredObjectSize: ${restored.objectSize}`);
