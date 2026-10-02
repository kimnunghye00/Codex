const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function fixture(uid = 'alice', planData = { status: 'draft', title: '데이트' }) {
  const values = new Map([['couples/pair', { memberUids: ['alice', 'bob'] }], ['couples/pair/datePlans/plan', planData]]);
  let deleted = false;
  const firestore = {
    doc: (id) => ({ path: id }),
    runTransaction: async (fn) => {
      const writes = [];
      const result = await fn({
        get: async (ref) => ({ exists: values.has(ref.path), data: () => values.get(ref.path) }),
        update: (ref, patch) => writes.push(() => {
          const value = { ...values.get(ref.path) };
          for (const [key, entry] of Object.entries(patch)) {
            if (entry === 'DELETE') delete value[key];
            else if (key === 'deletionRequest.status') value.deletionRequest = { ...value.deletionRequest, status: entry };
            else value[key] = entry;
          }
          values.set(ref.path, value);
        }),
        set: (ref, data) => writes.push(() => values.set(ref.path, data)),
        delete: (ref) => writes.push(() => values.delete(ref.path)),
      });
      writes.forEach((write) => write());
      return result;
    },
    recursiveDelete: async (ref) => { deleted = true; values.delete(ref.path); },
  };
  const exports = {};
  const modules = {
    'node:crypto': { randomUUID: () => 'request-1' },
    'firebase-admin/app': { getApps: () => [true] },
    'firebase-admin/auth': { getAuth: () => ({ verifyIdToken: async () => ({ uid }) }) },
    'firebase-admin/firestore': { getFirestore: () => firestore, FieldValue: { serverTimestamp: () => 'TIME', delete: () => 'DELETE' } },
    'firebase-functions/v2/https': { onRequest: (_, handler) => handler },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../index.js'), 'utf8'), { require: (name) => modules[name], exports, console });
  return { values, deleted: () => deleted, call: async (action, requestId) => {
    let status, body;
    const res = { set() { return this; }, status(value) { status = value; return this; }, json(value) { body = value; }, send() {} };
    await exports.deleteDatePlanDraftV2({ method: 'POST', get: (key) => key === 'authorization' ? 'Bearer token' : '', body: { coupleId: 'pair', planId: 'plan', action, requestId } }, res);
    return { status, body };
  } };
}

test('request on approval-locked draft notifies partner without deleting', async () => {
  const f = fixture();
  f.values.set('couples/pair/datePlans/plan/approval/state', { status: 'review' });
  assert.equal((await f.call('request')).status, 200);
  assert.equal(f.deleted(), false);
  assert.equal(f.values.get('couples/pair/activity/plan-delete-request-1').recipientUid, 'bob');
  assert.equal((await f.call('request')).body.requestId, 'request-1');
});
test('requester cannot accept own request and outsider cannot request', async () => {
  const f = fixture(); await f.call('request');
  assert.equal((await f.call('accept', 'request-1')).status, 403);
  assert.equal(f.deleted(), false);
  assert.equal((await fixture('outsider').call('request')).status, 403);
});
const pending = { id: 'request-1', requestedBy: 'alice', recipientUid: 'bob', status: 'pending' };
test('partner accepts matching request before recursive deletion', async () => {
  const f = fixture('bob', { status: 'draft', deletionRequest: pending });
  assert.equal((await f.call('accept', 'old-request')).status, 409);
  assert.equal(f.deleted(), false);
  assert.equal((await f.call('accept', 'request-1')).body.deleted, true);
  assert.equal(f.deleted(), true);
});
test('reject and cancel preserve the draft and remove pending state', async () => {
  for (const [uid, action] of [['bob', 'reject'], ['alice', 'cancel']]) {
    const f = fixture(uid, { status: 'draft', deletionRequest: pending });
    assert.equal((await f.call(action, 'request-1')).status, 200);
    assert.equal(f.deleted(), false);
    assert.equal(f.values.get('couples/pair/datePlans/plan').deletionRequest, undefined);
  }
});
test('accepted deletion can retry but cannot be cancelled', async () => {
  const f = fixture('bob', { status: 'draft', deletionRequest: { ...pending, status: 'deleting' } });
  assert.equal((await f.call('reject', 'request-1')).status, 409);
  assert.equal((await f.call('accept', 'request-1')).body.deleted, true);
});
