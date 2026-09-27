import test from 'node:test';
import assert from 'node:assert/strict';
import { buildJointFootprints, previewLegacyFootprints, suggestLegacyMemoryLinks } from '../src/lib/footprintFoundation.ts';
import type { Memory } from '../src/types.ts';
import type { LocationVisit } from '../src/utils/location.ts';

const visit: LocationVisit = {
  id: 'visit-1',
  latitude: 37.7519,
  longitude: 128.8761,
  accuracy: 14,
  placeName: '안목해변',
  arrivedAt: '2026-09-12T12:15:00+09:00',
  leftAt: '2026-09-12T13:05:00+09:00',
};

test('legacy location preview is private, unreviewed, read-only and stable', () => {
  const original: LocationVisit[] = [visit, { ...visit }];
  const before = JSON.stringify(original);
  const previews = previewLegacyFootprints('member-a', original);
  assert.equal(previews.length, 1);
  assert.deepEqual(previews[0], {
    id: 'legacy-location:member-a:visit-1',
    source: 'legacy-location',
    ownerUid: 'member-a',
    visibility: 'personal',
    reviewStatus: 'unreviewed',
    placeName: '안목해변',
    latitude: 37.7519,
    longitude: 128.8761,
    accuracy: 14,
    arrivedAt: '2026-09-12T03:15:00.000Z',
    leftAt: '2026-09-12T04:05:00.000Z',
  });
  assert.equal(JSON.stringify(original), before);
  assert.deepEqual(previewLegacyFootprints('member-a', original), previews);
  assert.equal(previewLegacyFootprints('', original).length, 0);
});

test('invalid coordinates and dates never become shared visit candidates', () => {
  const previews = previewLegacyFootprints('member-a', [
    { ...visit, id: 'invalid-lat', latitude: 91 },
    { ...visit, id: 'invalid-long', longitude: -181 },
    { ...visit, id: 'invalid-time', arrivedAt: 'not-a-time' },
    { ...visit, id: 'valid', accuracy: -1, leftAt: '2026-09-12T02:00:00Z' },
  ]);
  assert.equal(previews.length, 1);
  assert.equal(previews[0].visibility, 'personal');
  assert.equal(previews[0].reviewStatus, 'unreviewed');
  assert.equal(previews[0].accuracy, 0);
  assert.equal(previews[0].leftAt, undefined);
});

test('album suggestions require same Korean local date and exact normalized place name', () => {
  const [preview] = previewLegacyFootprints('member-a', [visit]);
  const memory = (id: number, date: string, location: string): Memory => ({
    id,
    title: '추억',
    date,
    description: '',
    images: ['https://example.test/private.jpg'],
    createdBy: 'me',
    location,
  });
  const matches = suggestLegacyMemoryLinks([preview], [
    memory(1, '2026-09-12', ' 안목해변 '),
    memory(2, '2026-09-13', '안목해변'),
    memory(3, '2026-09-12', '경포해변'),
  ]);
  assert.deepEqual(matches, [{
    footprintId: preview.id,
    memoryIds: [1],
  }]);
  assert.equal(JSON.stringify(matches).includes('private.jpg'), false);
  assert.deepEqual(suggestLegacyMemoryLinks([{ ...preview, placeName: undefined }], [memory(1, '2026-09-12', '안목해변')])[0].memoryIds, []);
});


test('joint footprints require independent GPS evidence from both members', () => {
  const mine: LocationVisit = {
    id: 'mine-1',
    latitude: 37.5665,
    longitude: 126.9780,
    accuracy: 18,
    placeName: '서울광장',
    arrivedAt: '2026-09-27T04:00:00.000Z',
    lastSeenAt: '2026-09-27T04:20:00.000Z',
    leftAt: '2026-09-27T04:20:00.000Z',
  };
  const partner: LocationVisit = {
    id: 'partner-1',
    latitude: 37.5667,
    longitude: 126.9782,
    accuracy: 22,
    placeName: '서울광장',
    arrivedAt: '2026-09-27T04:02:00.000Z',
    lastSeenAt: '2026-09-27T04:18:00.000Z',
    leftAt: '2026-09-27T04:18:00.000Z',
  };

  assert.equal(buildJointFootprints('me', 'partner', [mine], []).length, 0);
  assert.equal(buildJointFootprints('me', 'partner', [], [partner]).length, 0);

  const joint = buildJointFootprints('me', 'partner', [mine], [partner], {
    now: '2026-09-27T04:30:00.000Z',
  });
  assert.equal(joint.length, 1);
  assert.equal(joint[0].verification, 'both-gps');
  assert.equal(joint[0].placeName, '서울광장');
  assert.equal(joint[0].arrivedAt, '2026-09-27T04:02:00.000Z');
  assert.equal(joint[0].leftAt, '2026-09-27T04:18:00.000Z');
  assert.equal(joint[0].overlapMinutes, 16);
  assert.ok(joint[0].separationMeters < 120);
});

test('joint footprints reject distant, brief, or low-quality GPS matches', () => {
  const mine: LocationVisit = {
    id: 'mine',
    latitude: 37.5665,
    longitude: 126.9780,
    accuracy: 15,
    arrivedAt: '2026-09-27T04:00:00.000Z',
    lastSeenAt: '2026-09-27T04:20:00.000Z',
    leftAt: '2026-09-27T04:20:00.000Z',
  };
  const basePartner: LocationVisit = {
    id: 'partner',
    latitude: 37.5667,
    longitude: 126.9782,
    accuracy: 20,
    arrivedAt: '2026-09-27T04:05:00.000Z',
    lastSeenAt: '2026-09-27T04:15:00.000Z',
    leftAt: '2026-09-27T04:15:00.000Z',
  };

  assert.equal(buildJointFootprints('me', 'partner', [mine], [{
    ...basePartner,
    latitude: 37.5705,
    longitude: 126.9850,
  }], { now: '2026-09-27T04:30:00.000Z' }).length, 0);

  assert.equal(buildJointFootprints('me', 'partner', [mine], [{
    ...basePartner,
    arrivedAt: '2026-09-27T04:19:00.000Z',
    lastSeenAt: '2026-09-27T04:20:00.000Z',
    leftAt: '2026-09-27T04:20:00.000Z',
  }], { now: '2026-09-27T04:30:00.000Z' }).length, 0);

  assert.equal(buildJointFootprints('me', 'partner', [mine], [{
    ...basePartner,
    accuracy: 140,
  }], { now: '2026-09-27T04:30:00.000Z' }).length, 0);
});

test('open legacy samples do not become joint visits without fresh last-seen evidence', () => {
  const mine: LocationVisit = {
    id: 'mine-open',
    latitude: 37.5665,
    longitude: 126.9780,
    accuracy: 10,
    arrivedAt: '2026-09-27T04:00:00.000Z',
  };
  const partner: LocationVisit = {
    id: 'partner-open',
    latitude: 37.5666,
    longitude: 126.9781,
    accuracy: 10,
    arrivedAt: '2026-09-27T04:00:10.000Z',
  };

  assert.equal(buildJointFootprints('me', 'partner', [mine], [partner], {
    now: '2026-09-27T10:00:00.000Z',
  }).length, 0);
});
