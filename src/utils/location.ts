export type LocationVisit = {
  id: string;
  latitude: number;
  longitude: number;
  accuracy: number;
  placeName?: string;
  arrivedAt: string;
  leftAt?: string;
};

export type LocationSharingState = {
  enabled: boolean;
  updatedAt: string;
};

const visitsKey = (uid: string) => `meluni-location-visits:${uid}`;
const sharingKey = (uid: string) => `meluni-location-sharing:${uid}`;
const MAX_VISITS = 300;

export function loadLocationVisits(uid: string): LocationVisit[] {
  try {
    const raw = localStorage.getItem(visitsKey(uid));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as LocationVisit[];
    return Array.isArray(parsed) ? parsed.slice(0, MAX_VISITS) : [];
  } catch {
    return [];
  }
}

export function saveLocationVisits(uid: string, visits: LocationVisit[]) {
  localStorage.setItem(visitsKey(uid), JSON.stringify(visits.slice(0, MAX_VISITS)));
}

export function loadLocationSharing(uid: string): LocationSharingState {
  try {
    const raw = localStorage.getItem(sharingKey(uid));
    if (!raw) return { enabled: false, updatedAt: new Date().toISOString() };
    const parsed = JSON.parse(raw) as LocationSharingState;
    return { enabled: Boolean(parsed.enabled), updatedAt: parsed.updatedAt || new Date().toISOString() };
  } catch {
    return { enabled: false, updatedAt: new Date().toISOString() };
  }
}

export function saveLocationSharing(uid: string, enabled: boolean) {
  const next = { enabled, updatedAt: new Date().toISOString() };
  localStorage.setItem(sharingKey(uid), JSON.stringify(next));
  return next;
}

export function distanceMeters(a: Pick<LocationVisit, 'latitude' | 'longitude'>, b: Pick<LocationVisit, 'latitude' | 'longitude'>) {
  const radius = 6_371_000;
  const toRad = (degree: number) => degree * Math.PI / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * radius * Math.asin(Math.sqrt(h));
}

export async function reverseGeocode(latitude: number, longitude: number): Promise<string | undefined> {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(latitude)}&lon=${encodeURIComponent(longitude)}&zoom=18&accept-language=ko`;
    const response = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!response.ok) return undefined;
    const data = await response.json() as { name?: string; display_name?: string; address?: Record<string, string> };
    const address = data.address ?? {};
    return data.name || address.amenity || address.shop || address.building || address.road || address.suburb || address.neighbourhood || data.display_name?.split(',').slice(0, 2).join(', ');
  } catch {
    return undefined;
  }
}
