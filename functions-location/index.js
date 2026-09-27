const crypto = require('node:crypto');
const { getApps, initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { FieldValue, getFirestore, Timestamp } = require('firebase-admin/firestore');
const { onRequest } = require('firebase-functions/v2/https');

if (!getApps().length) initializeApp();

const REGION = 'asia-northeast3';
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_BATCH = 24;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_FUTURE_MS = 5 * 60 * 1000;
const MAX_ACCURACY_METERS = 300;
const allowedOrigins = new Set([
  'https://meluni-f4e00.web.app',
  'https://meluni-f4e00.firebaseapp.com',
  'https://danduli.web.app',
  'https://danduli.firebaseapp.com',
  'http://localhost:5173',
  'http://localhost',
  'capacitor://localhost',
]);

function json(res, status, body) {
  res.status(status).set('Cache-Control', 'private, no-store').json(body);
}

function allowCors(req, res) {
  const origin = req.get('origin') || '';
  if (!origin) return true;
  if (!allowedOrigins.has(origin)) {
    json(res, 403, { error: 'origin-not-allowed' });
    return false;
  }
  res.set('Access-Control-Allow-Origin', origin);
  res.set('Vary', 'Origin');
  res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return false;
  }
  return true;
}

function validId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(value);
}

function hashSecret(secret) {
  return crypto.createHash('sha256').update(secret, 'utf8').digest('hex');
}

function safeEqualHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}

function dayKeyFromMs(value) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(value));
  const part = (type) => parts.find((item) => item.type === type)?.value || '';
  return part('year') + '-' + part('month') + '-' + part('day');
}

function normalizePoint(value, now = Date.now()) {
  if (!value || typeof value !== 'object') return null;
  const latitude = Number(value.latitude);
  const longitude = Number(value.longitude);
  const accuracy = Number(value.accuracy);
  const timestamp = Number(value.timestamp);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) return null;
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) return null;
  if (!Number.isFinite(accuracy) || accuracy < 0 || accuracy > MAX_ACCURACY_METERS) return null;
  if (!Number.isFinite(timestamp) || timestamp < now - MAX_AGE_MS || timestamp > now + MAX_FUTURE_MS) return null;
  return {
    latitude,
    longitude,
    accuracy,
    timestamp: Math.round(timestamp),
    background: value.background !== false,
  };
}

async function authenticatedUser(req, res) {
  const authorization = req.get('authorization') || '';
  if (!authorization.startsWith('Bearer ')) {
    json(res, 401, { error: 'authentication-required' });
    return null;
  }
  try {
    return await getAuth().verifyIdToken(authorization.slice(7), true);
  } catch {
    json(res, 401, { error: 'invalid-authentication' });
    return null;
  }
}

async function verifyMembership(coupleId, uid) {
  const couple = await getFirestore().doc('couples/' + coupleId).get();
  const members = couple.exists && Array.isArray(couple.data()?.memberUids) ? couple.data().memberUids : [];
  return members.length === 2 && members.includes(uid);
}

exports.registerLocationUploadDevice = onRequest({
  region: REGION,
  timeoutSeconds: 15,
  memory: '256MiB',
}, async (req, res) => {
  if (!allowCors(req, res)) return;
  if (req.method !== 'POST') return json(res, 405, { error: 'method-not-allowed' });
  const decoded = await authenticatedUser(req, res);
  if (!decoded) return;

  const coupleId = typeof req.body?.coupleId === 'string' ? req.body.coupleId.trim() : '';
  if (!validId(coupleId)) return json(res, 400, { error: 'invalid-couple' });
  if (!(await verifyMembership(coupleId, decoded.uid))) {
    return json(res, 403, { error: 'couple-membership-required' });
  }

  const secret = crypto.randomBytes(32).toString('base64url');
  const expiresAtMs = Date.now() + TOKEN_TTL_MS;
  const tokenRef = getFirestore().doc('couples/' + coupleId + '/locationUploadTokens/' + decoded.uid);
  await tokenRef.set({
    ownerUid: decoded.uid,
    coupleId,
    secretHash: hashSecret(secret),
    createdAt: FieldValue.serverTimestamp(),
    expiresAt: Timestamp.fromMillis(expiresAtMs),
  });

  return json(res, 201, {
    ownerUid: decoded.uid,
    coupleId,
    secret,
    expiresAt: new Date(expiresAtMs).toISOString(),
  });
});

exports.revokeLocationUploadDevice = onRequest({
  region: REGION,
  timeoutSeconds: 15,
  memory: '256MiB',
}, async (req, res) => {
  if (!allowCors(req, res)) return;
  if (req.method !== 'POST') return json(res, 405, { error: 'method-not-allowed' });
  const decoded = await authenticatedUser(req, res);
  if (!decoded) return;

  const coupleId = typeof req.body?.coupleId === 'string' ? req.body.coupleId.trim() : '';
  if (!validId(coupleId)) return json(res, 400, { error: 'invalid-couple' });

  const tokenRef = getFirestore().doc('couples/' + coupleId + '/locationUploadTokens/' + decoded.uid);
  const tokenDoc = await tokenRef.get();
  if (tokenDoc.exists && tokenDoc.data()?.ownerUid !== decoded.uid) {
    return json(res, 403, { error: 'upload-token-owner-mismatch' });
  }
  await tokenRef.delete();
  return json(res, 200, { revoked: true });
});

exports.uploadBackgroundLocation = onRequest({
  region: REGION,
  timeoutSeconds: 20,
  memory: '256MiB',
}, async (req, res) => {
  if (req.method !== 'POST') return json(res, 405, { error: 'method-not-allowed' });

  const coupleId = typeof req.body?.coupleId === 'string' ? req.body.coupleId.trim() : '';
  const ownerUid = typeof req.body?.ownerUid === 'string' ? req.body.ownerUid.trim() : '';
  const secret = typeof req.body?.secret === 'string' ? req.body.secret.trim() : '';
  const points = Array.isArray(req.body?.points) ? req.body.points : [];

  if (!validId(coupleId) || !validId(ownerUid) || secret.length < 32 || secret.length > 128) {
    return json(res, 400, { error: 'invalid-upload-credential' });
  }
  if (!points.length || points.length > MAX_BATCH) {
    return json(res, 400, { error: 'invalid-location-batch' });
  }

  const firestore = getFirestore();
  const tokenRef = firestore.doc('couples/' + coupleId + '/locationUploadTokens/' + ownerUid);
  const [tokenDoc, coupleDoc] = await Promise.all([
    tokenRef.get(),
    firestore.doc('couples/' + coupleId).get(),
  ]);
  const members = coupleDoc.exists && Array.isArray(coupleDoc.data()?.memberUids) ? coupleDoc.data().memberUids : [];
  const token = tokenDoc.exists ? tokenDoc.data() : null;
  const expiresAtMs = token?.expiresAt?.toMillis?.() || 0;

  if (members.length !== 2 || !members.includes(ownerUid)
    || token?.ownerUid !== ownerUid || token?.coupleId !== coupleId
    || expiresAtMs <= Date.now()
    || !safeEqualHex(hashSecret(secret), token?.secretHash || '')) {
    return json(res, 401, { error: 'invalid-upload-credential' });
  }

  const now = Date.now();
  const normalized = points.map((point) => normalizePoint(point, now));
  if (normalized.some((point) => point == null)) {
    return json(res, 400, { error: 'invalid-location-point' });
  }

  const batch = firestore.batch();
  for (const point of normalized) {
    const id = String(point.timestamp);
    const sampleRef = firestore.doc('couples/' + coupleId + '/locationSamples/' + ownerUid + '-' + id);
    batch.set(sampleRef, {
      id,
      ownerUid,
      dayKey: dayKeyFromMs(point.timestamp),
      latitude: point.latitude,
      longitude: point.longitude,
      accuracy: point.accuracy,
      recordedAt: new Date(point.timestamp).toISOString(),
      background: point.background,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  }
  batch.update(tokenRef, { lastUploadAt: FieldValue.serverTimestamp() });
  await batch.commit();

  return json(res, 200, {
    accepted: normalized.length,
    latestTimestamp: normalized[normalized.length - 1].timestamp,
  });
});

exports.__test = {
  hashSecret,
  safeEqualHex,
  dayKeyFromMs,
  normalizePoint,
  constants: { MAX_BATCH, MAX_AGE_MS, MAX_FUTURE_MS, MAX_ACCURACY_METERS },
};
