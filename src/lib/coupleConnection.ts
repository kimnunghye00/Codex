import { collection, doc, getDoc, runTransaction, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from './firebase';
import type { UserProfile } from '../utils/profile';

export type RealCoupleConnection = {
  coupleId: string;
  partnerUid: string;
  partnerProfile: UserProfile | null;
};

export type CoupleInvite = {
  code: string;
  ownerUid: string;
  ownerName: string;
  expiresAt: number;
};

const INVITE_TTL = 7 * 24 * 60 * 60 * 1000;
const isTestCouple = (coupleId?: string) => Boolean(coupleId?.startsWith('test-'));

function normalizeCode(code: string) {
  return code.trim().toUpperCase().replace(/\s+/g, '');
}

function makeCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let value = 'ROUTE-';
  for (let i = 0; i < 6; i += 1) value += chars[Math.floor(Math.random() * chars.length)];
  return value;
}

export async function getRealCoupleConnection(uid: string): Promise<RealCoupleConnection | null> {
  const userSnap = await getDoc(doc(db, 'users', uid));
  if (!userSnap.exists()) return null;
  const coupleId = String(userSnap.data()?.coupleId ?? '');
  if (!coupleId || isTestCouple(coupleId)) return null;

  const coupleSnap = await getDoc(doc(db, 'couples', coupleId));
  if (!coupleSnap.exists() || coupleSnap.data()?.testMode) return null;
  const memberUids = (coupleSnap.data()?.memberUids ?? []) as string[];
  const partnerUid = memberUids.find((memberUid) => memberUid !== uid);
  if (!partnerUid) return null;

  const partnerSnap = await getDoc(doc(db, 'users', partnerUid));
  const partnerProfile = partnerSnap.exists() ? (partnerSnap.data()?.profile as UserProfile | undefined) ?? null : null;
  return { coupleId, partnerUid, partnerProfile };
}

export async function createCoupleInvite(uid: string, ownerName: string): Promise<CoupleInvite> {
  const existing = await getRealCoupleConnection(uid);
  if (existing) throw new Error('already-connected');

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = makeCode();
    const inviteRef = doc(db, 'coupleInvites', code);
    const expiresAt = Date.now() + INVITE_TTL;
    try {
      await runTransaction(db, async (transaction) => {
        const snapshot = await transaction.get(inviteRef);
        if (snapshot.exists()) throw new Error('code-collision');
        transaction.set(inviteRef, {
          code,
          ownerUid: uid,
          ownerName,
          status: 'open',
          expiresAt,
          createdAt: serverTimestamp(),
        });
      });
      return { code, ownerUid: uid, ownerName, expiresAt };
    } catch (error) {
      if (error instanceof Error && error.message === 'code-collision') continue;
      throw error;
    }
  }
  throw new Error('invite-create-failed');
}

// 초대받은 사람은 커플을 직접 만들지 않고, 초대 문서에 연결 요청만 남깁니다.
// 따라서 다른 사용자의 users 문서를 건드리지 않습니다.
export async function connectWithInviteCode(uid: string, displayName: string, rawCode: string) {
  const code = normalizeCode(rawCode);
  if (!/^ROUTE-[A-Z2-9]{6}$/.test(code)) throw new Error('invalid-code');

  const inviteRef = doc(db, 'coupleInvites', code);
  const currentUserRef = doc(db, 'users', uid);

  return runTransaction(db, async (transaction) => {
    const inviteSnap = await transaction.get(inviteRef);
    if (!inviteSnap.exists()) throw new Error('invite-not-found');
    const invite = inviteSnap.data();
    if (invite.status !== 'open') throw new Error(invite.status === 'requested' ? 'invite-pending' : 'invite-used');
    if (Number(invite.expiresAt ?? 0) < Date.now()) throw new Error('invite-expired');

    const ownerUid = String(invite.ownerUid ?? '');
    if (!ownerUid || ownerUid === uid) throw new Error('self-invite');

    const currentSnap = await transaction.get(currentUserRef);
    const currentCoupleId = String(currentSnap.data()?.coupleId ?? '');
    if (currentCoupleId && !isTestCouple(currentCoupleId)) throw new Error('already-connected');

    transaction.update(inviteRef, {
      status: 'requested',
      joinerUid: uid,
      joinerName: displayName,
      requestedAt: serverTimestamp(),
    });

    return { code, ownerUid, ownerName: String(invite.ownerName ?? '상대방') };
  });
}

// 초대한 사람만 자기 권한으로 커플 문서를 만들고 자기 users 문서를 갱신합니다.
export async function finalizeInviteAsOwner(uid: string, ownerName: string, rawCode: string): Promise<RealCoupleConnection | null> {
  const code = normalizeCode(rawCode);
  if (!/^ROUTE-[A-Z2-9]{6}$/.test(code)) return null;

  const inviteRef = doc(db, 'coupleInvites', code);
  const ownerUserRef = doc(db, 'users', uid);

  const result = await runTransaction(db, async (transaction) => {
    const inviteSnap = await transaction.get(inviteRef);
    if (!inviteSnap.exists()) return null;
    const invite = inviteSnap.data();
    if (String(invite.ownerUid ?? '') !== uid) return null;

    if (invite.status === 'accepted') {
      return {
        coupleId: String(invite.coupleId ?? ''),
        partnerUid: String(invite.joinerUid ?? ''),
      };
    }
    if (invite.status !== 'requested') return null;

    const joinerUid = String(invite.joinerUid ?? '');
    const joinerName = String(invite.joinerName ?? '상대방');
    if (!joinerUid || joinerUid === uid) return null;

    const ownerSnap = await transaction.get(ownerUserRef);
    const ownerCoupleId = String(ownerSnap.data()?.coupleId ?? '');
    if (ownerCoupleId && !isTestCouple(ownerCoupleId)) throw new Error('already-connected');

    const coupleRef = doc(collection(db, 'couples'));
    const coupleId = coupleRef.id;

    transaction.set(coupleRef, {
      id: coupleId,
      memberUids: [uid, joinerUid],
      members: {
        [uid]: { uid, role: 'user', displayName: ownerName },
        [joinerUid]: { uid: joinerUid, role: 'user', displayName: joinerName },
      },
      createdBy: uid,
      testMode: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    transaction.set(ownerUserRef, {
      coupleId,
      partnerUid: joinerUid,
      updatedAt: serverTimestamp(),
    }, { merge: true });

    transaction.update(inviteRef, {
      status: 'accepted',
      coupleId,
      acceptedAt: serverTimestamp(),
    });

    return { coupleId, partnerUid: joinerUid };
  });

  if (!result?.coupleId || !result.partnerUid) return null;
  return getRealCoupleConnection(uid);
}

// 초대받은 사람은 초대가 승인된 뒤 자기 users 문서만 갱신합니다.
export async function completeJoinerConnection(uid: string, rawCode: string): Promise<RealCoupleConnection | null> {
  const code = normalizeCode(rawCode);
  if (!/^ROUTE-[A-Z2-9]{6}$/.test(code)) return null;

  const inviteSnap = await getDoc(doc(db, 'coupleInvites', code));
  if (!inviteSnap.exists()) return null;
  const invite = inviteSnap.data();
  if (invite.status !== 'accepted' || String(invite.joinerUid ?? '') !== uid) return null;

  const coupleId = String(invite.coupleId ?? '');
  const partnerUid = String(invite.ownerUid ?? '');
  if (!coupleId || !partnerUid) return null;

  await setDoc(doc(db, 'users', uid), {
    coupleId,
    partnerUid,
    updatedAt: serverTimestamp(),
  }, { merge: true });

  return getRealCoupleConnection(uid);
}

export async function refreshInvite(code: string): Promise<CoupleInvite | null> {
  const normalized = normalizeCode(code);
  const snap = await getDoc(doc(db, 'coupleInvites', normalized));
  if (!snap.exists()) return null;
  const data = snap.data();
  if (data.status !== 'open' || Number(data.expiresAt ?? 0) < Date.now()) return null;
  return {
    code: normalized,
    ownerUid: String(data.ownerUid ?? ''),
    ownerName: String(data.ownerName ?? ''),
    expiresAt: Number(data.expiresAt ?? 0),
  };
}
