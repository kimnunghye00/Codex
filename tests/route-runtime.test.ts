import test from 'node:test';
import assert from 'node:assert/strict';
import { CALLING_ENABLED } from '../src/config/releaseFlags.ts';
import { decideAccountIsolation } from '../src/utils/accountIsolationPolicy.ts';
import {
  coupleConnectSessionKey,
  parseCoupleConnectSession,
  serializeCoupleConnectSession,
} from '../src/utils/coupleConnectSession.ts';
import { createMessageId, messageIdFromRandomWords } from '../src/utils/messageId.ts';

test('message ids cover the full safe-integer space without overflow', () => {
  assert.equal(messageIdFromRandomWords(0, 0), 1);
  assert.equal(messageIdFromRandomWords(0x1f_ffff, 0xffff_ffff), Number.MAX_SAFE_INTEGER);

  const ids = new Set<number>();
  for (let index = 0; index < 2_000; index += 1) {
    const id = createMessageId();
    assert.equal(Number.isSafeInteger(id), true);
    assert.equal(id > 0, true);
    ids.add(id);
  }
  assert.equal(ids.size, 2_000);
});

test('account isolation rejects orphaned and cross-account private caches', () => {
  assert.equal(decideAccountIsolation('', false, null), 'ready');
  assert.equal(decideAccountIsolation('', true, null), 'reset-orphan');
  assert.equal(decideAccountIsolation('', false, 'user-a'), 'adopt-owner');
  assert.equal(decideAccountIsolation('', true, 'user-a'), 'reset-orphan');
  assert.equal(decideAccountIsolation('user-a', true, 'user-a'), 'ready');
  assert.equal(decideAccountIsolation('user-a', true, 'user-b'), 'reset-switch');
  assert.equal(decideAccountIsolation('user-a', false, null), 'reset-signout');
});

test('couple connection session survives restart but expires safely', () => {
  const now = 1_800_000_000_000;
  const serialized = serializeCoupleConnectSession({
    mode: 'waiting',
    code: 'ROUTE-ABC234',
    savedAt: now,
  });

  assert.deepEqual(parseCoupleConnectSession(serialized, now + 1_000), {
    mode: 'waiting',
    code: 'ROUTE-ABC234',
    savedAt: now,
  });
  assert.equal(parseCoupleConnectSession(serialized, now + 8 * 24 * 60 * 60 * 1000), null);
  assert.equal(parseCoupleConnectSession('{"mode":"waiting","code":"BAD","savedAt":1}', now), null);
  assert.equal(coupleConnectSessionKey('uid-123'), 'route.coupleConnect.pending:uid-123');
});

test('unfinished calling cannot be exposed by release rendering', () => {
  assert.equal(CALLING_ENABLED, false);
});
