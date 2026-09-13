import { collection, doc, onSnapshot, query, serverTimestamp, setDoc, where } from 'firebase/firestore';
import { db } from './firebase';
import { normalizeLocationVisit, type LocationVisit } from '../utils/location';

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
      visit.leftAt ?? '',
    ]));
    if (signature === lastSignature) return;
    lastSignature = signature;
    onVisits(visits);
  }, onError);
}
