import { collection, doc, onSnapshot, query, serverTimestamp, setDoc, where } from 'firebase/firestore';
import { db } from './firebase';
import { normalizeLocationVisit, type LocationVisit } from '../utils/location';

type CloudLocationVisit = LocationVisit & {
  ownerUid: string;
  dayKey: string;
  updatedAt?: unknown;
};

export type LocationSample = {
  id: string;
  latitude: number;
  longitude: number;
  accuracy: number;
  recordedAt: string;
  background?: boolean;
};

type CloudLocationSample = LocationSample & {
  ownerUid: string;
  dayKey: string;
  updatedAt?: unknown;
};

function localDayKey(value: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(value));
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '';
  return part('year') + '-' + part('month') + '-' + part('day');
}

function visitRef(coupleId: string, ownerUid: string, visitId: string) {
  return doc(db, 'couples', coupleId, 'locations', `${ownerUid}-${visitId}`);
}

function sampleRef(coupleId: string, ownerUid: string, sampleId: string) {
  return doc(db, 'couples', coupleId, 'locationSamples', `${ownerUid}-${sampleId}`);
}

export async function saveCoupleLocationVisit(coupleId: string, ownerUid: string, visit: LocationVisit) {
  const payload: CloudLocationVisit = {
    ...visit,
    ownerUid,
    dayKey: localDayKey(visit.arrivedAt),
    updatedAt: serverTimestamp(),
  };
  await setDoc(visitRef(coupleId, ownerUid, visit.id), payload, { merge: true });
}


export async function saveCoupleLocationSample(
  coupleId: string,
  ownerUid: string,
  sample: LocationSample,
) {
  const payload: CloudLocationSample = {
    ...sample,
    ownerUid,
    dayKey: localDayKey(sample.recordedAt),
    updatedAt: serverTimestamp(),
  };
  await setDoc(sampleRef(coupleId, ownerUid, sample.id), payload, { merge: true });
}

export function subscribeMemberLocationSamples(
  coupleId: string,
  memberUid: string,
  dayKey: string,
  onSamples: (samples: LocationSample[]) => void,
  onError?: (error: unknown) => void,
) {
  const samples = collection(db, 'couples', coupleId, 'locationSamples');
  const q = query(
    samples,
    where('ownerUid', '==', memberUid),
    where('dayKey', '==', dayKey),
  );

  let lastSignature = '';
  return onSnapshot(q, (snapshot) => {
    const values = snapshot.docs
      .flatMap((snapshotDoc): LocationSample[] => {
        const data = snapshotDoc.data() as Partial<CloudLocationSample>;
        const latitude = Number(data.latitude);
        const longitude = Number(data.longitude);
        const accuracy = Number(data.accuracy);
        const recordedAt = typeof data.recordedAt === 'string' ? data.recordedAt : '';
        const recordedAtMs = Date.parse(recordedAt);
        if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90
          || !Number.isFinite(longitude) || longitude < -180 || longitude > 180
          || !Number.isFinite(accuracy) || accuracy < 0
          || !Number.isFinite(recordedAtMs)) return [];
        return [{
          id: typeof data.id === 'string' && data.id ? data.id : snapshotDoc.id,
          latitude,
          longitude,
          accuracy,
          recordedAt: new Date(recordedAtMs).toISOString(),
          background: data.background === true,
        }];
      })
      .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));

    const signature = JSON.stringify(values.map((sample) => [
      sample.id,
      sample.latitude,
      sample.longitude,
      sample.accuracy,
      sample.recordedAt,
      sample.background === true,
    ]));
    if (signature === lastSignature) return;
    lastSignature = signature;
    onSamples(values);
  }, onError);
}

export function subscribeMemberLocationVisits(
  coupleId: string,
  memberUid: string,
  dayKey: string,
  onVisits: (visits: LocationVisit[]) => void,
  onError?: (error: unknown) => void,
) {
  const locations = collection(db, 'couples', coupleId, 'locations');
  // Filter the requested day on Firestore instead of downloading the partner's
  // entire location history and discarding unrelated days on the device.
  const q = query(
    locations,
    where('ownerUid', '==', memberUid),
    where('dayKey', '==', dayKey),
  );

  let lastSignature = '';
  return onSnapshot(q, (snapshot) => {
    const visits = snapshot.docs
      .map((snapshotDoc) => {
        const data = snapshotDoc.data() as CloudLocationVisit;
        return normalizeLocationVisit({
          id: data.id || snapshotDoc.id,
          latitude: data.latitude,
          longitude: data.longitude,
          accuracy: data.accuracy,
          placeName: data.placeName,
          arrivedAt: data.arrivedAt,
          lastSeenAt: data.lastSeenAt,
          leftAt: data.leftAt,
        }, snapshotDoc.id);
      })
      .filter((visit): visit is LocationVisit => Boolean(visit))
      .sort((a, b) => a.arrivedAt.localeCompare(b.arrivedAt));

    const signature = JSON.stringify(visits.map((visit) => [
      visit.id,
      visit.latitude,
      visit.longitude,
      visit.accuracy,
      visit.placeName ?? '',
      visit.arrivedAt,
      visit.lastSeenAt ?? '',
      visit.leftAt ?? '',
    ]));
    if (signature === lastSignature) return;
    lastSignature = signature;
    onVisits(visits);
  }, onError);
}


/** Backwards-compatible name for existing location screens. */
export function subscribePartnerLocationVisits(
  coupleId: string,
  partnerUid: string,
  dayKey: string,
  onVisits: (visits: LocationVisit[]) => void,
  onError?: (error: unknown) => void,
) {
  return subscribeMemberLocationVisits(coupleId, partnerUid, dayKey, onVisits, onError);
}
