import type { LocationSearchResult } from './location';
export type MapBounds = { west: number; south: number; east: number; north: number };
export function validMapBounds(b: MapBounds): boolean {
  return [b.west, b.south, b.east, b.north].every(Number.isFinite) && b.west >= -180 && b.east <= 180 && b.south >= -90 && b.north <= 90 && b.west < b.east && b.south < b.north;
}
export function insideMapBounds(p: { latitude: number; longitude: number }, b: MapBounds): boolean {
  return p.latitude >= b.south && p.latitude <= b.north && p.longitude >= b.west && p.longitude <= b.east;
}
export type PlaceSearchPage = { results: LocationSearchResult[]; excludedIds: string[]; hasMore: boolean };
export async function searchLocationPage(query: string, options: { bounds?: MapBounds; excludedIds?: string[] } = {}): Promise<PlaceSearchPage> {
  if (!query.trim()) return { results: [], excludedIds: [], hasMore: false };
  const params = new URLSearchParams({ format: 'jsonv2', q: query.trim(), limit: '40', addressdetails: '1', 'accept-language': 'ko', countrycodes: 'kr', dedupe: '0' });
  if (options.bounds) {
    if (!validMapBounds(options.bounds)) throw new Error('Invalid map bounds');
    const { west, north, east, south } = options.bounds;
    params.set('viewbox', `${west},${north},${east},${south}`); params.set('bounded', '1');
  }
  if (options.excludedIds?.length) params.set('exclude_place_ids', options.excludedIds.join(','));
  const response = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error('Place search unavailable');
  const rows = await response.json() as Array<{ place_id?: number; lat?: string; lon?: string; name?: string; display_name?: string }>;
  if (!Array.isArray(rows)) throw new Error('Invalid search response');
  const ids = new Set(options.excludedIds), seen = new Set<string>();
  const results: LocationSearchResult[] = [];
  for (const row of rows) {
    if (Number.isSafeInteger(row.place_id)) ids.add(String(row.place_id));
    const latitude = Number(row.lat), longitude = Number(row.lon);
    if (!row.lat || !row.lon || !Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) continue;
    if (options.bounds && !insideMapBounds({ latitude, longitude }, options.bounds)) continue;
    const key = `${latitude.toFixed(6)}:${longitude.toFixed(6)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({ latitude, longitude, placeName: row.name?.trim() || row.display_name?.split(',').slice(0, 3).join(' ').trim() || query.trim(), address: row.display_name?.trim() || query.trim() });
  }
  return { results, excludedIds: [...ids], hasMore: rows.length > 0 && ids.size > (options.excludedIds?.length ?? 0) };
}
/** Keep older callers' recoverable empty-result contract. */
export async function searchLocations(query: string): Promise<LocationSearchResult[]> {
  try { return (await searchLocationPage(query)).results; } catch { return []; }
}
