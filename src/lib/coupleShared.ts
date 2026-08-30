import { doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from './firebase';

export type CoupleSharedData = {
  relationshipStartDate?: string;
  nicknames: Record<string, string>;
};

export function subscribeCoupleShared(coupleId: string, onChange: (data: CoupleSharedData) => void) {
  return onSnapshot(doc(db, 'couples', coupleId), (snapshot) => {
    const data = snapshot.data() ?? {};
    const rawNicknames = data.nicknames && typeof data.nicknames === 'object' ? data.nicknames as Record<string, unknown> : {};
    const nicknames = Object.fromEntries(
      Object.entries(rawNicknames)
        .filter(([, value]) => typeof value === 'string' && value.trim())
        .map(([uid, value]) => [uid, String(value).trim()]),
    );
    onChange({
      relationshipStartDate: typeof data.relationshipStartDate === 'string' ? data.relationshipStartDate : undefined,
      nicknames,
    });
  });
}

export async function saveRelationshipStartDate(coupleId: string, date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('invalid-relationship-date');
  await setDoc(doc(db, 'couples', coupleId), {
    relationshipStartDate: date,
    updatedAt: serverTimestamp(),
  }, { merge: true });
}

export async function savePartnerNickname(coupleId: string, targetUid: string, nickname: string) {
  const value = nickname.trim();
  if (!targetUid || value.length < 1 || value.length > 12) throw new Error('invalid-partner-nickname');
  await setDoc(doc(db, 'couples', coupleId), {
    [`nicknames.${targetUid}`]: value,
    updatedAt: serverTimestamp(),
  }, { merge: true });
}
