import { collection, deleteDoc, doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from './firebase';
import type { DatePlanDraft, DatePlanCandidate } from './datePlanFoundation';

const planCollection = (coupleId: string) => collection(db, 'couples', coupleId, 'datePlans');
const candidateCollection = (coupleId: string, planId: string) =>
  collection(db, 'couples', coupleId, 'datePlans', planId, 'candidates');

/**
 * Opt-in V2 API. Current date-map screens deliberately continue to use
 * dateCourses/datePlaces; stage 1 never rewrites or migrates those collections.
 */
export function subscribeDatePlanDrafts(
  coupleId: string, onChange: (plans: DatePlanDraft[]) => void, onError: (error: unknown) => void,
) {
  return onSnapshot(planCollection(coupleId), (snapshot) =>
    onChange(snapshot.docs.map((item) => ({ ...item.data(), id: item.id } as DatePlanDraft))
      .sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title, 'ko-KR'))), onError);
}

export async function createDatePlanDraft(coupleId: string, uid: string, input: { title?: string; date?: string } = {}) {
  const ref = doc(planCollection(coupleId));
  await setDoc(ref, {
    id: ref.id,
    title: (input.title ?? '').trim().slice(0, 100),
    date: input.date ?? '',
    status: 'draft',
    schemaVersion: 2,
    createdBy: uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

/** Patch only edited fields, avoiding unrelated title/date overwrites between devices. */
export async function updateDatePlanDraft(coupleId: string, planId: string, input: { title?: string; date?: string }) {
  const updates: { title?: string; date?: string; updatedAt: ReturnType<typeof serverTimestamp> } = {
    updatedAt: serverTimestamp(),
  };
  if (input.title !== undefined) updates.title = input.title.trim().slice(0, 100);
  if (input.date !== undefined) updates.date = input.date;
  if (updates.title === undefined && updates.date === undefined) return;
  await setDoc(doc(planCollection(coupleId), planId), updates, { merge: true });
}

export function subscribeDatePlanCandidates(
  coupleId: string, planId: string,
  onChange: (candidates: DatePlanCandidate[]) => void, onError: (error: unknown) => void,
) {
  return onSnapshot(candidateCollection(coupleId, planId), (snapshot) =>
    onChange(snapshot.docs.map((item) => ({ ...item.data(), id: item.id } as DatePlanCandidate))
      .sort((a, b) => a.name.localeCompare(b.name, 'ko-KR'))), onError);
}

export async function addDatePlanCandidate(
  coupleId: string, planId: string, uid: string,
  input: Pick<DatePlanCandidate, 'name' | 'address' | 'latitude' | 'longitude' | 'category' | 'memo'> &
    { sourceSavedPlaceId?: string },
) {
  const ref = doc(candidateCollection(coupleId, planId));
  const payload = {
    id: ref.id,
    name: input.name.trim().slice(0, 120),
    address: input.address.trim().slice(0, 240),
    latitude: input.latitude,
    longitude: input.longitude,
    category: input.category,
    memo: input.memo.trim().slice(0, 1000),
    ...(input.sourceSavedPlaceId ? { sourceSavedPlaceId: input.sourceSavedPlaceId } : {}),
    createdBy: uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  await setDoc(ref, payload);
  return ref.id;
}

/** Candidates belong only to a plan, not to the global datePlaces collection. */
export async function updateDatePlanCandidateMemo(
  coupleId: string, planId: string, candidateId: string, memo: string,
) {
  await setDoc(doc(candidateCollection(coupleId, planId), candidateId), {
    memo: memo.trim().slice(0, 1000), updatedAt: serverTimestamp(),
  }, { merge: true });
}

export async function deleteDatePlanCandidate(coupleId: string, planId: string, candidateId: string) {
  await deleteDoc(doc(candidateCollection(coupleId, planId), candidateId));
}
