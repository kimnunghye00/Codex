import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { buildLocalSearchQueries } = require('../functions-search/localSearchQueries.cjs');

test('CGV viewport lookup searches locality, district and broad brand without inventing a branch', () => {
  const queries = buildLocalSearchQueries('CGV', '서울 광진구 구의동');
  assert.deepEqual(queries, [
    '구의동 CGV', 'CGV 구의동', '광진구 CGV', 'CGV 광진구',
    '서울 광진구 CGV', '서울 광진구 구의동 CGV', 'CGV',
  ]);
});

test('two-part and absent region search stay bounded and do not duplicate variants', () => {
  assert.deepEqual(buildLocalSearchQueries('CGV', '서울 광진구'), [
    '광진구 CGV', 'CGV 광진구', '서울 광진구 CGV', 'CGV',
  ]);
  assert.deepEqual(buildLocalSearchQueries('CGV', ''), ['CGV']);
  assert.deepEqual(buildLocalSearchQueries('CGV', '광진구'), ['광진구 CGV', 'CGV']);
});
