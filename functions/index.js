const { getApps, initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');
const { defineSecret } = require('firebase-functions/params');
const { onRequest } = require('firebase-functions/v2/https');

if (!getApps().length) initializeApp();

const turnKeyId = defineSecret('CLOUDFLARE_TURN_KEY_ID');
const turnApiToken = defineSecret('CLOUDFLARE_TURN_API_TOKEN');
const allowedOrigins = new Set([
  'https://meluni-f4e00.web.app',
  'https://meluni-f4e00.firebaseapp.com',
]);

function json(res, status, body) {
  res.status(status).set('Cache-Control', 'private, no-store').json(body);
}

exports.turnCredentials = onRequest({
  region: 'asia-northeast3',
  timeoutSeconds: 15,
  memory: '256MiB',
  secrets: [turnKeyId, turnApiToken],
}, async (req, res) => {
  const origin = req.get('origin') || '';
  if (origin && !allowedOrigins.has(origin)) return json(res, 403, { error: 'origin-not-allowed' });
  if (req.method !== 'POST') return json(res, 405, { error: 'method-not-allowed' });

  const authorization = req.get('authorization') || '';
  if (!authorization.startsWith('Bearer ')) return json(res, 401, { error: 'authentication-required' });

  let decoded;
  try {
    decoded = await getAuth().verifyIdToken(authorization.slice(7), true);
  } catch {
    return json(res, 401, { error: 'invalid-authentication' });
  }

  const coupleId = typeof req.body?.coupleId === 'string' ? req.body.coupleId.trim() : '';
  if (!coupleId || coupleId.length > 160) return json(res, 400, { error: 'invalid-couple' });

  const couple = await getFirestore().doc(`couples/${coupleId}`).get();
  const members = couple.exists && Array.isArray(couple.data()?.memberUids) ? couple.data().memberUids : [];
  if (members.length !== 2 || !members.includes(decoded.uid)) {
    return json(res, 403, { error: 'couple-membership-required' });
  }

  const response = await fetch(
    `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(turnKeyId.value())}/credentials/generate-ice-servers`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${turnApiToken.value()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ttl: 3600 }),
      signal: AbortSignal.timeout(8000),
    },
  );
  if (!response.ok) {
    console.error('[DANDULI TURN upstream]', response.status, await response.text());
    return json(res, 502, { error: 'turn-provider-unavailable' });
  }

  const payload = await response.json();
  const iceServers = Array.isArray(payload?.iceServers) ? payload.iceServers : [];
  if (!iceServers.some((server) => Array.isArray(server?.urls)
    && server.urls.some((url) => typeof url === 'string' && url.startsWith('turn')))) {
    return json(res, 502, { error: 'turn-credentials-invalid' });
  }
  return json(res, 201, { iceServers, expiresIn: 3600 });
});

// Optional NAVER Local Search endpoint. Requires two separate server-side secrets.
exports.searchDatePlaces = require('./localSearch').searchDatePlaces;
