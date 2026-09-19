/**
 * P0 bridge for the new couple footprint feature.
 *
 * Legacy locations are PRIVATE, UNREVIEWED preview data, not proof that a couple
 * visited together. This module has no persistence/network side effects and
 * MUST NOT be used to write directly into a shared couple collection.
 */
import type { LocationVisit } from '../utils/location';
import type { Memory } from '../types';

export type FootprintVisibility = 'personal' | 'shared';
export type FootprintReviewStatus = 'unreviewed' | 'pending-partner' | 'confirmed' | 'rejected';
export type FootprintRouteSource = 'manual' | 'gps';

export type LegacyFootprintPreview = {
  id: string;
  source: 'legacy-location';
  ownerUid: string;
  visibility: 'personal';
  reviewStatus: 'unreviewed';
  placeName?: string;
  latitude: number;
  longitude: number;
  accuracy: number;
  arrivedAt: string;
  leftAt?: string;
};

/** A suggestion for the user to review; never an automatic photo attachment. */
export type LegacyMemorySuggestion = {
  footprintId: string;
  memoryIds: number[];
};

const koreanDate = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function dateKey(iso: string): string {
  const parts = koreanDate.formatToParts(new Date(iso));
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function normalizePlace(value?: string): string {
  return (value ?? '').normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('ko-KR');
}

/**
 * Build a read-only, per-user preview of old location data. Calling this never
 * reads a partner's history, changes sharing settings, or creates joint visits.
 * Pass only the visits loaded for the signed-in UID.
 */
export function previewLegacyFootprints(ownerUid: string, visits: readonly LocationVisit[]): LegacyFootprintPreview[] {
  const uid = ownerUid.trim();
  if (!uid) return [];
  const seen = new Set<string>();
  const result: LegacyFootprintPreview[] = [];

  for (const visit of visits) {
    const visitId = typeof visit.id === 'string' ? visit.id.trim() : '';
    const latitude = visit.latitude;
    const longitude = visit.longitude;
    const arrivedAtMs = Date.parse(visit.arrivedAt);
    if (!visitId || !Number.isFinite(latitude) || latitude < -90 || latitude > 90
      || !Number.isFinite(longitude) || longitude < -180 || longitude > 180
      || !Number.isFinite(arrivedAtMs)) continue;

    const id = `legacy-location:${uid}:${visitId}`;
    if (seen.has(id)) continue;
    seen.add(id);

    const leftAtMs = visit.leftAt ? Date.parse(visit.leftAt) : NaN;
    const leftAt = Number.isFinite(leftAtMs) && leftAtMs >= arrivedAtMs
      ? new Date(leftAtMs).toISOString()
      : undefined;
    const accuracy = Number.isFinite(visit.accuracy) && visit.accuracy >= 0 ? visit.accuracy : 0;
    result.push({
      id,
      source: 'legacy-location',
      ownerUid: uid,
      visibility: 'personal',
      reviewStatus: 'unreviewed',
      placeName: visit.placeName?.trim() || undefined,
      latitude,
      longitude,
      accuracy,
      arrivedAt: new Date(arrivedAtMs).toISOString(),
      ...(leftAt ? { leftAt } : {}),
    });
  }

  return result.sort((a, b) => a.arrivedAt.localeCompare(b.arrivedAt) || a.id.localeCompare(b.id));
}

/**
 * Suggest same-day, exact-name album matches WITHOUT copying media or writing
 * links. A suggestion is not proof of a visit: the user must approve it.
 * Travel outside Korea may require manual date correction.
 */
export function suggestLegacyMemoryLinks(
  previews: readonly LegacyFootprintPreview[],
  memories: readonly Memory[],
): LegacyMemorySuggestion[] {
  return previews.map((preview) => {
    const name = normalizePlace(preview.placeName);
    const day = dateKey(preview.arrivedAt);
    return {
      footprintId: preview.id,
      memoryIds: name ? memories
        .filter((memory) => Number.isSafeInteger(memory.id)
          && memory.date === day
          && normalizePlace(memory.location) === name)
        .map((memory) => memory.id) : [],
    };
  });
}
