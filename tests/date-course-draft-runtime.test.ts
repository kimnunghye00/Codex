import test from 'node:test';
import assert from 'node:assert/strict';
import { appendPlaceToCourse, MAX_DATE_COURSE_PLACES } from '../src/lib/dateCourseDraft.ts';

test('adds multiple unique stops without changing the existing plan or their order', () => {
  const original = ['busan-station'];
  const two = appendPlaceToCourse(original, 'pizza');
  const three = appendPlaceToCourse(two, 'cafe');
  assert.deepEqual(original, ['busan-station']);
  assert.deepEqual(two, ['busan-station', 'pizza']);
  assert.deepEqual(three, ['busan-station', 'pizza', 'cafe']);
  assert.equal(appendPlaceToCourse(three, 'pizza'), three);
});

test('ignores empty IDs and stops at the server-supported 20-place limit', () => {
  const initial = Array.from({ length: MAX_DATE_COURSE_PLACES }, (_, index) => 'place-' + index);
  assert.equal(appendPlaceToCourse(initial, 'extra'), initial);
  assert.equal(appendPlaceToCourse(initial, '   '), initial);
  assert.deepEqual(appendPlaceToCourse(initial.slice(0, -1), '  last-stop  ').at(-1), 'last-stop');
});

import { courseTimesFromSaved, decodeCourseTimeSlot, encodeCourseTimeSlot, validateCourseTimes } from '../src/lib/dateCourseDraft.ts';

test('legacy courses keep their order and render missing times as undecided', () => {
  const ids = ['busan', 'pizza', 'beach'];
  assert.deepEqual(courseTimesFromSaved(ids), {
    busan: { start: '', end: '' }, pizza: { start: '', end: '' }, beach: { start: '', end: '' },
  });
  assert.deepEqual(decodeCourseTimeSlot('garbled'), { start: '', end: '' });
});

test('editable times round-trip by place ID and follow the stop when reordered', () => {
  const ids = ['busan', 'pizza', 'beach'];
  const times = courseTimesFromSaved(ids, ['10:00-11:00', '11:30-13:00', '']);
  assert.equal(validateCourseTimes(ids, times), null);
  const reordered = ['pizza', 'busan', 'beach'];
  const slots = reordered.map((id) => encodeCourseTimeSlot(times[id]));
  assert.deepEqual(slots, ['11:30-13:00', '10:00-11:00', '']);
  assert.equal(validateCourseTimes(reordered, times)?.includes('겹쳐요'), true);
  assert.deepEqual(courseTimesFromSaved(reordered, slots).pizza, times.pizza);
});

test('incomplete, invalid and reversed time ranges are rejected without inventing times', () => {
  const ids = ['one', 'two'];
  assert.equal(encodeCourseTimeSlot({ start: '', end: '' }), '');
  assert.match(validateCourseTimes(ids, { one: { start: '12:00', end: '' } }) ?? '', /모두 입력/);
  assert.match(validateCourseTimes(ids, { one: { start: '25:00', end: '26:00' } }) ?? '', /확인/);
  assert.match(validateCourseTimes(ids, { one: { start: '13:00', end: '12:00' } }) ?? '', /늦어야/);
  assert.equal(validateCourseTimes(ids, {}), null);
});
