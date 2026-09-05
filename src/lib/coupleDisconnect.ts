import { deleteField, doc, runTransaction, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';

export async function disconnectCouple(uid: string, coupleId: string, partnerUid: string) {
  if (!uid || !coupleId || !partnerUid) throw new Error('invalid-connection');

  const userRef = doc(db, 'users', uid);
  const coupleRef = doc(db, 'couples', coupleId);

  await runTransaction(db, async (transaction) => {
    const userSnap = await transaction.get(userRef);
    const coupleSnap = await transaction.get(coupleRef);
    if (!userSnap.exists() || !coupleSnap.exists()) throw new Error('connection-missing');

    const userData = userSnap.data();
    const coupleData = coupleSnap.data();
    const memberUids = Array.isArray(coupleData.memberUids) ? coupleData.memberUids.map(String) : [];

    if (String(userData.coupleId ?? '') !== coupleId || String(userData.partnerUid ?? '') !== partnerUid) {
      throw new Error('connection-changed');
    }
    if (!memberUids.includes(uid) || !memberUids.includes(partnerUid) || memberUids.length !== 2) {
      throw new Error('connection-changed');
    }

    // Keep the old shared records in Firestore, but revoke both members' access to the
    // shared couple space immediately. This avoids silently destroying history while
    // making the disconnect effective for both accounts.
    transaction.update(coupleRef, {
      status: 'disconnected',
      memberUids: [],
      disconnectedBy: uid,
      disconnectedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    // A signed-in user is allowed to update only their own users/{uid} document.
    // The partner's stale coupleId is harmless because the couple no longer has members;
    // their next connection check will resolve to disconnected as well.
    transaction.update(userRef, {
      coupleId: deleteField(),
      partnerUid: deleteField(),
      lastDisconnectedCoupleId: coupleId,
      disconnectedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  });
}
