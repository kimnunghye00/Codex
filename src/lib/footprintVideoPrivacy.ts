import type { JointRoutePoint } from './footprintFoundation';
import { footprintPointDistanceMeters } from './footprintVideoPlan';

export const FOOTPRINT_VIDEO_PRIVACY_RADIUS_METERS = 200;

export type FootprintVideoPrivacyResult = {
  points: JointRoutePoint[];
  enabled: boolean;
  radiusMeters: number;
  hiddenPointCount: number;
  startHiddenPointCount: number;
  endHiddenPointCount: number;
  fallbackSanitized: boolean;
};

function stripPlaceName(point: JointRoutePoint): JointRoutePoint {
  if (!point.placeName) return point;
  const { placeName: _placeName, ...rest } = point;
  return rest;
}

function sanitizeBoundaryNames(points: readonly JointRoutePoint[]) {
  if (!points.length) return [] as JointRoutePoint[];
  if (points.length === 1) return [stripPlaceName(points[0])];
  return points.map((point, index) => (
    index === 0 || index === points.length - 1 ? stripPlaceName(point) : point
  ));
}

export function protectFootprintVideoRoute(
  points: readonly JointRoutePoint[],
  enabled = true,
  radiusMeters = FOOTPRINT_VIDEO_PRIVACY_RADIUS_METERS,
): FootprintVideoPrivacyResult {
  const ordered = [...points]
    .filter((point) => Number.isFinite(point.latitude) && Math.abs(point.latitude) <= 90)
    .filter((point) => Number.isFinite(point.longitude) && Math.abs(point.longitude) <= 180)
    .filter((point) => Number.isFinite(Date.parse(point.arrivedAt)))
    .sort((a, b) => a.arrivedAt.localeCompare(b.arrivedAt));

  const safeRadius = Number.isFinite(radiusMeters) ? Math.max(0, radiusMeters) : 0;
  if (!enabled || ordered.length < 2 || safeRadius <= 0) {
    return {
      points: ordered,
      enabled: false,
      radiusMeters: safeRadius,
      hiddenPointCount: 0,
      startHiddenPointCount: 0,
      endHiddenPointCount: 0,
      fallbackSanitized: false,
    };
  }

  const first = ordered[0];
  const last = ordered[ordered.length - 1];

  let startIndex = 0;
  for (let index = 1; index < ordered.length - 1; index += 1) {
    if (footprintPointDistanceMeters(first, ordered[index]) >= safeRadius) {
      startIndex = index;
      break;
    }
  }

  let endIndex = ordered.length - 1;
  for (let index = ordered.length - 2; index > 0; index -= 1) {
    if (footprintPointDistanceMeters(last, ordered[index]) >= safeRadius) {
      endIndex = index;
      break;
    }
  }

  const canTrimStart = startIndex > 0;
  const canTrimEnd = endIndex < ordered.length - 1;
  if ((canTrimStart || canTrimEnd) && endIndex - startIndex >= 1) {
    const trimmed = sanitizeBoundaryNames(ordered.slice(startIndex, endIndex + 1));
    const startHiddenPointCount = startIndex;
    const endHiddenPointCount = ordered.length - 1 - endIndex;
    return {
      points: trimmed,
      enabled: true,
      radiusMeters: safeRadius,
      hiddenPointCount: startHiddenPointCount + endHiddenPointCount,
      startHiddenPointCount,
      endHiddenPointCount,
      fallbackSanitized: false,
    };
  }

  // A very short/sparse route can become unusable if both ends are removed.
  // In that case keep its geometry but never expose endpoint place names.
  return {
    points: sanitizeBoundaryNames(ordered),
    enabled: true,
    radiusMeters: safeRadius,
    hiddenPointCount: 0,
    startHiddenPointCount: 0,
    endHiddenPointCount: 0,
    fallbackSanitized: true,
  };
}
