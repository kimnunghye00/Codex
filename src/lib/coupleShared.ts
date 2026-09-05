import { doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from './firebase';

export type CoupleSharedData = {
  relationshipStartDate?: string;
  nicknames: Record<string, string>;
};

const CLOUD_ACK_WAIT_MS = 1200;
type WriteOutcome = { kind: 'confirmed' } | { kind: 'queued' } | { kind: 'failed'; cause: unknown };

async function waitForWriteWithoutBlockingOffline(write: Promise<void>) {
  let timeout: number | undefined;
  const tracked = write.then<WriteOutcome>(
    () => ({ kind: 'confirmed' }),
    (cause) => ({ kind: 'failed', cause }),
  );
  const delayed = new Promise<WriteOutcome>((resolve) => {
    timeout = window.setTimeout(() => resolve({ kind: 'queued' }), CLOUD_ACK_WAIT_MS);
  });
  const outcome = await Promise.race([tracked, delayed]);
  if (timeout !== undefined) window.clearTimeout(timeout);
  if (outcome.kind === 'failed') throw outcome.cause;
}

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
  await waitForWriteWithoutBlockingOffline(setDoc(doc(db, 'couples', coupleId), {
    relationshipStartDate: date,
    updatedAt: serverTimestamp(),
  }, { merge: true }));
}

export async function savePartnerNickname(coupleId: string, targetUid: string, nickname: string) {
  const value = nickname.trim();
  if (!targetUid || value.length < 1 || value.length > 12) throw new Error('invalid-partner-nickname');
  await waitForWriteWithoutBlockingOffline(setDoc(doc(db, 'couples', coupleId), {
    nicknames: { [targetUid]: value },
    updatedAt: serverTimestamp(),
  }, { merge: true }));
}
