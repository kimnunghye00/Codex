import test from 'node:test';
import assert from 'node:assert/strict';
import { deduplicatePlaceResults, sameSearchPlace } from '../src/utils/placeSearchDedup.ts';

const naver = {
  placeName: '당가원',
  address: '서울특별시 마포구 월드컵북로 173 1층 당가원',
  latitude: 37.5654,
  longitude: 126.9085,
};
const osm = {
  placeName: '당가원',
  address: '당가원, 173, 월드컵북로, 성산동, 성산2동, 마포구, 서울특별시, 03947, 대한민국',
  latitude: 37.56565,
  longitude: 126.90865,
};

test('same shop from NAVER and OSM combines despite reversed address and offset pin', () => {
  assert.equal(sameSearchPlace(naver, osm), true);
  assert.deepEqual(deduplicatePlaceResults([naver, osm]), [naver],
    'prefer NAVER readable address and location when it arrives before OSM');
  assert.deepEqual(deduplicatePlaceResults([osm, naver]), [osm],
    'deduplication also works before NAVER has returned');
});

test('different branches or building numbers remain selectable', () => {
  const sameNameOtherNumber = {
    ...osm, address: '당가원, 175, 월드컵북로, 마포구, 서울특별시',
    latitude: 37.56565, longitude: 126.90865,
  };
  const sameNameOtherRoad = {
    ...osm, address: '당가원, 173, 성미산로, 마포구, 서울특별시',
  };
  const farAway = {
    ...osm, latitude: 37.568, longitude: 126.909,
  };
  const otherShop = {
    ...osm, placeName: '다른 식당',
  };
  assert.equal(deduplicatePlaceResults([
    naver, sameNameOtherNumber, sameNameOtherRoad, farAway, otherShop,
  ]).length, 5);
});

test('without two matching road numbers, only near-identical same-name markers collapse', () => {
  const lackingAddress = { ...osm, address: '마포구 서울', latitude: 37.56541, longitude: 126.90851 };
  const nearbyDifferentStore = { ...lackingAddress, latitude: 37.5658 };
  assert.equal(sameSearchPlace(naver, lackingAddress), true);
  assert.equal(sameSearchPlace(naver, nearbyDifferentStore), false);
});

test('re-running or paging search never re-adds a previously shown duplicate', () => {
  const results = deduplicatePlaceResults([naver, osm, ...deduplicatePlaceResults([naver, osm])]);
  assert.equal(results.length, 1);
});
