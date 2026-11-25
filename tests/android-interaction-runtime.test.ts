import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeNetworkRetryDelay, shouldSendChatOnEnter } from '../src/utils/androidInteraction.ts';

test('native network retry is bounded and backs off', () => {
  assert.deepEqual([0,1,2,3,4,5].map(nativeNetworkRetryDelay), [null,1000,2000,4000,null,null]);
});
test('Samsung composition enter never sends a partial message', () => {
  const input = { key: 'Enter', shiftKey: false, composing: false, isComposing: false, keyCode: 13 };
  assert.equal(shouldSendChatOnEnter(input), true);
  assert.equal(shouldSendChatOnEnter({ ...input, keyCode: 229 }), false);
  assert.equal(shouldSendChatOnEnter({ ...input, composing: true }), false);
  assert.equal(shouldSendChatOnEnter({ ...input, isComposing: true }), false);
  assert.equal(shouldSendChatOnEnter({ ...input, shiftKey: true }), false);
  assert.equal(shouldSendChatOnEnter({ ...input, key: 'a' }), false);
});
