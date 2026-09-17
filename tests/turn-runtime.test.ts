import test from 'node:test';
import assert from 'node:assert/strict';
import { createTurnCredentialClient, validTurnIceServers } from '../src/lib/turnCredentialClient.ts';
import worker from '../workers/turn-credentials/src/index.js';

const endpoint = 'https://turn.example.test';
const iceServers = [{ urls: ['turn:turn.example.test:3478'], username: 'temporary-user', credential: 'temporary-password' }];
const payload = () => Response.json({ iceServers, expiresIn: 3600 });
const userA = { uid: 'a', getIdToken: async () => 'firebase-test-token' };
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
};

test('TURN absent endpoint and signed-out users never make requests', async () => {
  let user: typeof userA | null = userA;
  let requests = 0;
  const client = createTurnCredentialClient({ getUser: () => user, fetcher: async () => { requests++; return payload(); } });
  assert.deepEqual(await client.load('couple', ''), []);
  await client.load('couple', endpoint);
  user = null;
  assert.deepEqual(await client.load('couple', endpoint), []);
  assert.equal(requests, 1);
});

test('TURN coalesces concurrent requests and reuses only the same account/couple/endpoint', async () => {
  let user = userA;
  let requests = 0;
  let time = 1000;
  const client = createTurnCredentialClient({ getUser: () => user, now: () => time, fetcher: async (_, options) => {
    requests++;
    assert.equal(options?.credentials, 'omit');
    assert.equal(options?.redirect, 'error');
    return payload();
  } });
  const first = client.load('couple', endpoint);
  assert.equal(client.load('couple', endpoint), first);
  await first;
  await client.load('couple', endpoint);
  assert.equal(requests, 1);
  time += 3_400_000;
  await client.load('couple', endpoint);
  assert.equal(requests, 2);
  user = { ...userA, uid: 'b' };
  await client.load('couple', endpoint);
  await client.load('other-couple', endpoint);
  await client.load('other-couple', `${endpoint}/v2`);
  assert.equal(requests, 5);
});

test('TURN cancellation rejects immediately and late response cannot overwrite a newer cache', async () => {
  const late = deferred<Response>();
  let requests = 0;
  const client = createTurnCredentialClient({ getUser: () => userA, fetcher: async () => ++requests === 1 ? late.promise : payload() });
  const old = client.load('old', endpoint);
  const rejected = assert.rejects(old, /cancelled/);
  await Promise.resolve();
  const current = await client.load('new', endpoint);
  await rejected;
  late.resolve(payload());
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(await client.load('new', endpoint), current);
  assert.equal(requests, 2);
});

test('TURN rejects a response after sign-out even without another load', async () => {
  let user: typeof userA | null = userA;
  const late = deferred<Response>();
  const client = createTurnCredentialClient({ getUser: () => user, fetcher: () => late.promise });
  const pending = client.load('couple', endpoint);
  const rejected = assert.rejects(pending, /cancelled/);
  await Promise.resolve();
  user = null;
  late.resolve(payload());
  await rejected;
});

test('TURN timeout covers stalled token, network and JSON parsing; later retry works', async () => {
  for (const stage of ['token', 'fetch', 'json']) {
    let stalled = true;
    let signal: AbortSignal | null | undefined;
    const never = new Promise<never>(() => {});
    const user = { uid: 'a', getIdToken: () => stalled && stage === 'token' ? never : Promise.resolve('token') };
    const client = createTurnCredentialClient({ getUser: () => user, timeoutMs: 10, fetcher: async (_, options) => {
      signal = options?.signal;
      if (stalled && stage === 'fetch') return never;
      if (stalled && stage === 'json') return { ok: true, json: () => never } as unknown as Response;
      return payload();
    } });
    await assert.rejects(client.load('couple', endpoint), /timeout/);
    if (signal) assert.equal(signal.aborted, true);
    stalled = false;
    assert.deepEqual(await client.load('couple', endpoint), iceServers);
  }
});

test('TURN never extends short TTL and rejects invalid expiry/credentials', async () => {
  let requests = 0;
  const client = createTurnCredentialClient({ getUser: () => userA, fetcher: async () => {
    requests++;
    return Response.json({ iceServers, expiresIn: 60 });
  } });
  await client.load('couple', endpoint);
  await client.load('couple', endpoint);
  assert.equal(requests, 2);
  for (const expiresIn of [0, -1, null, '3600', undefined]) {
    const invalid = createTurnCredentialClient({ getUser: () => userA, fetcher: async () => Response.json({ iceServers, expiresIn }) });
    await assert.rejects(invalid.load('couple', endpoint), /invalid-ttl/);
  }
  assert.deepEqual(validTurnIceServers([null, {}, { urls: [] }, { urls: 'https://bad' }, { urls: 'turn:host' }]), []);
  assert.deepEqual(validTurnIceServers([{ urls: 'turns:host', username: 'u', credential: 'p', unsupported: true }]), [
    { urls: ['turns:host'], username: 'u', credential: 'p' },
  ]);
});

const env = { FIREBASE_PROJECT_ID: 'demo-danduli-security', TURN_KEY_ID: 'test-key', TURN_API_TOKEN: 'server-only-secret' };
function request(body: unknown = { coupleId: 'couple-123' }, headers: Record<string, string> = {}) {
  return new Request(endpoint, { method: 'POST', headers: {
    Origin: 'https://meluni-f4e00.web.app', Authorization: 'Bearer firebase-test-token', 'Content-Type': 'application/json', ...headers,
  }, body: JSON.stringify(body) });
}
const members = () => Response.json({ fields: { memberUids: { arrayValue: { values: [{ stringValue: 'a' }, { stringValue: 'b' }] } } } });

test('Worker rejects invalid origins, auth, document paths, oversized bodies and missing configuration without upstream calls', async (t) => {
  const upstream = t.mock.method(globalThis, 'fetch', async () => { throw new Error('must not call'); });
  for (const [input, status] of [
    [request({}, { Origin: 'https://evil.test' }), 403],
    [request({}, { Authorization: 'Bearer ' }), 401],
    [request({}, { 'Content-Type': 'text/plain' }), 415],
    [request({ coupleId: '../users/a' }), 400],
    [request({ coupleId: 'a%2Fb' }), 400],
    [request({ coupleId: '.' }), 400],
    [request({ coupleId: 'x'.repeat(5000) }), 413],
    [request({}, { 'Content-Length': '5000' }), 413],
  ] as const) {
    assert.equal((await worker.fetch(input, env)).status, status);
  }
  assert.equal((await worker.fetch(request(), {})).status, 503);
  assert.equal(upstream.mock.callCount(), 0);
});

test('Worker supports exact web/native origins, preflight and authenticated membership', async (t) => {
  const calls: Array<{ url: string; options: RequestInit }> = [];
  t.mock.method(globalThis, 'fetch', async (url: string, options: RequestInit) => {
    calls.push({ url, options });
    return url.startsWith('https://firestore.googleapis.com/') ? members() : Response.json({ iceServers });
  });
  for (const Origin of ['https://meluni-f4e00.web.app', 'https://meluni-f4e00.firebaseapp.com', 'https://localhost', 'capacitor://localhost']) {
    const preflight = await worker.fetch(new Request(endpoint, { method: 'OPTIONS', headers: { Origin } }), env);
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), Origin);
    const response = await worker.fetch(request(undefined, { Origin }), env);
    assert.equal(response.status, 201);
    assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
    const result = await response.text();
    assert.equal(result.includes(env.TURN_API_TOKEN), false);
    assert.deepEqual(JSON.parse(result), { iceServers, expiresIn: 3600 });
  }
  assert.equal(calls.length, 8);
  assert.equal((calls[0].options.headers as Record<string, string>).Authorization, 'Bearer firebase-test-token');
  assert.equal((calls[1].options.headers as Record<string, string>).Authorization, `Bearer ${env.TURN_API_TOKEN}`);
});

test('Worker fails closed on membership denial and distinguishes transient upstream errors', async (t) => {
  for (const [status, expected] of [[401, 403], [403, 403], [404, 403], [429, 503], [500, 503]]) {
    const upstream = t.mock.method(globalThis, 'fetch', async () => new Response('', { status }));
    assert.equal((await worker.fetch(request(), env)).status, expected);
    assert.equal(upstream.mock.callCount(), 1);
    upstream.mock.restore();
  }
  const upstream = t.mock.method(globalThis, 'fetch', async () => Response.json({ fields: {} }));
  assert.equal((await worker.fetch(request(), env)).status, 403);
  assert.equal(upstream.mock.callCount(), 1);
});

test('Worker handles provider network errors, invalid JSON and malformed ICE without crashing or exposing errors', async (t) => {
  for (const provider of [
    () => { throw new Error('secret-provider-details'); },
    () => new Response('upstream error', { status: 500 }),
    () => new Response('<html>not JSON</html>'),
    () => Response.json({ iceServers: [null, { urls: 'turn:host' }] }),
    () => Response.json({ iceServers: [{ urls: 'https://bad', username: 'u', credential: 'p' }] }),
  ]) {
    const upstream = t.mock.method(globalThis, 'fetch', async (url: string) => url.includes('firestore.googleapis.com') ? members() : provider());
    const response = await worker.fetch(request(), env);
    assert.equal(response.status, 502);
    assert.equal((await response.text()).includes('secret-provider-details'), false);
    upstream.mock.restore();
  }
});
