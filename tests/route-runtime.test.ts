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
import { loadMessages, loadMemories, loadDeletedMemories, saveMemories } from '../src/utils/storage.ts';
import { typingTimeRemaining } from '../src/utils/typingStatus.ts';

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

test('typing expires even when the sender disconnects without a final update', () => {
  const now = 1_800_000_000_000;
  assert.equal(typingTimeRemaining({ typing: true, updatedAt: now }, now), 8000);
  assert.equal(typingTimeRemaining({ typing: true, updatedAt: now }, now + 7999), 1);
  assert.equal(typingTimeRemaining({ typing: true, updatedAt: now }, now + 8000), 0);
  assert.equal(typingTimeRemaining({ typing: false, updatedAt: now }, now), 0);
  assert.equal(typingTimeRemaining({ typing: true, updatedAt: now + 60_000 }, now), 8000);
  assert.equal(typingTimeRemaining({ typing: true, updatedAt: 'broken' }, now), 0);
});

test('broken startup caches recover without discarding valid records', () => {
  const values = new Map<string, string>();
  const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  } });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: new EventTarget() });
  try {
    for (const broken of ['null', '{}', '42', '"text"', '[null, 4, {}]', '{bad']) {
      values.set('route.messages.v2', broken);
      values.set('route.memories.v2', broken);
      values.set('route.memories.deleted.v1', broken);
      assert.deepEqual(loadMessages([]), []);
      assert.deepEqual(loadMemories([]), []);
      assert.deepEqual(loadDeletedMemories(), {});
      assert.doesNotThrow(() => saveMemories([]));
    }

    const message = { id: 1, sender: 'me', type: 'gallery', timestamp: '2026-09-13T10:00:00Z', read: false,
      imageUrls: ['https://example.com/photo.jpg', null, 42], reactions: [null, { emoji: '♥', by: 'partner' }] };
    values.set('route.messages.v2', JSON.stringify([null, message]));
    const messages = loadMessages([]);
    assert.equal(messages.length, 1);
    assert.deepEqual(messages[0].imageUrls, ['https://example.com/photo.jpg']);
    assert.deepEqual(messages[0].reactions, [{ emoji: '♥', by: 'partner' }]);

    values.set('route.memories.deleted.v1', 'null');
    values.set('route.memories.v2', JSON.stringify([null, { id: 2, title: '우리 사진', images: [null, 'https://example.com/photo.jpg', 'blob:temporary'], videos: {}, tags: [42, '여행'] }]));
    const memories = loadMemories([]);
    assert.equal(memories.length, 1);
    assert.equal(memories[0].title, '우리 사진');
    assert.deepEqual(memories[0].images, ['https://example.com/photo.jpg']);
    assert.deepEqual(memories[0].videos, []);
    assert.deepEqual(memories[0].tags, ['여행']);
    assert.doesNotThrow(() => saveMemories(memories));

    values.set('route.messages.v2', JSON.stringify(Array.from({ length: 100 }, (_, id) => ({ ...message, id }))));
    assert.equal(loadMessages([]).length, 40);
    assert.equal(loadMessages([])[0].id, 60);
    values.set('route.memories.v2', JSON.stringify(Array.from({ length: 100 }, (_, id) => ({ ...memories[0], id }))));
    assert.equal(loadMemories([]).length, 60);
  } finally {
    if (storageDescriptor) Object.defineProperty(globalThis, 'localStorage', storageDescriptor);
    else Reflect.deleteProperty(globalThis, 'localStorage');
    if (windowDescriptor) Object.defineProperty(globalThis, 'window', windowDescriptor);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});
