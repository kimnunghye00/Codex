import type { LocationSearchResult } from './location';

/**
 * A NAVER base-map click gives coordinates, not the name of a printed POI.
 * Only reuse an independently retrieved place when one result clearly
 * corresponds to the clicked point. Never invent a business identity.
 */
export function matchClickedSearchPlace(
  point: { latitude: number; longitude: number },
  results: readonly LocationSearchResult[],
  maximumMeters = 45,
): LocationSearchResult | null {
  if (!Number.isFinite(point.latitude) || !Number.isFinite(point.longitude)) return null;
  const radians = point.latitude * Math.PI / 180;
  const distances = results
    .filter((item) => Number.isFinite(item.latitude) && Number.isFinite(item.longitude))
    .map((item) => ({
      item,
      meters: Math.hypot(
        (item.latitude - point.latitude) * 111_200,
        (item.longitude - point.longitude) * 111_200 * Math.cos(radians),
      ),
    }))
    .filter(({ meters }) => meters <= maximumMeters)
    .sort((a, b) => a.meters - b.meters);
  if (!distances.length) return null;
  // When neighbouring entries are practically equidistant, ask for manual
  // confirmation instead of guessing which branch the user intended.
  if (distances[1] && distances[1].meters - distances[0].meters < 15) return null;
  return distances[0].item;
}
