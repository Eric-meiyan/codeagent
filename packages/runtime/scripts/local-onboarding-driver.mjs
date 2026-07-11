const baseUrl = 'http://127.0.0.1:18087';
const sessionId = `local-onboarding-${Date.now()}`;
const wsUrl = `ws://127.0.0.1:18087/terminal/${sessionId}?base_url=${encodeURIComponent(`${baseUrl}/api/model`)}`;

const socket = new WebSocket(wsUrl);
let output = '';

function stripAnsi(text) {
  return text.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '');
}

function send(data, delay) {
  setTimeout(() => {
    socket.send(JSON.stringify({ type: 'input', data }));
  }, delay);
}

socket.addEventListener('open', () => {
  socket.send(JSON.stringify({ type: 'resize', cols: 140, rows: 40 }));
  send('1\r', 8000); // theme
  send('1\r', 22000); // API key prompt
  send('\r', 34000); // security notes
  send('1\r', 46000); // trust workspace
  send('\u0003', 65000); // leave Claude for inspection if possible
});

socket.addEventListener('message', async (event) => {
  if (typeof event.data === 'string') output += event.data;
  else if (event.data instanceof Blob)
    output += Buffer.from(await event.data.arrayBuffer()).toString('utf8');
  else if (event.data instanceof ArrayBuffer)
    output += Buffer.from(event.data).toString('utf8');
  else output += String(event.data);
});

await new Promise((resolve) => setTimeout(resolve, 76000));
socket.close();

const compact = stripAnsi(output);
console.log(`session=${sessionId}`);
console.log(compact.slice(-6000));
