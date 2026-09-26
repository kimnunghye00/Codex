import test from 'node:test';
import assert from 'node:assert/strict';
import { dueScheduledChatDrafts, parseScheduledChatDrafts } from '../src/lib/scheduledChat.ts';

test('old reservations without a couple identity cannot reach a newly connected partner', () => {
  const drafts = parseScheduledChatDrafts(JSON.stringify([
    { id: 1, text: '이전 커플에게 보낼 말', sendAt: '2026-09-25T10:00' },
    { id: 2, text: '다른 커플에게 보낼 말', sendAt: '2026-09-25T11:00', coupleId: 'old' },
    { id: 3, text: '현재 커플에게 보낼 말', sendAt: '2026-09-25T12:00', coupleId: 'current' },
    { id: 3, text: '중복', sendAt: '2026-09-25T12:00', coupleId: 'current' },
  ]));
  assert.deepEqual(dueScheduledChatDrafts(drafts, 'current', Date.parse('2026-09-25T13:00')).map((item) => item.id), [3]);
});

test('broken stored records do not block later valid reservations', () => {
  const drafts = parseScheduledChatDrafts(JSON.stringify([
    null, { id: 4, text: '', sendAt: '2026-09-25T12:00', coupleId: 'current' },
    { id: 5, text: '나중에', sendAt: '2026-09-27T12:00', coupleId: 'current' },
  ]));
  assert.equal(dueScheduledChatDrafts(drafts, 'current', Date.parse('2026-09-26T12:00')).length, 0);
  assert.equal(dueScheduledChatDrafts(drafts, 'current', Date.parse('2026-09-28T12:00'))[0]?.id, 5);
});
