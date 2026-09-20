/** A course is an ordered set of up to 20 distinct saved place IDs. */
export const MAX_DATE_COURSE_PLACES = 20;

export type CourseTimeSlot = { start: string; end: string };
const TIME_RANGE = /^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$/;

export function appendPlaceToCourse(ids: readonly string[], placeId: string): string[] {
  const id = placeId.trim();
  if (!id || ids.includes(id) || ids.length >= MAX_DATE_COURSE_PLACES) return ids as string[];
  return [...ids, id];
}

/** Firestore stores a time range for each place in the same order as placeIds. Empty = not yet planned. */
export function decodeCourseTimeSlot(value: unknown): CourseTimeSlot {
  if (typeof value !== 'string' || !TIME_RANGE.test(value)) return { start: '', end: '' };
  const [start, end] = value.split('-');
  return { start, end };
}

export function encodeCourseTimeSlot(slot?: CourseTimeSlot): string {
  if (!slot?.start || !slot.end) return '';
  const value = slot.start + '-' + slot.end;
  return TIME_RANGE.test(value) ? value : '';
}

export function courseTimesFromSaved(ids: readonly string[], timeSlots?: readonly string[]): Record<string, CourseTimeSlot> {
  return Object.fromEntries(ids.map((id, index) => [id, decodeCourseTimeSlot(timeSlots?.[index])]));
}

/** Blank legacy time ranges are allowed; filled ranges must follow the itinerary's order. */
export function validateCourseTimes(ids: readonly string[], times: Readonly<Record<string, CourseTimeSlot>>): string | null {
  let previousEnd = '';
  for (const [index, id] of ids.entries()) {
    const { start = '', end = '' } = times[id] ?? {};
    if (!start && !end) continue;
    if (!start || !end) return (index + 1) + '번째 장소의 시작 시간과 종료 시간을 모두 입력해 주세요.';
    if (encodeCourseTimeSlot({ start, end }) === '') return (index + 1) + '번째 장소의 시간을 확인해 주세요.';
    if (start >= end) return (index + 1) + '번째 장소의 종료 시간은 시작 시간보다 늦어야 해요.';
    if (previousEnd && start < previousEnd) return (index + 1) + '번째 장소가 이전 장소의 종료 시간과 겹쳐요. 시간이나 순서를 조정해 주세요.';
    previousEnd = end;
  }
  return null;
}

/** The course tab only displays stops in the selected/draft course; saved places remain independent. */
export function placesForDateMap<T extends { id: string }>(
  visiblePlaces: readonly T[], tab: 'places' | 'courses', coursePlaceIds: readonly string[],
): T[] {
  if (tab === 'places') return [...visiblePlaces];
  const byId = new Map(visiblePlaces.map((place) => [place.id, place]));
  return coursePlaceIds.flatMap((id) => {
    const place = byId.get(id);
    return place ? [place] : [];
  });
}
