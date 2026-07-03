import assert from 'node:assert/strict';

import {
  actionUrl,
  generateSessionId,
  normalizeAgent,
  previewUrl,
  sanitizeUserId,
  terminalHttpUrl,
  terminalWsUrl,
} from './runtime';

// sanitizeUserId
assert.equal(sanitizeUserId('User_123!@#'), 'user-123');
assert.equal(sanitizeUserId('  --Ab--  '), 'ab');
assert.equal(sanitizeUserId(''), 'user');
assert.equal(sanitizeUserId('已经abc'), 'abc');

// normalizeAgent
assert.equal(normalizeAgent('codex'), 'codex');
assert.equal(normalizeAgent('claude'), 'claude');
assert.equal(normalizeAgent('unknown'), 'claude');

// generateSessionId
const a = generateSessionId();
const b = generateSessionId();
assert.match(a, /^[a-z0-9-]+$/);
assert.notEqual(a, b);

// terminalWsUrl
assert.equal(
  terminalHttpUrl('https://rt.example.dev', 'u1', 's1'),
  'https://rt.example.dev/terminal/u1/s1'
);
assert.equal(
  terminalHttpUrl('https://rt.example.dev', 'u1', 's1', 'codex', 'm1'),
  'https://rt.example.dev/terminal/u1/s1?agent=codex&model=m1'
);
assert.equal(
  terminalWsUrl('https://rt.example.dev', 'u1', 's1'),
  'wss://rt.example.dev/terminal/u1/s1'
);
assert.equal(
  terminalWsUrl('http://localhost:8787', 'u1', 's1'),
  'ws://localhost:8787/terminal/u1/s1'
);
assert.equal(
  terminalWsUrl('https://rt.example.dev', 'u1', 's1', 'codex'),
  'wss://rt.example.dev/terminal/u1/s1?agent=codex'
);
assert.equal(
  terminalWsUrl('https://rt.example.dev', 'u1', 's1', 'claude', 'm1'),
  'wss://rt.example.dev/terminal/u1/s1?model=m1'
);
assert.equal(
  terminalWsUrl('https://rt.example.dev', 'u1', 's1', 'codex', 'm1'),
  'wss://rt.example.dev/terminal/u1/s1?agent=codex&model=m1'
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
assert.equal(
  actionUrl('https://rt.example.dev', 'clear', 'u1', 's1', 'codex'),
  'https://rt.example.dev/clear/u1/s1?agent=codex'
);
assert.equal(
  actionUrl('https://rt.example.dev', 'clear', 'u1', 's1', 'codex', 'm1'),
  'https://rt.example.dev/clear/u1/s1?agent=codex&model=m1'
);

// previewUrl
assert.equal(
  previewUrl('https://rt.example.dev', 'u1', 's1'),
  'https://rt.example.dev/preview/u1/s1/'
);

console.log('runtime.test.ts OK');
