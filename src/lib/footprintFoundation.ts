/**
 * Privacy-first foundation for the couple footprint feature.
 *
 * A partner footprint is rendered from that partner's GPS records only.
 * A joint footprint is derived only when BOTH members have independent GPS
 * evidence that overlaps in time and remains within a conservative distance.
 */
import { distanceMeters, type LocationVisit } from '../utils/location';
import type { Memory } from '../types';

export type FootprintVisibility = 'personal' | 'shared';
export type FootprintReviewStatus = 'unreviewed' | 'pending-partner' | 'confirmed' | 'rejected';
export type FootprintRouteSource = 'manual' | 'gps';

export const JOINT_FOOTPRINT_MAX_DISTANCE_METERS = 120;
export const JOINT_FOOTPRINT_MIN_OVERLAP_MS = 2 * 60 * 1000;
export const JOINT_FOOTPRINT_MAX_ACCURACY_METERS = 100;
const ACTIVE_SAMPLE_GRACE_MS = 2 * 60 * 1000;

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
  lastSeenAt?: string;
  leftAt?: string;
};

export type JointFootprint = {
  id: string;
  source: 'gps-cross-check';
  visibility: 'shared';
  verification: 'both-gps';
  memberUids: [string, string];
  myVisitId: string;
  partnerVisitId: string;
  placeName?: string;
  latitude: number;
  longitude: number;
  accuracy: number;
  arrivedAt: string;
  leftAt?: string;
  overlapMinutes: number;
  separationMeters: number;
};

export type JointFootprintOptions = {
  now?: string | number | Date;
  maxDistanceMeters?: number;
  minOverlapMs?: number;
  maxAccuracyMeters?: number;
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
  return part('year') + '-' + part('month') + '-' + part('day');
}

function normalizePlace(value?: string): string {
  return (value ?? '').normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('ko-KR');
}

function visitStartMs(visit: LocationVisit): number {
  const value = Date.parse(visit.arrivedAt);
  return Number.isFinite(value) ? value : NaN;
}

function visitEndMs(visit: LocationVisit, nowMs: number): number {
  const start = visitStartMs(visit);
  if (!Number.isFinite(start)) return NaN;

  if (visit.leftAt) {
    const left = Date.parse(visit.leftAt);
    if (Number.isFinite(left) && left >= start) return Math.min(left, nowMs);
  }

  if (visit.lastSeenAt) {
    const lastSeen = Date.parse(visit.lastSeenAt);
    if (Number.isFinite(lastSeen) && lastSeen >= start) return Math.min(lastSeen, nowMs);
  }

  // Old open-ended records cannot prove that somebody remained there.
  // Treat them as an instant sample instead of extending them to "now".
  return start;
}

function preferredJointPlace(mine?: string, partner?: string): string | undefined {
  const myName = mine?.trim();
  const partnerName = partner?.trim();
  if (myName && partnerName && normalizePlace(myName) === normalizePlace(partnerName)) return myName;
  if (myName && !partnerName) return myName;
  if (!myName && partnerName) return partnerName;
  if (myName && partnerName) return '함께 있었던 위치';
  return undefined;
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

    const id = 'legacy-location:' + uid + ':' + visitId;
    if (seen.has(id)) continue;
    seen.add(id);

    const leftAtMs = visit.leftAt ? Date.parse(visit.leftAt) : NaN;
    const leftAt = Number.isFinite(leftAtMs) && leftAtMs >= arrivedAtMs
      ? new Date(leftAtMs).toISOString()
      : undefined;
    const lastSeenAtMs = visit.lastSeenAt ? Date.parse(visit.lastSeenAt) : NaN;
    const lastSeenAt = Number.isFinite(lastSeenAtMs) && lastSeenAtMs >= arrivedAtMs
      && (!leftAt || lastSeenAtMs <= Date.parse(leftAt))
      ? new Date(lastSeenAtMs).toISOString()
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
      ...(lastSeenAt ? { lastSeenAt } : {}),
      ...(leftAt ? { leftAt } : {}),
    });
  }

  return result.sort((a, b) => a.arrivedAt.localeCompare(b.arrivedAt) || a.id.localeCompare(b.id));
}

/**
 * Cross-check two independent GPS histories. One person's record alone can
 * never produce a joint footprint.
 *
 * The matcher intentionally prefers false negatives over false positives:
 * - both samples must be reasonably accurate;
 * - their time intervals must overlap for at least two minutes;
 * - their coordinates must remain within 120 m;
 * - each raw visit is used at most once in the derived list.
 */
export function buildJointFootprints(
  myUid: string,
  partnerUid: string,
  myVisits: readonly LocationVisit[],
  partnerVisits: readonly LocationVisit[],
  options: JointFootprintOptions = {},
): JointFootprint[] {
  const mine = myUid.trim();
  const partner = partnerUid.trim();
  if (!mine || !partner || mine === partner || !myVisits.length || !partnerVisits.length) return [];

  const nowInput = options.now instanceof Date ? options.now.getTime()
    : typeof options.now === 'number' ? options.now
      : typeof options.now === 'string' ? Date.parse(options.now) : Date.now();
  const nowMs = Number.isFinite(nowInput) ? Number(nowInput) : Date.now();
  const maxDistance = options.maxDistanceMeters ?? JOINT_FOOTPRINT_MAX_DISTANCE_METERS;
  const minOverlap = options.minOverlapMs ?? JOINT_FOOTPRINT_MIN_OVERLAP_MS;
  const maxAccuracy = options.maxAccuracyMeters ?? JOINT_FOOTPRINT_MAX_ACCURACY_METERS;

  type Candidate = {
    myVisit: LocationVisit;
    partnerVisit: LocationVisit;
    start: number;
    end: number;
    overlap: number;
    distance: number;
  };
  const candidates: Candidate[] = [];

  for (const myVisit of myVisits) {
    const myStart = visitStartMs(myVisit);
    const myEnd = visitEndMs(myVisit, nowMs);
    if (!Number.isFinite(myStart) || !Number.isFinite(myEnd) || myEnd < myStart) continue;
    if (!Number.isFinite(myVisit.accuracy) || myVisit.accuracy < 0 || myVisit.accuracy > maxAccuracy) continue;

    for (const partnerVisit of partnerVisits) {
      const partnerStart = visitStartMs(partnerVisit);
      const partnerEnd = visitEndMs(partnerVisit, nowMs);
      if (!Number.isFinite(partnerStart) || !Number.isFinite(partnerEnd) || partnerEnd < partnerStart) continue;
      if (!Number.isFinite(partnerVisit.accuracy) || partnerVisit.accuracy < 0 || partnerVisit.accuracy > maxAccuracy) continue;

      const start = Math.max(myStart, partnerStart);
      const end = Math.min(myEnd, partnerEnd);
      const overlap = end - start;
      if (overlap < minOverlap) continue;

      const distance = distanceMeters(myVisit, partnerVisit);
      if (!Number.isFinite(distance) || distance > maxDistance) continue;
      candidates.push({ myVisit, partnerVisit, start, end, overlap, distance });
    }
  }

  candidates.sort((a, b) => a.start - b.start || b.overlap - a.overlap || a.distance - b.distance);
  const usedMine = new Set<string>();
  const usedPartner = new Set<string>();
  const result: JointFootprint[] = [];

  for (const candidate of candidates) {
    if (usedMine.has(candidate.myVisit.id) || usedPartner.has(candidate.partnerVisit.id)) continue;
    usedMine.add(candidate.myVisit.id);
    usedPartner.add(candidate.partnerVisit.id);

    const ongoing = !candidate.myVisit.leftAt && !candidate.partnerVisit.leftAt
      && nowMs - candidate.end <= ACTIVE_SAMPLE_GRACE_MS;
    result.push({
      id: 'joint:' + candidate.myVisit.id + ':' + candidate.partnerVisit.id + ':' + candidate.start,
      source: 'gps-cross-check',
      visibility: 'shared',
      verification: 'both-gps',
      memberUids: [mine, partner],
      myVisitId: candidate.myVisit.id,
      partnerVisitId: candidate.partnerVisit.id,
      placeName: preferredJointPlace(candidate.myVisit.placeName, candidate.partnerVisit.placeName),
      latitude: (candidate.myVisit.latitude + candidate.partnerVisit.latitude) / 2,
      longitude: (candidate.myVisit.longitude + candidate.partnerVisit.longitude) / 2,
      accuracy: Math.max(candidate.myVisit.accuracy, candidate.partnerVisit.accuracy),
      arrivedAt: new Date(candidate.start).toISOString(),
      ...(ongoing ? {} : { leftAt: new Date(candidate.end).toISOString() }),
      overlapMinutes: Math.max(1, Math.round(candidate.overlap / 60_000)),
      separationMeters: Math.round(candidate.distance),
    });
  }

  return result.sort((a, b) => a.arrivedAt.localeCompare(b.arrivedAt) || a.id.localeCompare(b.id));
}

/**
 * Suggest same-day, exact-name album matches WITHOUT copying media or writing
 * links. A suggestion is not proof of a visit: the user must approve it.
 */
export function suggestLegacyMemoryLinks(
  previews: readonly Pick<LegacyFootprintPreview, 'id' | 'placeName' | 'arrivedAt'>[],
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
