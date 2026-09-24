/** A date candidate is distinct from the shared wishlist and from another branch of the same brand. */
export type CandidateLocation = { name: string; address: string; latitude: number; longitude: number };

const normalized = (value: string) => value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('ko-KR');

export function isSameDatePlanPlace(a: CandidateLocation, b: CandidateLocation): boolean {
  if (normalized(a.name) !== normalized(b.name)) return false;
  const latitude = (a.latitude - b.latitude) * 111_200;
  const longitude = (a.longitude - b.longitude) * 111_200 * Math.cos(a.latitude * Math.PI / 180);
  const meters = Math.hypot(latitude, longitude);
  // A stable building address may resolve to slightly different points in different providers.
  return meters <= 40 || (meters <= 120 && !!normalized(a.address) && normalized(a.address) === normalized(b.address));
}

/** Identical simultaneous submissions share one Firestore document even before snapshots arrive. */
export function datePlanCandidateId(place: CandidateLocation): string {
  if (!Number.isFinite(place.latitude) || !Number.isFinite(place.longitude)) throw new RangeError('장소 좌표를 확인해 주세요.');
  return 'place-' + encodeURIComponent(normalized(place.name)) + '-' +
    place.latitude.toFixed(4) + '-' + place.longitude.toFixed(4);
}
