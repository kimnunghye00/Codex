import type { LocationSearchResult } from './location';
import { insideMapBounds, validMapBounds, type MapBounds } from './locationSearch.ts';
import { matchesPlaceSearchIntent, parsePlaceSearchIntent } from './placeSearchIntent.ts';

/** NAVER search uses a private client secret and runs only on our server. */
export async function fetchNaverDatePlaces(
  query: string, options: { endpoint: string; token: string; region?: string; focus?: boolean; bounds?: MapBounds; signal?: AbortSignal },
): Promise<LocationSearchResult[]> {
  const { endpoint, token, region = '', bounds, signal } = options;
  if (!endpoint || !token || !query.trim()) return [];
  if (bounds && !validMapBounds(bounds)) throw new Error('Invalid map bounds');
  const url = new URL(endpoint, typeof window === 'undefined' ? 'https://danduli.web.app' : window.location.origin);
  if (url.protocol !== 'https:') throw new Error('Insecure local-search endpoint');
  url.searchParams.set('query', query.trim().slice(0, 100));
  if (region) url.searchParams.set('region', region.trim().slice(0, 50));
  if (options.focus) url.searchParams.set('focus', '1');
  const response = await fetch(url.toString(), {
    headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' },
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(12_000)]) : AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error('Naver local search unavailable');
  const payload = await response.json() as { results?: LocationSearchResult[]; provider?: string };
  if (payload.provider !== 'naver-local' || !Array.isArray(payload.results)) throw new Error('Invalid Naver local search result');
  const intent = parsePlaceSearchIntent(query);
  const seen = new Set<string>();
  const results: LocationSearchResult[] = [];
  for (const item of payload.results) {
    if (typeof item.placeName !== 'string' || !item.placeName.trim() || typeof item.address !== 'string') continue;
    if (!Number.isFinite(item.latitude) || !Number.isFinite(item.longitude)
      || item.latitude < 33 || item.latitude > 39 || item.longitude < 124 || item.longitude > 132) continue;
    if (bounds && !insideMapBounds(item, bounds)) continue;
    if (!matchesPlaceSearchIntent(item, intent)) continue;
    const key = item.latitude.toFixed(6) + ':' + item.longitude.toFixed(6);
    if (!seen.has(key)) { seen.add(key); results.push(item); }
  }
  return results;
}
