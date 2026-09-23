import test from 'node:test';
import assert from 'node:assert/strict';
import { durationFromHoursMinutes, durationAsHoursMinutes, readLegacyDateCourse } from '../src/lib/datePlanFoundation.ts';

test('legacy courses keep place IDs, order, and old time slots without mutation', () => {
  const original = {
    id: 'old-course', title: '강릉 주말 데이트', date: '', placeIds: ['a', 'b', 'c'],
    timeSlots: ['08:00-10:00', '', '12:00-13:00'], createdBy: 'member-1',
  };
  const view = readLegacyDateCourse(original);
  assert.deepEqual(view, {
    id: 'old-course', source: 'legacy', title: original.title, date: '',
    placeIds: ['a', 'b', 'c'], timeSlots: ['08:00-10:00', '', '12:00-13:00'],
  });
  view.placeIds.reverse();
  view.timeSlots[0] = 'changed';
  assert.deepEqual(original.placeIds, ['a', 'b', 'c']);
  assert.deepEqual(original.timeSlots, ['08:00-10:00', '', '12:00-13:00']);
});

test('legacy missing time slots stay undecided and do not require migration', () => {
  const view = readLegacyDateCourse({
    id: 'older', title: '옛 코스', date: '2026-10-01', placeIds: ['a', 'b'],
    createdBy: 'member-1',
  });
  assert.deepEqual(view.timeSlots, ['', '']);
});

test('UI duration uses separate hours/minutes while stored minutes are exact', () => {
  assert.equal(durationFromHoursMinutes(3, 10), 190);
  assert.deepEqual(durationAsHoursMinutes(190), { hours: 3, minutes: 10 });
  assert.equal(durationFromHoursMinutes(0, 5), 5);
  assert.deepEqual(durationAsHoursMinutes(90), { hours: 1, minutes: 30 });
  assert.throws(() => durationFromHoursMinutes(1, 60), RangeError);
  assert.throws(() => durationFromHoursMinutes(-1, 0), RangeError);
  assert.throws(() => durationFromHoursMinutes(1.5, 0), RangeError);
  assert.throws(() => durationAsHoursMinutes(-3), RangeError);
});
