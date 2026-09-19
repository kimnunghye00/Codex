/** A course is an ordered set of up to 20 distinct saved place IDs. */
export const MAX_DATE_COURSE_PLACES = 20;

export function appendPlaceToCourse(ids: readonly string[], placeId: string): string[] {
  const id = placeId.trim();
  if (!id || ids.includes(id) || ids.length >= MAX_DATE_COURSE_PLACES) return ids as string[];
  return [...ids, id];
}
