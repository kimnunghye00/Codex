import { doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from './firebase';

export type CoupleSharedData = {
  relationshipStartDate?: string;
};

export function subscribeCoupleShared(coupleId: string, onChange: (data: CoupleSharedData) => void) {
  return onSnapshot(doc(db, 'couples', coupleId), (snapshot) => {
    const data = snapshot.data() ?? {};
    onChange({ relationshipStartDate: typeof data.relationshipStartDate === 'string' ? data.relationshipStartDate : undefined });
  });
}

export async function saveRelationshipStartDate(coupleId: string, date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('invalid-relationship-date');
  await setDoc(doc(db, 'couples', coupleId), {
    relationshipStartDate: date,
    updatedAt: serverTimestamp(),
  }, { merge: true });
}
