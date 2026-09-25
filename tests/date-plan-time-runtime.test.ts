import test from 'node:test';
import assert from 'node:assert/strict';
import type { DatePlanTimeBlock } from '../src/lib/datePlanFoundation.ts';
import { durationFromHoursMinutes, durationAsHoursMinutes } from '../src/lib/datePlanFoundation.ts';
import { calculateDatePlanTimeline, moveDatePlanBlock, normalizeTimeBlocks, validateDatePlanSchedule } from '../src/lib/datePlanTime.ts';

const block = (id: string, position: number, activityMinutes = 60, travelMinutes = 0): DatePlanTimeBlock => ({
  id, position, kind: 'activity', title: id, primaryCandidateId: id, backupCandidateIds: [],
  activityMinutes, travelMinutes, fixedStart: null,
});

test('activity and travel are edited in hours/minutes and advance next activity exactly', () => {
  const blocks = [block('a', 0, durationFromHoursMinutes(1, 30), durationFromHoursMinutes(0, 25)),
    block('b', 1, durationFromHoursMinutes(2, 10), 0)];
  const times = calculateDatePlanTimeline('09:00', blocks);
  assert.deepEqual(times.map((item) => [item.start, item.end, item.nextStart]), [
    ['09:00', '10:30', '10:55'], ['10:55', '13:05', '13:05'],
  ]);
  assert.deepEqual(durationAsHoursMinutes(blocks[0].activityMinutes), { hours: 1, minutes: 30 });
  validateDatePlanSchedule('09:00', blocks, ['a', 'b'], ['b']);
});

test('fixed time overrides automatic time but warns on overlapping plans', () => {
  const blocks = [block('a', 0, 90, 30), { ...block('b', 1, 30, 0), fixedStart: '10:00' },
    { ...block('c', 2, 60, 0), fixedStart: '14:00' }];
  const times = calculateDatePlanTimeline('09:00', blocks);
  assert.equal(times[1].start, '10:00');
  assert.equal(times[1].conflict, true);
  assert.equal(times[2].start, '14:00');
  assert.equal(times[2].conflict, false);
});

test('unfinished draft without initial time stays undecided until an optional fixed start', () => {
  const blocks = [block('a', 0), { ...block('b', 1), fixedStart: '15:00' }, block('c', 2)];
  const times = calculateDatePlanTimeline('', blocks);
  assert.equal(times[0].start, null);
  assert.equal(times[1].start, '15:00');
  assert.equal(times[2].start, '16:00');
  validateDatePlanSchedule('', blocks, ['a','b','c']);
});

test('midnight overflow does not wrap into previous date', () => {
  const times = calculateDatePlanTimeline('23:15', [block('a', 0, 50, 10), block('b', 1, 25, 0)]);
  assert.equal(times[0].overflow, true);
  assert.equal(times[0].end, null);
  assert.equal(times[1].start, null);
});

test('reordering changes explicit positions without mutating saved objects', () => {
  const blocks = [block('a', 0), block('b', 1), block('c', 2)];
  const moved = moveDatePlanBlock(blocks, 2, 0);
  assert.deepEqual(moved.map((item) => [item.id, item.position]), [['c', 0], ['a', 1], ['b', 2]]);
  assert.deepEqual(blocks.map((item) => item.id), ['a','b','c']);
  assert.deepEqual(normalizeTimeBlocks([]), []);
});

test('reject invalid fixed starts, unsupported backup IDs, duplicate IDs and excessive blocks', () => {
  assert.throws(() => validateDatePlanSchedule('25:00', [], []), RangeError);
  assert.throws(() => validateDatePlanSchedule('', [{ ...block('a',0), fixedStart:'12:60' }], ['a']), RangeError);
  assert.throws(() => validateDatePlanSchedule('', [{ ...block('a',0), backupCandidateIds:['ghost'] }], ['a']), RangeError);
  assert.throws(() => validateDatePlanSchedule('', [block('a',0), block('a',1)], ['a']), RangeError);
  assert.throws(() => validateDatePlanSchedule('', Array.from({ length:21 }, (_,i)=>block('b'+i,i)), []), RangeError);
  assert.throws(() => moveDatePlanBlock([block('a',0)], 0, 2), RangeError);
});
