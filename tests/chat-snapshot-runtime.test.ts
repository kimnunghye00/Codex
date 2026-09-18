import test from 'node:test';
import assert from 'node:assert/strict';
import { sameMessage, mergePagedSnapshot } from '../src/lib/messageSnapshot.ts';
import { createUiTaskScope } from '../src/utils/uiTaskScope.ts';
import type { Message } from '../src/types.ts';

function message(id: number, extra: Partial<Message> = {}): Message {
  return { id, sender: 'me', type: 'text', text: `message ${id}`, timestamp: new Date(1_800_000_000_000 + id * 1000).toISOString(), read: false, ...extra };
}

test('unchanged snapshots retain both the array and message identities', () => {
  const current = Array.from({ length: 2000 }, (_, i) => message(i, {
    imageUrls: ['https://example.test/a', 'https://example.test/b'], reactions: [{ emoji: '♥', by: 'partner' }],
  }));
  const incoming = structuredClone(current);
  assert.equal(mergePagedSnapshot(current, incoming), current);
});

test('one updated message replaces only that message, without retaining deleted live messages', () => {
  const current = [message(1), message(2), message(3)];
  const updated = message(2, { read: true });
  const next = mergePagedSnapshot(current, [message(1), updated, message(3)]);
  assert.equal(next[0], current[0]);
  assert.equal(next[1], updated);
  assert.equal(next[2], current[2]);
  assert.deepEqual(mergePagedSnapshot(next, [message(1), message(3)]).map((item) => item.id), [1, 3]);
  assert.deepEqual(mergePagedSnapshot(current, []), []);
});

test('each message field and nested gallery/reaction edits remain observable', () => {
  const original = message(1);
  const changes: { [K in keyof Required<Message>]: Message[K] } = {
    id: 2, sender: 'partner', type: 'image', text: 'edited', imageUrl: 'photo', imageUrls: ['a'],
    stickerId: 'sticker', attachmentUrl: 'file', attachmentName: 'name', attachmentSize: 1, attachmentMime: 'image/png',
    audioDuration: 1, contactName: 'name', contactPhone: '010', callId: 'call', callKind: 'video', callStatus: 'failed',
    callDuration: 1, timestamp: '2026-09-01T10:00:00Z', read: true, replyTo: 2, reactions: [{ emoji: '♥', by: 'partner' }],
    saved: true, scheduledFor: '2026-10-01T10:00:00Z',
  };
  for (const [key, value] of Object.entries(changes)) {
    assert.equal(sameMessage(original, { ...original, [key]: value }), false, key);
  }
  assert.equal(sameMessage(message(1, { imageUrls: ['a', 'b'] }), message(1, { imageUrls: ['b', 'a'] })), false);
  assert.equal(sameMessage(message(1, { reactions: [{ emoji: '♥', by: 'me' }] }), message(1, { reactions: [{ emoji: '♥', by: 'partner' }] })), false);
  assert.equal(sameMessage(original, message(1, { saved: false, reactions: [], imageUrls: [], audioDuration: 0 })), true);
});

test('pagination keeps one older page, deduplicates IDs and sorts unordered legacy input', () => {
  const current = Array.from({ length: 100 }, (_, i) => message(i));
  const incoming = [message(100), message(101), message(102)];
  const merged = mergePagedSnapshot(current, incoming);
  assert.equal(merged.length, 43);
  assert.equal(merged[0], current[60]);
  assert.equal(merged.at(-1), incoming[2]);
  const duplicate = message(2, { text: 'last wins' });
  const unordered = mergePagedSnapshot([], [message(3), message(2), duplicate, message(1)]);
  assert.deepEqual(unordered.map((item) => item.id), [1, 2, 3]);
  assert.equal(unordered[1], duplicate);
  assert.deepEqual(mergePagedSnapshot(current, incoming, 0), incoming);
});

test('scroll task cleanup cancels pending timers/frames and ignores already-dispatched stale callbacks', () => {
  let sequence = 0;
  const timers = new Map<number, () => void>();
  const frames = new Map<number, () => void>();
  const scope = createUiTaskScope({
    setTimer: (callback) => { const id = ++sequence; timers.set(id, callback); return id; },
    clearTimer: (id) => { timers.delete(id); },
    requestFrame: (callback) => { const id = ++sequence; frames.set(id, callback); return id; },
    cancelFrame: (id) => { frames.delete(id); },
  });
  let changes = 0;
  scope.delay(() => { changes++; }, 90);
  scope.frame(() => scope.frame(() => { changes++; }));
  const alreadyDispatched = [...timers.values(), ...frames.values()];
  scope.clear();
  assert.equal(timers.size, 0);
  assert.equal(frames.size, 0);
  alreadyDispatched.forEach((callback) => callback());
  assert.equal(changes, 0);
  assert.equal(frames.size, 0);
  // A fresh history load works after cancellation; double clear is safe.
  scope.delay(() => { changes++; }, 0);
  [...timers.values()].forEach((callback) => callback());
  assert.equal(changes, 1);
  scope.clear();
  scope.clear();
});
