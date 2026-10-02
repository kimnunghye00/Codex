const { randomUUID } = require('node:crypto');
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

  const action = req.body?.action || 'request';
  if (!['request', 'accept', 'reject', 'cancel'].includes(action)) return json(req, res, 400, { error: 'invalid-delete-action' });
  const requestId = typeof req.body?.requestId === 'string' ? req.body.requestId : '';
  const newRequestId = randomUUID();
  const firestore = getFirestore();
  const coupleRef = firestore.doc('couples/' + coupleId);
  const planRef = firestore.doc('couples/' + coupleId + '/datePlans/' + planId);

  try {
    const result = await firestore.runTransaction(async (transaction) => {
      const [couple, plan] = await Promise.all([
        transaction.get(coupleRef),
        transaction.get(planRef),
      ]);
      const members = couple.exists && Array.isArray(couple.data()?.memberUids) ? couple.data().memberUids : [];
      if (members.length !== 2 || !members.includes(decoded.uid)) {
        const error = new Error('couple-membership-required'); error.status = 403; throw error;
      }
      if (!plan.exists) {
        const error = new Error('date-plan-missing'); error.status = 404; throw error;
      }
      const data = plan.data();
      const pending = data.deletionRequest;
      const partner = members.find((uid) => uid !== decoded.uid);
      const fail = (message, status = 409) => { const error = new Error(message); error.status = status; throw error; };
      const notify = (id, title, recipientUid) => transaction.set(firestore.doc('couples/' + coupleId + '/activity/' + id), {
        id, authorUid: decoded.uid, recipientUid, kind: 'date-plan', sourceId: planId, revision: 1,
        title, detail: (data.title || '이름 없는 데이트').slice(0, 100),
        target: { screen: 'date-plan', itemId: planId }, createdAt: FieldValue.serverTimestamp(),
      });
      if (action === 'request') {
        if (pending) return { requested: true, requestId: pending.id };
        if (data.deletionRequestedAt) fail('date-plan-deleting');
        transaction.update(planRef, { deletionRequest: {
          id: newRequestId, requestedBy: decoded.uid, recipientUid: partner,
          status: 'pending', requestedAt: FieldValue.serverTimestamp(),
        } });
        notify('plan-delete-' + newRequestId, '데이트 초안 삭제 요청이 왔어요', partner);
        return { requested: true, requestId: newRequestId };
      }
      if (!pending || pending.id !== requestId) fail('date-plan-delete-request-changed');
      if (action === 'cancel') {
        if (pending.requestedBy !== decoded.uid) fail('delete-request-author-required', 403);
      } else if (pending.recipientUid !== decoded.uid || pending.requestedBy === decoded.uid) {
        fail('delete-request-partner-required', 403);
      }
      if (action === 'accept') {
        if (!['pending', 'deleting'].includes(pending.status)) fail('date-plan-delete-request-changed');
        transaction.update(planRef, {
          'deletionRequest.status': 'deleting',
          deletionRequestedAt: FieldValue.serverTimestamp(), deletionRequestedBy: pending.requestedBy,
        });
        if (pending.status === 'pending') notify('plan-delete-accepted-' + pending.id, '상대방이 초안 삭제 요청을 수락했어요', pending.requestedBy);
        return { deleteNow: true };
      }
      if (pending.status !== 'pending') fail('date-plan-deleting');
      transaction.update(planRef, { deletionRequest: FieldValue.delete() });
      transaction.delete(firestore.doc('couples/' + coupleId + '/activity/plan-delete-' + pending.id));
      notify('plan-delete-' + action + '-' + pending.id,
        action === 'cancel' ? '초안 삭제 요청이 취소됐어요' : '초안 삭제 요청이 거절됐어요', partner);
      return { cancelled: action === 'cancel', rejected: action === 'reject' };
    });

    if (result.deleteNow) {
      await firestore.recursiveDelete(planRef);
      return json(req, res, 200, { deleted: true });
    }
    return json(req, res, 200, result);
  } catch (error) {
    const status = Number(error?.status) || 500;
    if (status >= 500) console.error('[DANDULI delete date plan]', coupleId, planId, error);
    return json(req, res, status, { error: error?.message || 'date-plan-delete-failed' });
  }
});
