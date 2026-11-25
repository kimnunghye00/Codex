import test from 'node:test';
import assert from 'node:assert/strict';
import { recentChatPhotos, visibleScheduledDrafts } from '../src/utils/chatRoomPresentation.ts';
import type { Message } from '../src/types.ts';
import type { ScheduledChatDraft } from '../src/lib/scheduledChat.ts';
const make = (id: number, patch: Partial<Message>): Message => ({id, sender:'me', type:'text', timestamp:'2026-11-01T00:00:00Z', read:false, ...patch});
test('recent photos include older images and galleries, deduplicate and cap', () => {
  const items = [make(1,{type:'image',imageUrl:'a'}),make(2,{type:'gallery',imageUrls:['b','c','d','d']}),...Array.from({length:150},(_,i)=>make(i+3,{})),make(200,{type:'image',imageUrl:'e'})];
  assert.deepEqual(recentChatPhotos(items), ['e','d','c','b']);
  assert.deepEqual(recentChatPhotos([]), []);
});
test('scheduled drafts from another couple are excluded in either room layout', () => {
  const items = [{id:1,text:'old',sendAt:100,coupleId:'old'},{id:2,text:'new',sendAt:100,coupleId:'new'},{id:3,text:'legacy',sendAt:100}] satisfies ScheduledChatDraft[];
  assert.deepEqual(visibleScheduledDrafts(items,'new').map(item=>item.id), [2,3]);
  assert.deepEqual(visibleScheduledDrafts(items).map(item=>item.id), [3]);
});
