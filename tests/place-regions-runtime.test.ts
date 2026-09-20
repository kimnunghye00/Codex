import test from 'node:test';
import assert from 'node:assert/strict';
import { placeRegion } from '../src/utils/placeRegions.ts';
test('regional grouping supports road and reverse-ordered addresses without modifying saved data', () => {
  assert.deepEqual(placeRegion('부산광역시 해운대구 우동 123'), { province: '부산', district: '해운대구' });
  assert.deepEqual(placeRegion('성원닭갈비, 상대원, 중원구, 성남시, 경기도, 대한민국'), { province: '경기', district: '성남시 중원구' });
  assert.deepEqual(placeRegion('강원특별자치도 삼척시 성내동'), { province: '강원', district: '삼척시' });
  assert.deepEqual(placeRegion('제주특별자치도 제주시 연동'), { province: '제주', district: '제주시' });
  assert.deepEqual(placeRegion('주소 정보 없음'), { province: '지역 미분류', district: '시·군·구 미분류' });
});
