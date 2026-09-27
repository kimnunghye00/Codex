const test = require('node:test');
const assert = require('node:assert/strict');
const { __test } = require('./index.js');

test('location samples reject stale, future, inaccurate and invalid coordinates', () => {
  const now = Date.parse('2026-09-27T09:00:00.000Z');
  const good = { latitude: 37.5665, longitude: 126.978, accuracy: 18, timestamp: now - 60_000 };
  assert.equal(__test.normalizePoint(good, now)?.timestamp, now - 60_000);
  assert.equal(__test.normalizePoint({ ...good, latitude: 91 }, now), null);
  assert.equal(__test.normalizePoint({ ...good, accuracy: 301 }, now), null);
  assert.equal(__test.normalizePoint({ ...good, timestamp: now - __test.constants.MAX_AGE_MS - 1 }, now), null);
  assert.equal(__test.normalizePoint({ ...good, timestamp: now + __test.constants.MAX_FUTURE_MS + 1 }, now), null);
});

test('device secret comparison is hash based and constant-length checked', () => {
  const a = __test.hashSecret('a-secret-that-is-long-enough');
  const b = __test.hashSecret('a-secret-that-is-long-enough');
  const c = __test.hashSecret('different-secret');
  assert.equal(__test.safeEqualHex(a, b), true);
  assert.equal(__test.safeEqualHex(a, c), false);
  assert.equal(__test.safeEqualHex(a, ''), false);
});

test('day key uses Korea time instead of UTC boundary', () => {
  const utc = Date.parse('2026-09-27T15:30:00.000Z');
  assert.equal(__test.dayKeyFromMs(utc), '2026-09-28');
});
