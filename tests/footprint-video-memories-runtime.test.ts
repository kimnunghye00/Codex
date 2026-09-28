import assert from 'node:assert/strict';
import test from 'node:test';
import type { Memory } from '../src/types.ts';
import type { JointFootprint, JointRoutePoint } from '../src/lib/footprintFoundation.ts';
import { buildFootprintVideoMemoryMoments } from '../src/lib/footprintVideoMemories.ts';

function route(id: string, minute: number, longitude: number): JointRoutePoint {
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
    separationMeters: 10,
    sampleDeltaSeconds: 8,
  };
}

function visit(id: string, minute: number, longitude: number, placeName: string): JointFootprint {
  const base = Date.parse('2026-09-27T04:00:00.000Z');
  return {
    id,
    source: 'gps-cross-check',
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
    leftAt: new Date(base + (minute + 4) * 60_000).toISOString(),
    overlapMinutes: 4,
    separationMeters: 9,
  };
}

function memory(id: number, location: string | undefined, images: string[], date = '2026-09-27'): Memory {
  return {
    id,
    title: '추억 ' + id,
    date,
    description: '',
    images,
    location,
    createdBy: 'me',
  };
}

test('same-day memory photos attach only to a GPS-verified matching place', () => {
  const moments = buildFootprintVideoMemoryMoments(
    [route('a', 0, 126.9780), route('b', 5, 126.9810), route('c', 10, 126.9840)],
    [visit('v1', 5, 126.9811, '서울숲')],
    [
      memory(1, '서울숲', ['https://example.com/a.jpg']),
      memory(2, '다른 장소', ['https://example.com/b.jpg']),
      memory(3, '서울숲', ['https://example.com/c.jpg'], '2026-09-26'),
    ],
  );

  assert.equal(moments.length, 1);
  assert.equal(moments[0].memoryId, 1);
  assert.equal(moments[0].pointId, 'b');
});

test('memory video sources are skipped and at most two photos per memory are used', () => {
  const moments = buildFootprintVideoMemoryMoments(
    [route('a', 0, 126.9780), route('b', 5, 126.9810)],
    [visit('v1', 5, 126.9810, '안목해변')],
    [memory(1, '안목해변', [
      'https://example.com/a.mp4',
      'https://example.com/a.jpg',
      'https://example.com/b.jpg',
      'https://example.com/c.jpg',
    ])],
  );

  assert.deepEqual(moments.map((item) => item.imageUrl), [
    'https://example.com/a.jpg',
    'https://example.com/b.jpg',
  ]);
});

test('unlocated memories are not placed at an invented stop', () => {
  const moments = buildFootprintVideoMemoryMoments(
    [route('a', 0, 126.9780), route('b', 5, 126.9810)],
    [visit('v1', 5, 126.9810, '강릉역')],
    [memory(1, undefined, ['https://example.com/a.jpg'])],
  );

  assert.equal(moments.length, 0);
});

test('photo moments are capped for short-form video readability', () => {
  const memories = Array.from({ length: 5 }, (_, index) =>
    memory(index + 1, '중앙시장', [
      'https://example.com/' + index + '-a.jpg',
      'https://example.com/' + index + '-b.jpg',
    ]),
  );
  const moments = buildFootprintVideoMemoryMoments(
    [route('a', 0, 126.9780), route('b', 5, 126.9810)],
    [visit('v1', 5, 126.9810, '중앙시장')],
    memories,
    4,
  );

  assert.equal(moments.length, 4);
});
