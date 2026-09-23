import type { LocationSearchResult } from './location';
import { normalizePlaceSearchText } from './placeSearchIntent.ts';

type Place = Pick<LocationSearchResult, 'latitude' | 'longitude' | 'placeName' | 'address'>;

type RoadAddress = { road: string; number: string };

/**
 * NAVER supplies "월드컵북로 173" while OSM/Nominatim may supply
 * "173, 월드컵북로". Extract an actual road + building number instead
 * of comparing the provider-specific address strings or postal codes.
 */
function roadAddress(address?: string): RoadAddress | null {
  const parts = (address || '').normalize('NFKC').split(/[\s,·()]+/).filter(Boolean);
  for (let index = 0; index < parts.length; index += 1) {
    const road = parts[index];
    if (!/[가-힣0-9]+(?:대로|로|길)$/.test(road)) continue;
    for (const next of [parts[index + 1], parts[index - 1]]) {
      const number = next?.replace(/번지$/, '');
      if (number && /^\d+(?:-\d+)?$/.test(number)) {
        return { road: road.toLocaleLowerCase('ko-KR'), number };
      }
    }
  }
  return null;
}

function metersBetween(a: Place, b: Place): number {
  const lat = (a.latitude - b.latitude) * 111_200;
  const lon = (a.longitude - b.longitude) * 111_200
    * Math.cos((a.latitude + b.latitude) / 2 * Math.PI / 180);
  return Math.hypot(lat, lon);
}

/**
 * Never collapse two branches solely because they share a business name.
 * A matching street and building number permits a small geocoding offset;
 * when either address is incomplete, only almost identical pins are merged.
 */
export function sameSearchPlace(a: Place, b: Place): boolean {
  if (!Number.isFinite(a.latitude) || !Number.isFinite(a.longitude)
    || !Number.isFinite(b.latitude) || !Number.isFinite(b.longitude)) return false;
  const name = normalizePlaceSearchText(a.placeName);
  if (!name || name !== normalizePlaceSearchText(b.placeName)) return false;
  const distance = metersBetween(a, b);
  const first = roadAddress(a.address);
  const second = roadAddress(b.address);
  if (first && second) {
    return first.road === second.road && first.number === second.number && distance <= 150;
  }
  return distance <= 20;
}

/** Keep the first occurrence: saved places, then NAVER, then OSM. */
export function deduplicatePlaceResults<T extends Place>(items: readonly T[]): T[] {
  const unique: T[] = [];
  for (const item of items) {
    if (!unique.some((previous) => sameSearchPlace(previous, item))) unique.push(item);
  }
  return unique;
}
