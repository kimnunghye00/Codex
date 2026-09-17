const ALLOWED_ORIGINS = new Set([
  'https://meluni-f4e00.web.app',
  'https://meluni-f4e00.firebaseapp.com',
  'https://localhost', // Capacitor Android origin from capacitor.config.ts
  'capacitor://localhost',
]);
const UPSTREAM_TIMEOUT_MS = 4000;
const MAX_REQUEST_BYTES = 4096;

function response(origin, status, body) {
  const headers = {
    'Cache-Control': 'private, no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    Vary: 'Origin',
  };
  if (ALLOWED_ORIGINS.has(origin)) headers['Access-Control-Allow-Origin'] = origin;
  return new Response(JSON.stringify(body), { status, headers });
}

function validCoupleId(value) {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,160}$/.test(value);
}

async function readJson(request) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error('invalid-json');
  let size = 0;
  let text = '';
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_REQUEST_BYTES) {
        await reader.cancel();
        throw new Error('request-too-large');
      }
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } finally {
    reader.releaseLock();
  }
}

async function verifyCoupleMembership(env, firebaseToken, coupleId) {
  const projectId = encodeURIComponent(env.FIREBASE_PROJECT_ID);
  const documentPath = `couples/${encodeURIComponent(coupleId)}`;
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${documentPath}`;
  const check = await fetch(url, {
    headers: { Authorization: `Bearer ${firebaseToken}` },
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    redirect: 'error',
  });
  if (check.status === 401 || check.status === 403 || check.status === 404) return false;
  if (!check.ok) throw new Error('membership-check-unavailable');
  const data = await check.json();
  const members = data?.fields?.memberUids?.arrayValue?.values;
  return Array.isArray(members) && members.length === 2
    && members.every((member) => typeof member?.stringValue === 'string' && member.stringValue)
    && members[0].stringValue !== members[1].stringValue;
}

async function createTurnCredentials(env) {
  const keyId = encodeURIComponent(env.TURN_KEY_ID);
  return fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${keyId}/credentials/generate-ice-servers`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.TURN_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ttl: 3600 }),
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    redirect: 'error',
  });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    if (!ALLOWED_ORIGINS.has(origin)) return response(origin, 403, { error: 'origin-not-allowed' });

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Headers': 'Authorization, Content-Type',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Origin': origin,
          'Access-Control-Max-Age': '86400',
          Vary: 'Origin',
        },
      });
    }
    if (request.method !== 'POST') return response(origin, 405, { error: 'method-not-allowed' });

    const authorization = request.headers.get('Authorization') || '';
    if (!/^Bearer \S+$/.test(authorization) || authorization.length > 8192) {
      return response(origin, 401, { error: 'authentication-required' });
    }

    if (Number(request.headers.get('Content-Length')) > MAX_REQUEST_BYTES) {
      return response(origin, 413, { error: 'request-too-large' });
    }
    if (request.headers.get('Content-Type')?.split(';')[0].trim() !== 'application/json') {
      return response(origin, 415, { error: 'json-required' });
    }
    let body;
    try {
      body = await readJson(request);
    } catch (cause) {
      const tooLarge = cause instanceof Error && cause.message === 'request-too-large';
      return response(origin, tooLarge ? 413 : 400, { error: tooLarge ? 'request-too-large' : 'invalid-json' });
    }
    if (!validCoupleId(body?.coupleId)) return response(origin, 400, { error: 'invalid-couple' });
    if (!env.FIREBASE_PROJECT_ID || !env.TURN_KEY_ID || !env.TURN_API_TOKEN) {
      return response(origin, 503, { error: 'turn-not-configured' });
    }

    let member = false;
    try {
      member = await verifyCoupleMembership(env, authorization.slice(7), body.coupleId.trim());
    } catch {
      return response(origin, 503, { error: 'membership-check-unavailable' });
    }
    if (!member) return response(origin, 403, { error: 'couple-membership-required' });

    let upstream;
    try {
      upstream = await createTurnCredentials(env);
    } catch {
      return response(origin, 502, { error: 'turn-provider-unavailable' });
    }
    if (!upstream.ok) return response(origin, 502, { error: 'turn-provider-unavailable' });

    let payload;
    try {
      payload = await upstream.json();
    } catch {
      return response(origin, 502, { error: 'turn-credentials-invalid' });
    }
    const iceServers = (Array.isArray(payload?.iceServers) ? payload.iceServers : []).slice(0, 16).filter((server) => {
      const urls = Array.isArray(server?.urls) ? server.urls : [server?.urls];
      if (!urls.length || urls.length > 8 || !urls.every((url) =>
        typeof url === 'string' && /^(stun|stuns|turn|turns):[^\s]+$/.test(url))) return false;
      return !urls.some((url) => /^turns?:/.test(url))
        || (typeof server.username === 'string' && server.username.length > 0
          && typeof server.credential === 'string' && server.credential.length > 0);
    }).map(({ urls, username, credential }) => ({ urls, username, credential }));
    const hasTurn = iceServers.some((server) => {
      const urls = Array.isArray(server?.urls) ? server.urls : [server?.urls];
      return urls.some((url) => typeof url === 'string' && /^turns?:/.test(url));
    });
    if (!hasTurn) return response(origin, 502, { error: 'turn-credentials-invalid' });
    return response(origin, 201, { iceServers, expiresIn: 3600 });
  },
};
