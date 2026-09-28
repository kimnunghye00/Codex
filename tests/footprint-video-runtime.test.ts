import assert from 'node:assert/strict';
import test from 'node:test';
import type { JointRoutePoint } from '../src/lib/footprintFoundation.ts';
import { buildFootprintVideoPlan } from '../src/lib/footprintVideoPlan.ts';

function point(id: string, minute: number, longitude: number): JointRoutePoint {
  const base = Date.parse('2026-09-27T04:00:00.000Z');
  return {
    id,
    source: 'gps-cross-check-route',
    visibility: 'shared',
    verification: 'both-gps',
    memberUids: ['me', 'partner'],
    myVisitId: 'mine-' + id,
    partnerVisitId: 'partner-' + id,
    latitude: 37.5665,
    longitude,
    accuracy: 18,
    arrivedAt: new Date(base + minute * 60_000).toISOString(),
    separationMeters: 12,
    sampleDeltaSeconds: 8,
  };
}

test('video plan separates stay, reconnect, and verified movement', () => {
  const plan = buildFootprintVideoPlan([
    point('a', 0, 126.9780),
    point('b', 2, 126.9780),
    point('c', 14, 127.0780),
    point('d', 16, 127.0790),
  ]);

  assert.deepEqual(plan.segments.map((segment) => segment.kind), ['stay', 'reconnect', 'move']);
  assert.equal(plan.stopCount, 1);
  assert.equal(plan.reconnectCount, 1);
  assert.ok(plan.totalDistanceMeters > 70);
  assert.ok(plan.totalDistanceMeters < 130);
});

test('video plan never counts an unverified reconnect jump as traveled distance', () => {
  const plan = buildFootprintVideoPlan([
    point('a', 0, 126.9780),
    point('b', 2, 126.9790),
    point('c', 20, 127.1790),
    point('d', 22, 127.1800),
  ]);

  assert.equal(plan.reconnectCount, 1);
  assert.ok(plan.totalDistanceMeters > 150);
  assert.ok(plan.totalDistanceMeters < 250);
});

test('video plan sorts points and keeps rendered duration bounded', () => {
  const plan = buildFootprintVideoPlan([
    point('d', 6, 126.9810),
    point('a', 0, 126.9780),
    point('c', 4, 126.9800),
    point('b', 2, 126.9790),
  ]);

  assert.deepEqual(plan.points.map((item) => item.id), ['a', 'b', 'c', 'd']);
  assert.ok(plan.playbackDurationMs >= 1_000);
  assert.ok(plan.playbackDurationMs <= 22_000);
  for (const segment of plan.segments) {
    assert.ok(segment.endOffsetMs > segment.startOffsetMs);
  }
});

test('video plan rejects routes that cannot form a segment', () => {
  const plan = buildFootprintVideoPlan([point('only', 0, 126.9780)]);
  assert.equal(plan.segments.length, 0);
  assert.equal(plan.playbackDurationMs, 0);
  assert.equal(plan.totalDistanceMeters, 0);
});
