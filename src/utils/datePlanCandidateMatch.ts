import type { DatePlanCandidate } from '../lib/datePlanFoundation';
import { sameSearchPlace } from './placeSearchDedup';

type CandidateInput = Pick<DatePlanCandidate, 'name' | 'address' | 'latitude' | 'longitude'> &
  { sourceSavedPlaceId?: string };

/** Only dedupe the same place within one plan, never across distinct branches. */
export function findPlanCandidateDuplicate(
  current: readonly DatePlanCandidate[],
  input: CandidateInput,
): DatePlanCandidate | undefined {
  if (input.sourceSavedPlaceId) {
    const fromWishlist = current.find((item) => item.sourceSavedPlaceId === input.sourceSavedPlaceId);
    if (fromWishlist) return fromWishlist;
  }
  return current.find((item) => sameSearchPlace(
    { placeName: item.name, address: item.address, latitude: item.latitude, longitude: item.longitude },
    { placeName: input.name, address: input.address, latitude: input.latitude, longitude: input.longitude },
  ));
}
