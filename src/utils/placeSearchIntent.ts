import { MUNICIPALITIES, PROVINCES, placeRegion } from './placeRegions';
import type { LocationSearchResult } from './location';

export type PlaceSearchIntent = {
  businessQuery: string;
  province: string;
  city: string;
  regionLabel: string;
  hasExplicitRegion: boolean;
};

const CITIES = Object.entries(MUNICIPALITIES).flatMap(([province, cities]) =>
  cities.split(' ').map((city) => ({ province, city, short: city.replace(/[시군]$/, '') })),
).sort((a, b) => b.short.length - a.short.length);
const PROVINCE_NAMES = Object.entries(PROVINCES).sort(([a], [b]) => b.length - a.length);

export function normalizePlaceSearchText(text: string): string {
  return text.normalize('NFKC').toLocaleLowerCase('ko-KR').replace(/[\s·,()\-]/g, '');
}

/** Only whole locality tokens and explicit "OO점" suffixes count as a location.
 * A franchise name that happens to contain a district name must not be split.
 */
export function parsePlaceSearchIntent(query: string): PlaceSearchIntent {
  const words = query.trim().split(/[\s,]+/).filter(Boolean);
  let province = '', city = '';
  const nameWords: string[] = [];
  for (const [index, word] of words.entries()) {
    const regionWord = word.endsWith('점') && word.length > 2 ? word.slice(0, -1) : word;
    const cityMatch = CITIES.find((item) => item.city === regionWord || item.short === regionWord);
    if (cityMatch && (!word.endsWith('점') || index === words.length - 1)) {
      city = cityMatch.city;
      province = cityMatch.province;
      continue;
    }
    const provinceMatch = PROVINCE_NAMES.find(([alias]) => alias === word);
    if (provinceMatch) {
      if (!city) province = provinceMatch[1];
      continue;
    }
    nameWords.push(word);
  }

  // "명륜진사갈비삼척점" has no space, but the branch suffix is unambiguous.
  if (!city && nameWords.length) {
    const last = nameWords[nameWords.length - 1];
    const cityMatch = CITIES.find((item) => last.endsWith(item.short + '점') && last.length > item.short.length + 2);
    if (cityMatch) {
      city = cityMatch.city;
      province = cityMatch.province;
      nameWords[nameWords.length - 1] = last.slice(0, -(cityMatch.short.length + 1));
    }
  }
  const businessQuery = nameWords.filter(Boolean).join(' ').trim();
  return { businessQuery, province, city, regionLabel: city || province, hasExplicitRegion: Boolean(city || province) };
}

/** Never substitute a different franchise branch when the user named a city. */
export function matchesPlaceSearchIntent(place: LocationSearchResult, intent: PlaceSearchIntent): boolean {
  const name = normalizePlaceSearchText(place.placeName);
  const business = normalizePlaceSearchText(intent.businessQuery);
  if (business && !name.includes(business)) return false;
  if (!intent.hasExplicitRegion) return true;

  const address = place.address || '';
  const region = placeRegion(address);
  if (region.province !== intent.province) return false;
  if (!intent.city) return true;

  const cityShort = intent.city.replace(/[시군]$/, '');
  const tokens = address.split(/[\s,·()]+/).filter(Boolean);
  return tokens.some((token) => token === intent.city || token === cityShort);
}
