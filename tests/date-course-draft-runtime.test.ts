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
