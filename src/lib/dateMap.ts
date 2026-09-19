import { collection, deleteDoc, doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from './firebase';

export type DatePlace = {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  category: '맛집' | '카페' | '놀거리' | '여행' | '기타';
  memo: string;
  /** Optional explicit photo URL; never inferred from a similarly named branch. */
  photoUrl?: string;
  createdBy: string;
  createdAt?: unknown;
  updatedAt?: unknown;
};
export type DateCourse = {
  id: string;
  title: string;
  date: string;
  placeIds: string[];
  /** Optional for legacy courses; entries align with placeIds and use HH:mm-HH:mm or ''. */
  timeSlots?: string[];
  createdBy: string;
  updatedAt?: unknown;
};
export type PlaceOpinion = {
  id: string;
  authorUid: string;
  text: string;
  createdAt?: unknown;
};

const placeCollection = (coupleId: string) => collection(db, 'couples', coupleId, 'datePlaces');
const courseCollection = (coupleId: string) => collection(db, 'couples', coupleId, 'dateCourses');

export function subscribeDatePlaces(coupleId: string, onChange: (places: DatePlace[]) => void, onError: (error: unknown) => void) {
  return onSnapshot(placeCollection(coupleId), (snapshot) => {
    onChange(snapshot.docs.map((item) => ({ ...item.data(), id: item.id } as DatePlace))
      .sort((a, b) => a.name.localeCompare(b.name, 'ko-KR')));
  }, onError);
}

export function subscribeDateCourses(coupleId: string, onChange: (courses: DateCourse[]) => void, onError: (error: unknown) => void) {
  return onSnapshot(courseCollection(coupleId), (snapshot) => {
    onChange(snapshot.docs.map((item) => ({ ...item.data(), id: item.id } as DateCourse))
      .sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title, 'ko-KR')));
  }, onError);
}

export async function addDatePlace(coupleId: string, ownerUid: string, input: Pick<DatePlace, 'name' | 'address' | 'latitude' | 'longitude' | 'category' | 'memo'>) {
  const ref = doc(placeCollection(coupleId));
  const payload: DatePlace = {
    ...input,
    id: ref.id,
    createdBy: ownerUid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  await setDoc(ref, payload);
  return ref.id;
}

export async function updateDatePlace(coupleId: string, place: DatePlace, input: Pick<DatePlace, 'memo' | 'category'>) {
  await setDoc(doc(placeCollection(coupleId), place.id), {
    ...input, updatedAt: serverTimestamp(),
  }, { merge: true });
}

export async function deleteDatePlace(coupleId: string, id: string) {
  await deleteDoc(doc(placeCollection(coupleId), id));
}

export async function saveDateCourse(coupleId: string, uid: string,
  input: Pick<DateCourse, 'title' | 'date' | 'placeIds'> & { timeSlots?: string[] }, existingId?: string) {
  const ref = existingId ? doc(courseCollection(coupleId), existingId) : doc(courseCollection(coupleId));
  // Existing callers and saved courses remain compatible: missing time = undecided.
  const timeSlots = input.placeIds.map((_, index) => input.timeSlots?.[index] ?? '');
  const data = { title: input.title, date: input.date, placeIds: input.placeIds, timeSlots, updatedAt: serverTimestamp() };
  if (existingId) {
    await setDoc(ref, data, { merge: true });
  } else {
    await setDoc(ref, { ...data, id: ref.id, createdBy: uid });
  }
  return ref.id;
}

export async function deleteDateCourse(coupleId: string, id: string) {
  await deleteDoc(doc(courseCollection(coupleId), id));
}

export function subscribePlaceLikes(coupleId: string, placeId: string, onChange: (uids: string[]) => void, onError: (error: unknown) => void) {
  return onSnapshot(collection(db, 'couples', coupleId, 'datePlaces', placeId, 'likes'), (snapshot) =>
    onChange(snapshot.docs.filter((item) => item.data().liked === true).map((item) => item.id)), onError);
}

export async function setPlaceLike(coupleId: string, placeId: string, uid: string, liked: boolean) {
  const ref = doc(db, 'couples', coupleId, 'datePlaces', placeId, 'likes', uid);
  if (liked) await setDoc(ref, { uid, liked: true });
  else await deleteDoc(ref);
}

export function subscribePlaceOpinions(coupleId: string, placeId: string, onChange: (items: PlaceOpinion[]) => void, onError: (error: unknown) => void) {
  return onSnapshot(collection(db, 'couples', coupleId, 'datePlaces', placeId, 'opinions'), (snapshot) => {
    onChange(snapshot.docs.map((item) => ({ ...item.data(), id: item.id } as PlaceOpinion))
      .sort((a, b) => {
        const when = (value: unknown) => {
          if (value && typeof value === 'object' && 'toMillis' in value && typeof value.toMillis === 'function') return value.toMillis();
          return 0;
        };
        return when(a.createdAt) - when(b.createdAt) || a.id.localeCompare(b.id);
      }));
  }, onError);
}

export async function addPlaceOpinion(coupleId: string, placeId: string, uid: string, text: string) {
  const ref = doc(collection(db, 'couples', coupleId, 'datePlaces', placeId, 'opinions'));
  await setDoc(ref, { id: ref.id, authorUid: uid, text: text.trim(), createdAt: serverTimestamp() });
}

export async function deletePlaceOpinion(coupleId: string, placeId: string, id: string) {
  await deleteDoc(doc(db, 'couples', coupleId, 'datePlaces', placeId, 'opinions', id));
}
