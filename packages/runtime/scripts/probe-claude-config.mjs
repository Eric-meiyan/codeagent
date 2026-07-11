const baseUrl = (
  process.argv[2] ||
  'https://codeagent-spike-integrated-session-mvp.eric-wuyu1352.workers.dev'
).replace(/\/$/, '');
const userId = process.argv[3] || `probe-user-${Date.now()}`;
const sessionId = process.argv[4] || `probe-session-${Date.now()}`;
const wsUrl = `${baseUrl.replace(/^http/, 'ws')}/terminal/${userId}/${sessionId}`;

function stripAnsi(text) {
  return text.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const socket = new WebSocket(wsUrl);
  let output = '';
  let sentDump = false;

  const done = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error(stripAnsi(output).slice(-5000)));
    }, 120000);

    socket.addEventListener('open', () => {
      socket.send(JSON.stringify({ type: 'resize', cols: 140, rows: 40 }));
      setTimeout(() => {
        socket.send(JSON.stringify({ type: 'input', data: '\r' }));
      }, 8000);
      setTimeout(() => {
        socket.send(JSON.stringify({ type: 'input', data: '1\r' }));
      }, 24000);
      setTimeout(() => {
        socket.send(JSON.stringify({ type: 'input', data: '\r' }));
      }, 36000);
      setTimeout(() => {
        socket.send(JSON.stringify({ type: 'input', data: '\u001b[B\r' }));
      }, 52000);
      setTimeout(() => {
        socket.send(JSON.stringify({ type: 'input', data: '\u0003' }));
      }, 70000);
      setTimeout(() => {
        socket.send(JSON.stringify({ type: 'input', data: '\u0003' }));
      }, 73000);
      setTimeout(() => {
        if (!sentDump) {
          sentDump = true;
          socket.send(
            JSON.stringify({
              type: 'input',
              data: "printf '\\n---CONFIG-DUMP---\\n'; id; pwd; find /tmp/claude-home /tmp/claude-config -maxdepth 4 -type f -print -exec sed -n '1,220p' {} \\; 2>/dev/null; printf '\\n---END-CONFIG-DUMP---\\n'\r",
            })
          );
        }
      }, 80000);
    });

    socket.addEventListener('message', async (event) => {
      if (typeof event.data === 'string') output += event.data;
      else if (event.data instanceof Blob)
        output += Buffer.from(await event.data.arrayBuffer()).toString('utf8');
      else if (event.data instanceof ArrayBuffer)
        output += Buffer.from(event.data).toString('utf8');
      else output += String(event.data);

      const compact = stripAnsi(output);
      if (sentDump && compact.includes('---END-CONFIG-DUMP---')) {
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
  const start = compact.indexOf('---CONFIG-DUMP---');
  const end = compact.indexOf('---END-CONFIG-DUMP---');
  console.log(`user=${userId}`);
  console.log(`session=${sessionId}`);
  console.log(compact.slice(start, end + '---END-CONFIG-DUMP---'.length));
}

await main();
