const { getApps, initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { FieldValue, getFirestore } = require('firebase-admin/firestore');
const { onRequest } = require('firebase-functions/v2/https');

if (!getApps().length) initializeApp();

const allowedOrigins = new Set([
  'https://meluni-f4e00.web.app',
  'https://meluni-f4e00.firebaseapp.com',
  'https://danduli.web.app',
  'https://danduli.firebaseapp.com',
  'http://localhost:5173',
]);

function setCors(req, res) {
  const origin = req.get('origin') || '';
  if (origin && allowedOrigins.has(origin)) {
    res.set('Access-Control-Allow-Origin', origin);
    res.set('Vary', 'Origin');
    res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  }
  return origin;
}

function json(req, res, status, body) {
  setCors(req, res);
  res.status(status).set('Cache-Control', 'private, no-store').json(body);
}

exports.deleteDatePlanDraftV2 = onRequest({
  region: 'asia-northeast3',
  timeoutSeconds: 30,
  memory: '256MiB',
}, async (req, res) => {
  const origin = setCors(req, res);
  if (origin && !allowedOrigins.has(origin)) return json(req, res, 403, { error: 'origin-not-allowed' });
  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (req.method !== 'POST') return json(req, res, 405, { error: 'method-not-allowed' });

  const authorization = req.get('authorization') || '';
  if (!authorization.startsWith('Bearer ')) return json(req, res, 401, { error: 'authentication-required' });

  let decoded;
  try {
    decoded = await getAuth().verifyIdToken(authorization.slice(7), true);
  } catch {
    return json(req, res, 401, { error: 'invalid-authentication' });
  }

  const coupleId = typeof req.body?.coupleId === 'string' ? req.body.coupleId.trim() : '';
  const planId = typeof req.body?.planId === 'string' ? req.body.planId.trim() : '';
  const validId = (value) => /^[A-Za-z0-9_-]{1,160}$/.test(value);
  if (!validId(coupleId) || !validId(planId)) return json(req, res, 400, { error: 'invalid-date-plan' });

  const firestore = getFirestore();
  const coupleRef = firestore.doc('couples/' + coupleId);
  const planRef = firestore.doc('couples/' + coupleId + '/datePlans/' + planId);
  const approvalRef = firestore.doc('couples/' + coupleId + '/datePlans/' + planId + '/approval/state');

  try {
    await firestore.runTransaction(async (transaction) => {
      const [couple, plan, approval] = await Promise.all([
        transaction.get(coupleRef),
        transaction.get(planRef),
        transaction.get(approvalRef),
      ]);
      const members = couple.exists && Array.isArray(couple.data()?.memberUids) ? couple.data().memberUids : [];
      if (members.length !== 2 || !members.includes(decoded.uid)) {
        const error = new Error('couple-membership-required'); error.status = 403; throw error;
      }
      if (!plan.exists) {
        const error = new Error('date-plan-missing'); error.status = 404; throw error;
      }
      if (approval.exists || plan.data()?.status !== 'draft') {
        const error = new Error('date-plan-delete-locked'); error.status = 409; throw error;
      }
      transaction.update(planRef, {
        deletionRequestedAt: FieldValue.serverTimestamp(),
        deletionRequestedBy: decoded.uid,
      });
    });

    await firestore.recursiveDelete(planRef);
    return json(req, res, 200, { deleted: true });
  } catch (error) {
    const status = Number(error?.status) || 500;
    if (status >= 500) console.error('[DANDULI delete date plan]', coupleId, planId, error);
    return json(req, res, status, { error: error?.message || 'date-plan-delete-failed' });
  }
});
