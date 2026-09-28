import assert from 'node:assert/strict';
import test from 'node:test';
import type { JointRoutePoint } from '../src/lib/footprintFoundation.ts';
import {
  FOOTPRINT_VIDEO_PRIVACY_RADIUS_METERS,
  protectFootprintVideoRoute,
} from '../src/lib/footprintVideoPrivacy.ts';

function point(id: string, minute: number, longitude: number, placeName?: string): JointRoutePoint {
  const base = Date.parse('2026-09-27T04:00:00.000Z');
  return {
    id,
    source: 'gps-cross-check-route',
    visibility: 'shared',
    verification: 'both-gps',
    memberUids: ['me', 'partner'],
    myVisitId: 'mine-' + id,
    partnerVisitId: 'partner-' + id,
    placeName,
    latitude: 37.5665,
    longitude,
    accuracy: 18,
    arrivedAt: new Date(base + minute * 60_000).toISOString(),
    separationMeters: 10,
    sampleDeltaSeconds: 8,
  };
}

test('privacy protection trims roughly the first and last 200m of export routes', () => {
  const result = protectFootprintVideoRoute([
    point('a', 0, 126.9780, '집'),
    point('b', 1, 126.9785, '골목'),
    point('c', 2, 126.9810, '카페'),
    point('d', 3, 126.9850, '공원'),
    point('e', 4, 126.9880, '회사 근처'),
    point('f', 5, 126.9885, '회사'),
  ]);

  assert.equal(result.enabled, true);
  assert.equal(result.radiusMeters, FOOTPRINT_VIDEO_PRIVACY_RADIUS_METERS);
  assert.ok(result.hiddenPointCount >= 2);
  assert.ok(result.points.length >= 2);
  assert.notEqual(result.points[0].id, 'a');
  assert.notEqual(result.points[result.points.length - 1].id, 'f');
  assert.equal(result.points[0].placeName, undefined);
  assert.equal(result.points[result.points.length - 1].placeName, undefined);
});

test('short routes fall back to hiding endpoint labels instead of becoming unusable', () => {
  const result = protectFootprintVideoRoute([
    point('a', 0, 126.9780, '우리 집'),
    point('b', 2, 126.9783, '카페'),
    point('c', 4, 126.9786, '회사'),
  ]);

  assert.equal(result.fallbackSanitized, true);
  assert.equal(result.points.length, 3);
  assert.equal(result.points[0].placeName, undefined);
  assert.equal(result.points[1].placeName, '카페');
  assert.equal(result.points[2].placeName, undefined);
});

test('privacy protection can be explicitly disabled for private-only exports', () => {
  const result = protectFootprintVideoRoute([
    point('a', 0, 126.9780, '집'),
    point('b', 3, 126.9820, '카페'),
  ], false);

  assert.equal(result.enabled, false);
  assert.equal(result.hiddenPointCount, 0);
  assert.equal(result.points[0].placeName, '집');
  assert.equal(result.points[1].placeName, '카페');
});
