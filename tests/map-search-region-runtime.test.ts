import assert from 'node:assert/strict';
import { test } from 'node:test';
import { searchRegionFromAddress } from '../src/utils/mapSearchRegion.ts';

test('reverse geocode yields full Seoul district and neighborhood rather than POI-only string', () => {
  assert.equal(searchRegionFromAddress({ state: '서울특별시', city: '서울특별시', city_district: '광진구', quarter: '구의3동', road: '강변역로' }), '서울 광진구 구의3동');
  assert.equal(searchRegionFromAddress({ city: '서울', county: '광진구', suburb: '자양동' }), '서울 광진구 자양동');
});
test('reverse geocode handles other cities and missing administrative data without inventing it', () => {
  assert.equal(searchRegionFromAddress({ state: '강원특별자치도', city: '강릉시', suburb: '교동' }), '강원 강릉시 교동');
  assert.equal(searchRegionFromAddress({ road: '주소 미확인' }), '');
});
