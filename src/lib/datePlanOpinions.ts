import {
  collection, deleteDoc, deleteField, doc, FieldPath, getDocsFromServer, onSnapshot,
  serverTimestamp, setDoc, updateDoc, writeBatch,
} from 'firebase/firestore';
import { db } from './firebase';
import type { CandidatePreference, DatePlanCandidateComment } from './datePlanFoundation';

const candidateRef = (coupleId: string, planId: string, candidateId: string) =>
  doc(db, 'couples', coupleId, 'datePlans', planId, 'candidates', candidateId);
const commentsRef = (coupleId: string, planId: string, candidateId: string) =>
  collection(candidateRef(coupleId, planId, candidateId), 'comments');

/** Merge a single partner's vote; do not overwrite the other partner or the shared memo. */
export async function setDatePlanCandidatePreference(
  coupleId: string, planId: string, candidateId: string, uid: string, preference: CandidatePreference | null,
) {
  if (preference !== null && !(['want', 'considering', 'pass'] as const).includes(preference)) {
    throw new RangeError('장소 의견을 다시 선택해 주세요.');
  }
  await updateDoc(candidateRef(coupleId, planId, candidateId),
    new FieldPath('votes', uid), preference ?? deleteField(), 'updatedAt', serverTimestamp());
}

export function subscribeDatePlanCandidateComments(
  coupleId: string, planId: string, candidateId: string,
  onChange: (comments: DatePlanCandidateComment[]) => void, onError: (error: unknown) => void,
) {
  return onSnapshot(commentsRef(coupleId, planId, candidateId), (snapshot) => {
    const comments = snapshot.docs.map((item) => ({ ...item.data(), id: item.id } as DatePlanCandidateComment));
    comments.sort((a, b) => {
      const left = (a.createdAt as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0;
      const right = (b.createdAt as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0;
      return left - right || a.id.localeCompare(b.id);
    });
    onChange(comments);
  }, onError);
}

export async function addDatePlanCandidateComment(
  coupleId: string, planId: string, candidateId: string, uid: string, value: string,
) {
  const text = value.trim();
  if (!text || text.length > 500) throw new RangeError('댓글은 1~500자로 입력해 주세요.');
  const ref = doc(commentsRef(coupleId, planId, candidateId));
  await setDoc(ref, { id: ref.id, authorUid: uid, text, createdAt: serverTimestamp() });
  return ref.id;
}

export async function deleteDatePlanCandidateComment(
  coupleId: string, planId: string, candidateId: string, commentId: string,
) {
  await deleteDoc(doc(commentsRef(coupleId, planId, candidateId), commentId));
}

/** Remove selected candidate and its comments together, never touching the shared wish list.
 * Votes are stored in the candidate itself, so deletion leaves no vote documents.
 * All comments are partner-visible; removal of the whole candidate is a joint-editable
 * draft action, distinct from deleting an individual partner's comment.
 */
export async function removeDatePlanCandidateWithFeedback(coupleId: string, planId: string, candidateId: string) {
  const comments = await getDocsFromServer(commentsRef(coupleId, planId, candidateId));
  // The rules check the candidate's post-commit absence for deleting a partner's comments.
  // Firestore batches may have at most 500 operations; refuse rather than orphan.
  if (comments.size >= 450) throw new Error('candidate-comments-too-many');
  const batch = writeBatch(db);
  comments.docs.forEach((item) => batch.delete(item.ref));
  batch.delete(candidateRef(coupleId, planId, candidateId));
  await batch.commit();
}
