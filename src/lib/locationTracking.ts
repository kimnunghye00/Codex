import { saveCoupleLocationVisit } from './locationRealtime';
import { startRouteLocationWatch, type RouteLocationError, type RouteLocationWatch } from './native';
import {
  distanceMeters,
  loadLocationVisits,
  reverseGeocode,
  saveLocationVisits,
  type LocationVisit,
} from '../utils/location';

const MIN_MOVE_METERS = 120;
const HEARTBEAT_MS = 60_000;
const MAX_RECORDABLE_ACCURACY_METERS = 250;

export type LocationTrackingStatus = {
  state: 'starting' | 'tracking' | 'recorded' | 'poor-signal' | 'error';
  message: string;
};

type StartOptions = {
  uid: string;
  coupleId: string;
  onStatus?: (status: LocationTrackingStatus) => void;
};

function validPoint(latitude: number, longitude: number, accuracy: number) {
  return Number.isFinite(latitude) && latitude >= -90 && latitude <= 90
    && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180
    && Number.isFinite(accuracy) && accuracy >= 0;
}

function lastEvidenceMs(visit: LocationVisit) {
  const value = visit.lastSeenAt || visit.arrivedAt;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function errorMessage(error: RouteLocationError) {
  const code = String(error.code ?? '');
  if (code === '1' || code === 'OS-PLUG-GLOC-0003' || code.includes('PERMISSION')) {
    return '위치 권한이 없어 발자취 기록을 계속할 수 없어요.';
  }
  if (code === 'OS-PLUG-GLOC-0007' || code === 'OS-PLUG-GLOC-0017') {
    return '휴대폰 위치 서비스가 꺼져 있어 발자취 기록을 멈췄어요.';
  }
  return 'GPS 위치를 확인하지 못했어요. 신호가 회복되면 다시 기록해요.';
}

/**
 * Records the signed-in member's own GPS only.
 *
 * Each stable point receives a periodic lastSeenAt heartbeat. That timestamp is
 * important: joint footprints use it as evidence that both phones were actually
 * present during the same time window instead of extending an old open record
 * indefinitely.
 */
export async function startCoupleLocationTracking({
  uid,
  coupleId,
  onStatus,
}: StartOptions): Promise<RouteLocationWatch> {
  const ownerUid = uid.trim();
  const ownerCoupleId = coupleId.trim();
  if (!ownerUid || !ownerCoupleId) throw new Error('route-location-owner-missing');

  let visits = loadLocationVisits(ownerUid);
  let recording = false;
  let stopped = false;

  const notify = (state: LocationTrackingStatus['state'], message: string) => {
    if (!stopped) onStatus?.({ state, message });
  };

  const persist = (next: LocationVisit[]) => {
    visits = next.slice(0, 300);
    saveLocationVisits(ownerUid, visits);
  };

  const sync = async (visit: LocationVisit) => {
    await saveCoupleLocationVisit(ownerCoupleId, ownerUid, visit);
  };

  const record = async (latitude: number, longitude: number, accuracy: number) => {
    if (recording || stopped || !validPoint(latitude, longitude, accuracy)) return;
    if (accuracy > MAX_RECORDABLE_ACCURACY_METERS) {
      notify('poor-signal', 'GPS 오차가 커서 이 위치는 발자취에 저장하지 않았어요.');
      return;
    }

    recording = true;
    try {
      const now = new Date().toISOString();
      const nowMs = Date.parse(now);
      const current = visits[0];
      const point = { latitude, longitude };

      if (current && !current.leftAt && distanceMeters(current, point) < MIN_MOVE_METERS) {
        if (nowMs - lastEvidenceMs(current) < HEARTBEAT_MS) {
          notify('tracking', 'GPS를 확인하며 발자취를 기록하고 있어요.');
          return;
        }
        const updated: LocationVisit = {
          ...current,
          latitude,
          longitude,
          accuracy,
          lastSeenAt: now,
        };
        persist([updated, ...visits.slice(1)]);
        await sync(updated);
        notify('tracking', '현재 위치를 다시 확인했어요.');
        return;
      }

      const placeName = await reverseGeocode(latitude, longitude);
      const closed: LocationVisit | undefined = current && !current.leftAt
        ? { ...current, lastSeenAt: now, leftAt: now }
        : undefined;
      const rest = current ? visits.slice(1) : visits;
      const nextVisit: LocationVisit = {
        id: String(Date.now()),
        latitude,
        longitude,
        accuracy,
        placeName,
        arrivedAt: now,
        lastSeenAt: now,
      };
      persist([nextVisit, ...(closed ? [closed] : current ? [current] : []), ...rest]);
      if (closed) await sync(closed);
      await sync(nextVisit);
      notify('recorded', placeName ? placeName + ' 위치가 기록됐어요.' : '새 위치가 발자취에 기록됐어요.');
    } catch (error) {
      console.warn('[DANDULI location tracking]', error);
      notify('error', '위치는 기기에 남겼지만 서버 동기화에 실패했어요.');
    } finally {
      recording = false;
    }
  };

  notify('starting', '위치 권한과 GPS를 확인하고 있어요.');
  const watch = await startRouteLocationWatch(
    (position) => {
      void record(position.coords.latitude, position.coords.longitude, position.coords.accuracy);
    },
    (error) => notify('error', errorMessage(error)),
  );
  notify('tracking', '내 GPS 발자취를 기록하고 있어요.');

  return {
    stop: async () => {
      stopped = true;
      await watch.stop();
    },
  };
}
