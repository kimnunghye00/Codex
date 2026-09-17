const ALLOWED_ORIGINS = new Set([
  'https://meluni-f4e00.web.app',
  'https://meluni-f4e00.firebaseapp.com',
]);

function response(origin, status, body) {
  const headers = {
    'Cache-Control': 'private, no-store',
    'Content-Type': 'application/json; charset=utf-8',
    Vary: 'Origin',
  };
  if (ALLOWED_ORIGINS.has(origin)) headers['Access-Control-Allow-Origin'] = origin;
  return new Response(JSON.stringify(body), { status, headers });
}

function validCoupleId(value) {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 160;
}

async function verifyCoupleMembership(env, firebaseToken, coupleId) {
  const projectId = encodeURIComponent(env.FIREBASE_PROJECT_ID);
  const documentPath = `couples/${encodeURIComponent(coupleId)}`;
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${documentPath}`;
  const check = await fetch(url, {
    headers: { Authorization: `Bearer ${firebaseToken}` },
    signal: AbortSignal.timeout(8000),
  });
  return check.ok;
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
    signal: AbortSignal.timeout(8000),
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
    if (!authorization.startsWith('Bearer ')) {
      return response(origin, 401, { error: 'authentication-required' });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return response(origin, 400, { error: 'invalid-json' });
    }
    if (!validCoupleId(body?.coupleId)) return response(origin, 400, { error: 'invalid-couple' });

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

    const payload = await upstream.json();
    const iceServers = Array.isArray(payload?.iceServers) ? payload.iceServers : [];
    const hasTurn = iceServers.some((server) => {
      const urls = Array.isArray(server?.urls) ? server.urls : [server?.urls];
      return urls.some((url) => typeof url === 'string' && /^turns?:/.test(url));
    });
    if (!hasTurn) return response(origin, 502, { error: 'turn-credentials-invalid' });
    return response(origin, 201, { iceServers, expiresIn: 3600 });
  },
};
