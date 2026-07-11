const baseUrl = (
  process.argv[2] ||
  'https://codeagent-spike-integrated-session-mvp.eric-wuyu1352.workers.dev'
).replace(/\/$/, '');
const userId = process.argv[3] || `spike8a-user-${Date.now()}`;
const sessionId = process.argv[4] || `spike8a-session-${Date.now()}`;
const wsUrl = `${baseUrl.replace(/^http/, 'ws')}/terminal/${encodeURIComponent(userId)}/${encodeURIComponent(sessionId)}`;

function stripAnsi(text) {
  return text.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '');
}

const onboardingMarkers = [
  'Choose the text style',
  'Do you want to use this API key',
  'Select login method',
  'Trust this folder',
  'Security notes',
  'Login with Claude',
  'claude command at',
  'missing or broken',
];

async function main() {
  const socket = new WebSocket(wsUrl);
  let output = '';
  let askedStatus = false;

  const done = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.close();
      reject(
        new Error(
          stripAnsi(output).slice(-7000) ||
            'timeout waiting for Claude Code ready state'
        )
      );
    }, 90000);

    socket.addEventListener('open', () => {
      socket.send(JSON.stringify({ type: 'resize', cols: 140, rows: 40 }));
      setTimeout(() => {
        askedStatus = true;
        socket.send(JSON.stringify({ type: 'input', data: '/status\r' }));
      }, 30000);
    });

    socket.addEventListener('message', async (event) => {
      if (typeof event.data === 'string') output += event.data;
      else if (event.data instanceof Blob)
        output += Buffer.from(await event.data.arrayBuffer()).toString('utf8');
      else if (event.data instanceof ArrayBuffer)
        output += Buffer.from(event.data).toString('utf8');
      else output += String(event.data);

      const compact = stripAnsi(output);
      const marker = onboardingMarkers.find((item) => compact.includes(item));
      if (marker) {
        clearTimeout(timeout);
        socket.close();
        reject(
          new Error(
            `onboarding marker still visible: ${marker}\n${compact.slice(-7000)}`
          )
        );
        return;
      }

      const normalized = compact.replace(/\s+/g, '');
      if (
        askedStatus &&
        normalized.includes('AnthropicbaseURL') &&
        normalized.includes('/api/model')
      ) {
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

  const compact = await done;
  console.log('Claude Code ready check passed');
  console.log(`user: ${userId}`);
  console.log(`session: ${sessionId}`);
  console.log(compact.slice(-2500));
}

await main();
