import assert from 'node:assert/strict';
import test from 'node:test';
import { stickerSpriteOwnerForCentroid } from '../src/lib/stickerSpriteIsolation.ts';

const WIDTH = 1122;
const HEIGHT = 1402;

test('fourth-row captions just above the nominal row boundary stay with row four', () => {
  assert.equal(stickerSpriteOwnerForCentroid(420, 1025, WIDTH, HEIGHT), 13);
  assert.equal(stickerSpriteOwnerForCentroid(700, 1028, WIDTH, HEIGHT), 14);
});

test('main artwork remains assigned to its expected grid cell', () => {
  assert.equal(stickerSpriteOwnerForCentroid(140, 180, WIDTH, HEIGHT), 0);
  assert.equal(stickerSpriteOwnerForCentroid(420, 560, WIDTH, HEIGHT), 5);
  assert.equal(stickerSpriteOwnerForCentroid(700, 880, WIDTH, HEIGHT), 10);
  assert.equal(stickerSpriteOwnerForCentroid(980, 1220, WIDTH, HEIGHT), 15);
});

test('sprite owner clamps extreme decorative pixels to the nearest edge cell', () => {
  assert.equal(stickerSpriteOwnerForCentroid(-50, -20, WIDTH, HEIGHT), 0);
  assert.equal(stickerSpriteOwnerForCentroid(WIDTH + 50, HEIGHT + 20, WIDTH, HEIGHT), 15);
});
