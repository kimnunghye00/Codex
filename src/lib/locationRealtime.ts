import { collection, doc, onSnapshot, query, serverTimestamp, setDoc, where } from 'firebase/firestore';
import { db } from './firebase';
import type { LocationVisit } from '../utils/location';

type CloudLocationVisit = LocationVisit & {
  ownerUid: string;
  dayKey: string;
  updatedAt?: unknown;
};

function localDayKey(value: string) {
  const date = new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function visitRef(coupleId: string, ownerUid: string, visitId: string) {
  return doc(db, 'couples', coupleId, 'locations', `${ownerUid}-${visitId}`);
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

export function subscribePartnerLocationVisits(
  coupleId: string,
  partnerUid: string,
  dayKey: string,
  onVisits: (visits: LocationVisit[]) => void,
  onError?: (error: unknown) => void,
) {
  const locations = collection(db, 'couples', coupleId, 'locations');
  // Filter the requested day on Firestore instead of downloading the partner's
  // entire location history and discarding unrelated days on the device.
  const q = query(
    locations,
    where('ownerUid', '==', partnerUid),
    where('dayKey', '==', dayKey),
  );

  return onSnapshot(q, (snapshot) => {
    const visits = snapshot.docs.map((snapshotDoc) => {
      const data = snapshotDoc.data() as CloudLocationVisit;
      return {
        id: data.id || snapshotDoc.id,
        latitude: Number(data.latitude),
        longitude: Number(data.longitude),
        accuracy: Number(data.accuracy || 0),
        placeName: data.placeName,
        arrivedAt: data.arrivedAt,
        leftAt: data.leftAt,
      } satisfies LocationVisit;
    }).filter((visit) => Number.isFinite(visit.latitude) && Number.isFinite(visit.longitude))
      .sort((a, b) => a.arrivedAt.localeCompare(b.arrivedAt));

    onVisits(visits);
  }, onError);
}
