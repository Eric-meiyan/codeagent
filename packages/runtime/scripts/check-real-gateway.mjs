const allowMissingSecret = process.argv.includes('--allow-missing-secret');
const baseArg = process.argv.slice(2).find((arg) => !arg.startsWith('--'));
const baseUrl = (
  baseArg ||
  'https://codeagent-spike-integrated-session-mvp.eric-wuyu1352.workers.dev'
).replace(/\/$/, '');

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
    throw new Error(
      `${response.status} non-json response: ${text.slice(0, 500)}`
    );
  }
  if (!response.ok) {
    const error = new Error(
      `${response.status} ${JSON.stringify(payload, null, 2)}`
    );
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

async function requestStream(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    signal: AbortSignal.timeout(120000),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${response.status} ${text.slice(0, 1000)}`);
  }
  return text;
}

const health = await requestJson('/api/model/_health');
console.log('Gateway health:');
console.log(JSON.stringify(health, null, 2));

if (!health.configured) {
  const message = 'ANTHROPIC_API_KEY secret is not configured on the Worker.';
  if (allowMissingSecret) {
    console.log(message);
    process.exit(0);
  }
  throw new Error(`${message} Run: npx wrangler secret put ANTHROPIC_API_KEY`);
}

const models = await requestJson('/api/model/v1/models');
const model = process.env.CLAUDE_MODEL || models.data?.[0]?.id;
if (!model) {
  throw new Error(
    `no model returned by gateway: ${JSON.stringify(models, null, 2)}`
  );
}
console.log(`Using model: ${model}`);
await requestJson(`/api/model/v1/models/${encodeURIComponent(model)}`);

const messageBody = {
  model,
  max_tokens: 32,
  messages: [
    {
      role: 'user',
      content: 'Reply with exactly: SPIKE8B_REAL_OK',
    },
  ],
};

const counted = await requestJson('/api/model/v1/messages/count_tokens', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'anthropic-version': '2023-06-01',
  },
  body: JSON.stringify(messageBody),
});
if (typeof counted.input_tokens !== 'number') {
  throw new Error(
    `unexpected count_tokens response: ${JSON.stringify(counted, null, 2)}`
  );
}

const nonStream = await requestJson('/api/model/v1/messages', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'anthropic-version': '2023-06-01',
  },
  body: JSON.stringify(messageBody),
});

const nonStreamText = JSON.stringify(nonStream);
if (!nonStreamText.includes('SPIKE8B_REAL_OK')) {
  throw new Error(
    `unexpected non-stream response: ${nonStreamText.slice(0, 1000)}`
  );
}

const streamText = await requestStream('/api/model/v1/messages', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    accept: 'text/event-stream',
    'anthropic-version': '2023-06-01',
  },
  body: JSON.stringify({ ...messageBody, stream: true }),
});

let streamedText = '';
for (const line of streamText.split(/\r?\n/)) {
  if (!line.startsWith('data:')) continue;
  const raw = line.slice('data:'.length).trim();
  if (!raw || raw === '[DONE]') continue;
  try {
    const event = JSON.parse(raw);
    if (
      event.type === 'content_block_delta' &&
      event.delta?.type === 'text_delta'
    ) {
      streamedText += event.delta.text;
    }
  } catch {
    // Ignore non-JSON SSE data lines from compatible providers.
  }
}

if (
  !streamText.includes('message_start') ||
  !streamedText.includes('SPIKE8B_REAL_OK')
) {
  throw new Error(`unexpected stream response: ${streamText.slice(0, 1000)}`);
}

console.log('Real Anthropic-compatible gateway check passed');
