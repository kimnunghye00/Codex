import type { LocationSearchResult } from './location';

export type MapBounds = { west: number; south: number; east: number; north: number };
export function validMapBounds(b: MapBounds): boolean {
  return [b.west, b.south, b.east, b.north].every(Number.isFinite) && b.west >= -180 && b.east <= 180 && b.south >= -90 && b.north <= 90 && b.west < b.east && b.south < b.north;
}
export function insideMapBounds(p: { latitude: number; longitude: number }, b: MapBounds): boolean {
  return p.latitude >= b.south && p.latitude <= b.north && p.longitude >= b.west && p.longitude <= b.east;
}
export type PlaceSearchPage = { results: LocationSearchResult[]; excludedIds: string[]; hasMore: boolean };

type NominatimRow = { place_id?: number; lat?: string; lon?: string; name?: string; display_name?: string };
type OverpassElement = {
  id?: number; type?: string; lat?: number; lon?: number;
  center?: { lat?: number; lon?: number };
  tags?: Record<string, string | undefined>;
};

/** Escape user input before interpolating it into an Overpass regular expression. */
function escapeOverpassRegex(query: string): string {
  return query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function coordinateKey(place: { latitude: number; longitude: number }): string {
  return `${place.latitude.toFixed(6)}:${place.longitude.toFixed(6)}`;
}

function searchResult(row: NominatimRow, query: string): LocationSearchResult | null {
  const latitude = Number(row.lat), longitude = Number(row.lon);
  if (!row.lat || !row.lon || !Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) return null;
  return {
    latitude, longitude,
    placeName: row.name?.trim() || row.display_name?.split(',').slice(0, 3).join(' ').trim() || query,
    address: row.display_name?.trim() || query,
  };
}

async function nominatimSearch(query: string, bounds?: MapBounds, excludedIds: readonly string[] = []): Promise<{ rows: NominatimRow[]; ids: string[] }> {
  const params = new URLSearchParams({ format: 'jsonv2', q: query, limit: '40', addressdetails: '1', 'accept-language': 'ko', countrycodes: 'kr', dedupe: '0' });
  if (bounds) {
    const { west, north, east, south } = bounds;
    params.set('viewbox', `${west},${north},${east},${south}`);
    params.set('bounded', '1');
  }
  if (excludedIds.length) params.set('exclude_place_ids', excludedIds.join(','));
  const response = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error('Place search unavailable');
  const rows = await response.json() as NominatimRow[];
  if (!Array.isArray(rows)) throw new Error('Invalid search response');
  const ids = new Set(excludedIds);
  for (const row of rows) if (Number.isSafeInteger(row.place_id)) ids.add(String(row.place_id));
  return { rows, ids: [...ids] };
}

/**
 * Nominatim may not index named businesses inside a very small viewport.
 * Search OSM's separate POI index for the displayed area as a fallback.
 * The current map uses NAVER data; an OSM POI result is not a guarantee
 * that every NAVER label will be discoverable.
 */
async function overpassSearch(query: string, bounds: MapBounds): Promise<LocationSearchResult[]> {
  const width = bounds.east - bounds.west, height = bounds.north - bounds.south;
  // Avoid running a costly nationwide Overpass query on a zoomed-out map.
  if (width > 0.5 || height > 0.5 || width <= 0 || height <= 0) return [];
  const escaped = escapeOverpassRegex(query.trim().slice(0, 80));
  const bbox = [bounds.south, bounds.west, bounds.north, bounds.east].join(',');
  const statement = `[out:json][timeout:9];(nwr["name"~"${escaped}",i](${bbox});nwr["name:ko"~"${escaped}",i](${bbox}););out center 40;`;
  const response = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', Accept: 'application/json' },
    body: new URLSearchParams({ data: statement }).toString(),
    signal: AbortSignal.timeout(11000),
  });
  if (!response.ok) throw new Error('POI search unavailable');
  const data = await response.json() as { elements?: OverpassElement[] };
  if (!Array.isArray(data.elements)) throw new Error('Invalid POI response');
  const normalizedQuery = query.trim().replace(/\s+/g, '').toLocaleLowerCase('ko-KR');
  const unique = new Set<string>();
  const results: LocationSearchResult[] = [];
  for (const row of data.elements) {
    const latitude = Number(row.lat ?? row.center?.lat), longitude = Number(row.lon ?? row.center?.lon);
    const name = row.tags?.['name:ko'] || row.tags?.name || '';
    if (!name.replace(/\s+/g, '').toLocaleLowerCase('ko-KR').includes(normalizedQuery)) continue;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !insideMapBounds({ latitude, longitude }, bounds)) continue;
    const key = coordinateKey({ latitude, longitude });
    if (unique.has(key)) continue;
    unique.add(key);
    const address = [row.tags?.['addr:full'], row.tags?.['addr:street'], row.tags?.['addr:housenumber'], row.tags?.['addr:city']].filter(Boolean).join(' ').trim();
    results.push({ latitude, longitude, placeName: name, address: address || '지도에서 정확한 위치를 확인해 주세요.' });
  }
  return results;
}

export async function searchLocationPage(query: string, options: { bounds?: MapBounds; excludedIds?: string[] } = {}): Promise<PlaceSearchPage> {
  const trimmed = query.trim();
  if (!trimmed) return { results: [], excludedIds: [], hasMore: false };
  const bounds = options.bounds;
  if (bounds && !validMapBounds(bounds)) throw new Error('Invalid map bounds');
  let response: { rows: NominatimRow[]; ids: string[] } | undefined;
  let firstError: unknown;
  try { response = await nominatimSearch(trimmed, bounds, options.excludedIds); }
  catch (error) { firstError = error; }

  const ids = response?.ids ?? [...(options.excludedIds ?? [])];
  const seen = new Set<string>();
  const results: LocationSearchResult[] = [];
  const addRows = (rows: readonly NominatimRow[]) => {
    for (const row of rows) {
      const place = searchResult(row, trimmed);
      if (!place || (bounds && !insideMapBounds(place, bounds))) continue;
      const key = coordinateKey(place);
      if (!seen.has(key)) { seen.add(key); results.push(place); }
    }
  };
  if (response) addRows(response.rows);

  if (bounds && !results.length && !(options.excludedIds?.length)) {
    // A strict Nominatim viewbox can suppress nearby POIs even when indexed.
    // A bounded client-side check still prevents distant results.
    if (response) {
      try { addRows((await nominatimSearch(trimmed)).rows); } catch { /* Continue to alternate POI provider. */ }
    }
    if (!results.length) {
      try {
        for (const place of await overpassSearch(trimmed, bounds)) {
          const key = coordinateKey(place);
          if (!seen.has(key)) { seen.add(key); results.push(place); }
        }
      } catch { /* The alternate index is best-effort; the map-point picker remains available. */ }
    }
  }
  if (!response && !results.length) throw firstError ?? new Error('Place search unavailable');
  return {
    results,
    excludedIds: ids,
    hasMore: Boolean(response && response.rows.length > 0 && ids.length > (options.excludedIds?.length ?? 0)),
  };
}

/** Keep older callers' recoverable empty-result contract. */
export async function searchLocations(query: string): Promise<LocationSearchResult[]> {
  try { return (await searchLocationPage(query)).results; } catch { return []; }
}
