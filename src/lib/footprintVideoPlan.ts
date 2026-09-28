import type { JointRoutePoint } from './footprintFoundation';

export type FootprintVideoSegmentKind = 'move' | 'stay' | 'reconnect';

export type FootprintVideoSegment = {
  fromIndex: number;
  toIndex: number;
  kind: FootprintVideoSegmentKind;
  realGapMs: number;
  distanceMeters: number;
  distanceBeforeMeters: number;
  durationMs: number;
  holdMs: number;
  startOffsetMs: number;
  endOffsetMs: number;
};

export type FootprintVideoPlan = {
  points: JointRoutePoint[];
  segments: FootprintVideoSegment[];
  totalDistanceMeters: number;
  realDurationMs: number;
  playbackDurationMs: number;
  stopCount: number;
  reconnectCount: number;
};

const CONTINUOUS_GAP_MS = 5 * 60 * 1000;
const STOP_GAP_MS = 75 * 1000;
const STOP_DISTANCE_METERS = 45;

function clamp(min: number, max: number, value: number) {
  return Math.min(max, Math.max(min, value));
}

export function footprintPointDistanceMeters(
  from: Pick<JointRoutePoint, 'latitude' | 'longitude'>,
  to: Pick<JointRoutePoint, 'latitude' | 'longitude'>,
) {
  const latitude1 = from.latitude * Math.PI / 180;
  const latitude2 = to.latitude * Math.PI / 180;
  const deltaLatitude = latitude2 - latitude1;
  const deltaLongitude = (to.longitude - from.longitude) * Math.PI / 180;
  const haversine = Math.sin(deltaLatitude / 2) ** 2
    + Math.cos(latitude1) * Math.cos(latitude2) * Math.sin(deltaLongitude / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

export function buildFootprintVideoPlan(points: readonly JointRoutePoint[]): FootprintVideoPlan {
  const ordered = [...points]
    .filter((point) => Number.isFinite(point.latitude) && Math.abs(point.latitude) <= 90)
    .filter((point) => Number.isFinite(point.longitude) && Math.abs(point.longitude) <= 180)
    .filter((point) => Number.isFinite(Date.parse(point.arrivedAt)))
    .sort((a, b) => a.arrivedAt.localeCompare(b.arrivedAt));

  if (ordered.length < 2) {
    return {
      points: ordered,
      segments: [],
      totalDistanceMeters: 0,
      realDurationMs: 0,
      playbackDurationMs: 0,
      stopCount: 0,
      reconnectCount: 0,
    };
  }

  type RawSegment = Omit<FootprintVideoSegment, 'durationMs' | 'holdMs' | 'startOffsetMs' | 'endOffsetMs'> & {
    rawDurationMs: number;
    rawHoldMs: number;
  };

  const rawSegments: RawSegment[] = [];
  let totalDistanceMeters = 0;
  let stopCount = 0;
  let reconnectCount = 0;

  for (let index = 0; index < ordered.length - 1; index += 1) {
    const from = ordered[index];
    const to = ordered[index + 1];
    const fromTime = Date.parse(from.arrivedAt);
    const toTime = Date.parse(to.arrivedAt);
    const realGapMs = toTime > fromTime ? toTime - fromTime : 60_000;
    const distanceMeters = footprintPointDistanceMeters(from, to);
    const reconnect = realGapMs > CONTINUOUS_GAP_MS;
    const staying = !reconnect && realGapMs >= STOP_GAP_MS && distanceMeters <= STOP_DISTANCE_METERS;
    const kind: FootprintVideoSegmentKind = reconnect ? 'reconnect' : staying ? 'stay' : 'move';
    const distanceBeforeMeters = totalDistanceMeters;

    if (kind === 'move') totalDistanceMeters += distanceMeters;
    if (kind === 'stay') stopCount += 1;
    if (kind === 'reconnect') reconnectCount += 1;

    let rawDurationMs: number;
    let rawHoldMs = 0;
    if (kind === 'reconnect') {
      rawDurationMs = 520;
      rawHoldMs = 620;
    } else if (kind === 'stay') {
      rawDurationMs = 260;
      rawHoldMs = clamp(650, 1_450, 620 + (realGapMs / 60_000) * 90);
    } else {
      rawDurationMs = clamp(
        440,
        1_900,
        350 + Math.sqrt(Math.max(1, distanceMeters)) * 31 + Math.log1p(realGapMs / 1000) * 58,
      );
    }

    rawSegments.push({
      fromIndex: index,
      toIndex: index + 1,
      kind,
      realGapMs,
      distanceMeters,
      distanceBeforeMeters,
      rawDurationMs,
      rawHoldMs,
    });
  }

  const rawPlaybackMs = rawSegments.reduce(
    (sum, segment) => sum + segment.rawDurationMs + segment.rawHoldMs,
    0,
  );
  const targetPlaybackMs = clamp(
    7_000,
    22_000,
    4_000 + rawSegments.length * 440 + stopCount * 380 + reconnectCount * 320,
  );
  const scale = rawPlaybackMs > 0 ? clamp(0.42, 1.12, targetPlaybackMs / rawPlaybackMs) : 1;

  let offset = 0;
  const segments: FootprintVideoSegment[] = rawSegments.map((segment) => {
    const durationMs = clamp(260, 1_650, Math.round(segment.rawDurationMs * scale));
    const holdMs = segment.rawHoldMs
      ? clamp(360, 1_250, Math.round(segment.rawHoldMs * scale))
      : 0;
    const startOffsetMs = offset;
    offset += durationMs + holdMs;
    return {
      fromIndex: segment.fromIndex,
      toIndex: segment.toIndex,
      kind: segment.kind,
      realGapMs: segment.realGapMs,
      distanceMeters: segment.distanceMeters,
      distanceBeforeMeters: segment.distanceBeforeMeters,
      durationMs,
      holdMs,
      startOffsetMs,
      endOffsetMs: offset,
    };
  });

  const firstTime = Date.parse(ordered[0].arrivedAt);
  const lastTime = Date.parse(ordered[ordered.length - 1].arrivedAt);

  return {
    points: ordered,
    segments,
    totalDistanceMeters: Math.round(totalDistanceMeters),
    realDurationMs: Math.max(0, lastTime - firstTime),
    playbackDurationMs: offset,
    stopCount,
    reconnectCount,
  };
}
