import type { LocationSearchResult } from './location';

/** Multiple candidates, never silently choose a branch on behalf of the user. */
export async function searchLocations(query: string): Promise<LocationSearchResult[]> {
  const value = query.trim();
  if (!value) return [];
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(value)}&limit=15&addressdetails=1&accept-language=ko&countrycodes=kr&dedupe=0`;
    const response = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!response.ok) return [];
    const rows = await response.json() as Array<{ place_id?: number; lat?: string; lon?: string; name?: string; display_name?: string; address?: Record<string, string> }>;
    const results: LocationSearchResult[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
      const latitude = Number(row.lat);
      const longitude = Number(row.lon);
      if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90
        || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) continue;
      const key = `${latitude.toFixed(6)}:${longitude.toFixed(6)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      results.push({
        latitude, longitude,
        placeName: row.name?.trim() || row.display_name?.split(',').slice(0, 3).join(' ').trim() || value,
        address: row.display_name?.trim() || value,
      });
    }
    return results;
  } catch {
    return [];
  }
}

