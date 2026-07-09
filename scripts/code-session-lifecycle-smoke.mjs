const defaultBaseUrl =
  'https://codeagent-spike-integrated-session-mvp.eric-wuyu1352.workers.dev';

const baseUrl = (
  process.argv[2] ||
  process.env.CODE_RUNTIME_BASE_URL ||
  process.env.VITE_RUNTIME_BASE_URL ||
  defaultBaseUrl
).replace(/\/$/, '');
const runId = Date.now().toString(36);
const userId = process.env.CODE_LIFECYCLE_USER || `hicode-smoke-${runId}`;
const sessionId = process.env.CODE_LIFECYCLE_SESSION || `s-lifecycle-${runId}`;
const agent = process.env.CODE_LIFECYCLE_AGENT || '';
const model = process.env.CODE_LIFECYCLE_MODEL || '';

function runtimeUrl(path) {
  const url = new URL(path, baseUrl);
  if (agent) url.searchParams.set('agent', agent);
  if (model) url.searchParams.set('model', model);
  return url;
}

async function requestJson(path, options = {}) {
  const response = await fetch(runtimeUrl(path), {
    ...options,
    signal: AbortSignal.timeout(120_000),
  });
  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(text);
  }

  if (!response.ok || payload?.ok === false) {
    const error =
      typeof payload?.error === 'string'
        ? payload.error
        : JSON.stringify(payload, null, 2);
    throw new Error(`${response.status} ${error}`);
  }

  return payload;
}

function digestFromArchive(payload) {
  return payload?.workspaceDigest || payload?.archiveSha256 || payload?.digest;
}

function digestFromRestore(payload) {
  return (
    digestFromArchive(payload) ||
    digestFromArchive(payload?.restored) ||
    payload?.objectMetadata?.workspaceDigest
  );
}

function assertDigest(label, actual, expected) {
  if (!actual) throw new Error(`${label} digest missing`);
  if (expected && actual !== expected) {
    throw new Error(
      `${label} digest mismatch: expected=${expected} actual=${actual}`
    );
  }
}

async function main() {
  console.log(`runtime: ${baseUrl}`);
  console.log(`user: ${userId}`);
  console.log(`session: ${sessionId}`);

  const sessionPath = `/${encodeURIComponent(userId)}/${encodeURIComponent(
    sessionId
  )}`;

  const seeded = await requestJson(`/seed${sessionPath}`, { method: 'POST' });
  assertDigest('seed', seeded.digest);

  const before = await requestJson(`/inspect${sessionPath}`);
  assertDigest('inspect before archive', before.digest, seeded.digest);

  const archived = await requestJson(`/archive${sessionPath}`);
  const archiveDigest = digestFromArchive(archived);
  assertDigest('archive', archiveDigest, before.digest);
  if (!archived.key) throw new Error('archive key missing');

  await requestJson(`/clear${sessionPath}`, { method: 'POST' });

  const restored = await requestJson(`/restore${sessionPath}`, {
    method: 'POST',
  });
  assertDigest('restore', digestFromRestore(restored), archiveDigest);

  const after = await requestJson(`/inspect${sessionPath}`);
  assertDigest('inspect after restore', after.digest, archiveDigest);

  console.log('code session lifecycle smoke passed');
  console.log(`archive: ${archived.key}`);
  console.log(`digest: ${after.digest}`);
}

try {
  await main();
} finally {
  await requestJson(
    `/destroy/${encodeURIComponent(userId)}/${encodeURIComponent(sessionId)}`,
    { method: 'POST' }
  ).catch((error) => {
    console.warn(`cleanup failed: ${error.message || String(error)}`);
  });
}
