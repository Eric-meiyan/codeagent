const baseUrl = (
  process.argv[2] ||
  'https://codeagent-spike-integrated-session-mvp.eric-wuyu1352.workers.dev'
).replace(/\/$/, '');
const userId = process.argv[3] || `spike8b-user-${Date.now()}`;
const sessionId = process.argv[4] || `spike8b-session-${Date.now()}`;
const wsUrl = `${baseUrl.replace(/^http/, 'ws')}/terminal/${encodeURIComponent(userId)}/${encodeURIComponent(sessionId)}`;
const expected = 'SPIKE8B_CLAUDE_OK';

function stripAnsi(text) {
  return text.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '');
}

const socket = new WebSocket(wsUrl);
let output = '';
let sentPrompt = false;
const prompt =
  'Output exactly these three parts joined by underscores: SPIKE8B, CLAUDE, OK. No other text.';

function submitPrompt() {
  socket.send(JSON.stringify({ type: 'input', data: prompt }));
  setTimeout(() => {
    socket.send(JSON.stringify({ type: 'input', data: '\r' }));
  }, 1000);
}

const done = new Promise((resolve, reject) => {
  const timeout = setTimeout(() => {
    socket.close();
    reject(
      new Error(
        stripAnsi(output).slice(-9000) ||
          'timeout waiting for Claude terminal model response'
      )
    );
  }, 180000);

  socket.addEventListener('open', () => {
    socket.send(JSON.stringify({ type: 'resize', cols: 140, rows: 40 }));
  });

  socket.addEventListener('message', async (event) => {
    if (typeof event.data === 'string') output += event.data;
    else if (event.data instanceof Blob)
      output += Buffer.from(await event.data.arrayBuffer()).toString('utf8');
    else if (event.data instanceof ArrayBuffer)
      output += Buffer.from(event.data).toString('utf8');
    else output += String(event.data);

    const compact = stripAnsi(output);
    const normalized = compact.replace(/\s+/g, '');

    if (
      !sentPrompt &&
      normalized.includes('AnthropicbaseURL') &&
      normalized.includes('/api/model')
    ) {
      sentPrompt = true;
      submitPrompt();
    } else if (
      !sentPrompt &&
      compact.includes('Claude Code') &&
      compact.includes('❯')
    ) {
      sentPrompt = true;
      submitPrompt();
    }

    if (compact.includes(expected)) {
      clearTimeout(timeout);
      socket.close();
      resolve(compact);
    }

    if (
      compact.includes('API Error') ||
      compact.includes('new_api_error') ||
      compact.includes('无权访问模型')
    ) {
      clearTimeout(timeout);
      socket.close();
      reject(new Error(compact.slice(-9000)));
    }
  });

  socket.addEventListener('error', (event) => {
    clearTimeout(timeout);
    reject(new Error(`websocket error ${String(event)}`));
  });
});

const compact = await done;
console.log('Claude Code terminal real gateway check passed');
console.log(`user: ${userId}`);
console.log(`session: ${sessionId}`);
console.log(compact.slice(-2500));
