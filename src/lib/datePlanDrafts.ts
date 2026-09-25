import { collection, deleteDoc, doc, getDocFromServer, getDocsFromServer, onSnapshot, runTransaction, serverTimestamp, setDoc } from 'firebase/firestore';
import { auth, db } from './firebase';
import type { DatePlanDraft, DatePlanCandidate } from './datePlanFoundation';
import { datePlanCandidateId, isSameDatePlanPlace } from './datePlanCandidates';

const planCollection = (coupleId: string) => collection(db, 'couples', coupleId, 'datePlans');
const candidateCollection = (coupleId: string, planId: string) =>
  collection(db, 'couples', coupleId, 'datePlans', planId, 'candidates');

/**
 * Isolated date-plan V2 API. Legacy dateCourses/datePlaces are never rewritten.
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

/** Fetch the complete server list to repair missed/late local snapshot updates. */
export async function readDatePlanCandidates(coupleId: string, planId: string): Promise<DatePlanCandidate[]> {
  const snapshot = await getDocsFromServer(candidateCollection(coupleId, planId));
  return snapshot.docs.map((item) => ({ ...item.data(), id: item.id } as DatePlanCandidate))
    .sort((a, b) => a.name.localeCompare(b.name, 'ko-KR'));
}

export async function addDatePlanCandidate(
  coupleId: string, planId: string, uid: string,
  input: Pick<DatePlanCandidate, 'name' | 'address' | 'latitude' | 'longitude' | 'category' | 'memo'> &
    { sourceSavedPlaceId?: string },
) {
  const candidates = candidateCollection(coupleId, planId);
  // The existing snapshot covers legacy random IDs and slightly different provider coordinates.
  // Do not write anything into the global datePlaces wishlist.
  const existing = await getDocsFromServer(candidates);
  const duplicate = existing.docs.find((item) => isSameDatePlanPlace(item.data() as DatePlanCandidate, input));
  if (duplicate) return duplicate.id;
  const ref = doc(candidates, datePlanCandidateId(input));
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
  // An identical concurrent write by the other partner must not replace its author or note.
  await runTransaction(db, async (transaction) => {
    const found = await transaction.get(ref);
    if (!found.exists()) transaction.set(ref, payload);
  });
  // A resolved write is not sufficient if the selected plan cannot read it.
  const verified = await getDocFromServer(ref);
  if (!verified.exists()) throw new Error('date-plan-candidate-not-visible');
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


const DELETE_DATE_PLAN_URL = String(import.meta.env.VITE_DELETE_DATE_PLAN_URL
  || 'https://asia-northeast3-meluni-f4e00.cloudfunctions.net/deleteDatePlanDraftV2').trim();

/**
 * Delete through the authenticated server endpoint. Firestore clients retain
 * zero permission to delete a plan root or its timetable directly.
 */
export async function deleteDatePlanDraft(coupleId: string, planId: string) {
  const user = auth.currentUser;
  if (!user) throw new Error('authentication-required');
  const response = await fetch(DELETE_DATE_PLAN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${await user.getIdToken()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ coupleId, planId }),
  });
  let payload: { error?: string } = {};
  try { payload = await response.json() as { error?: string }; } catch { /* non-json server failure */ }
  if (!response.ok) throw new Error(payload.error || 'date-plan-delete-failed');
}
