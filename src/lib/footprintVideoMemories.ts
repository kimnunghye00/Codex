import type { Memory } from '../types';
import type { JointFootprint, JointRoutePoint } from './footprintFoundation';
import { footprintPointDistanceMeters } from './footprintVideoPlan.ts';

export type FootprintVideoMemoryMoment = {
  id: string;
  memoryId: number;
  pointId: string;
  imageUrl: string;
};

const KOREAN_DATE = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function dayKey(iso: string) {
  const parts = KOREAN_DATE.formatToParts(new Date(iso));
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '';
  return part('year') + '-' + part('month') + '-' + part('day');
}

function normalizePlace(value?: string) {
  return (value ?? '')
    .normalize('NFC')
    .trim()
    .toLocaleLowerCase('ko-KR')
    .replace(/[\s.,()\-_/·]+/g, '');
}

function samePlace(a?: string, b?: string) {
  const left = normalizePlace(a);
  const right = normalizePlace(b);
  if (!left || !right) return false;
  if (left === right) return true;
  return Math.min(left.length, right.length) >= 3
    && (left.includes(right) || right.includes(left));
}

function isVideoSource(value: string) {
  if (value.startsWith('data:video/')) return true;
  let normalized = value.split('#')[0];
  try { normalized = decodeURIComponent(normalized); } catch { /* keep original */ }
  return /\.(mp4|webm|mov)(\?|$)/i.test(normalized);
}

export function buildFootprintVideoMemoryMoments(
  routePoints: readonly JointRoutePoint[],
  jointVisits: readonly JointFootprint[],
  memories: readonly Memory[],
  maxMoments = 6,
): FootprintVideoMemoryMoment[] {
  const orderedRoute = [...routePoints]
    .filter((point) => Number.isFinite(Date.parse(point.arrivedAt)))
    .sort((a, b) => a.arrivedAt.localeCompare(b.arrivedAt));
  if (!orderedRoute.length || !jointVisits.length || !memories.length || maxMoments <= 0) return [];

  const routeDay = dayKey(orderedRoute[0].arrivedAt);
  const routeStart = Date.parse(orderedRoute[0].arrivedAt);
  const routeEnd = Date.parse(orderedRoute[orderedRoute.length - 1].arrivedAt);
  const sessionVisits = jointVisits.filter((visit) => {
    const time = Date.parse(visit.arrivedAt);
    return Number.isFinite(time)
      && time >= routeStart - 10 * 60_000
      && time <= routeEnd + 10 * 60_000;
  });

  const pointIndex = new Map(orderedRoute.map((point, index) => [point.id, index]));
  const candidates: Array<FootprintVideoMemoryMoment & { routeIndex: number; distanceMeters: number }> = [];
  const seenUrls = new Set<string>();

  for (const memory of memories) {
    if (!Number.isSafeInteger(memory.id) || memory.date !== routeDay || !memory.location) continue;
    const visit = sessionVisits.find((item) => samePlace(item.placeName, memory.location));
    if (!visit) continue;

    let nearest: JointRoutePoint | undefined;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const point of orderedRoute) {
      const distance = footprintPointDistanceMeters(visit, point);
      if (!Number.isFinite(distance) || distance >= nearestDistance) continue;
      nearest = point;
      nearestDistance = distance;
    }
    if (!nearest || nearestDistance > 300) continue;

    const photos = memory.images
      .filter((url) => typeof url === 'string' && url.trim() && !isVideoSource(url))
      .slice(0, 2);

    for (let imageIndex = 0; imageIndex < photos.length; imageIndex += 1) {
      const imageUrl = photos[imageIndex];
      if (seenUrls.has(imageUrl)) continue;
      seenUrls.add(imageUrl);
      candidates.push({
        id: 'memory-photo:' + memory.id + ':' + imageIndex,
        memoryId: memory.id,
        pointId: nearest.id,
        imageUrl,
        routeIndex: pointIndex.get(nearest.id) ?? Number.MAX_SAFE_INTEGER,
        distanceMeters: nearestDistance,
      });
    }
  }

  return candidates
    .sort((a, b) => a.routeIndex - b.routeIndex || a.distanceMeters - b.distanceMeters || a.memoryId - b.memoryId)
    .slice(0, Math.max(0, Math.floor(maxMoments)))
    .map((item) => ({
      id: item.id,
      memoryId: item.memoryId,
      pointId: item.pointId,
      imageUrl: item.imageUrl,
    }));
}
