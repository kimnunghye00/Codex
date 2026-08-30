import { collection, doc, getDoc, runTransaction, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from './firebase';
import { loadProfile, type UserProfile } from '../utils/profile';

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

function sameProfile(a: unknown, b: UserProfile) {
  try { return JSON.stringify(a ?? null) === JSON.stringify(b); } catch { return false; }
}

export async function getRealCoupleConnection(uid: string): Promise<RealCoupleConnection | null> {
  const userRef = doc(db, 'users', uid);
  const userSnap = await getDoc(userRef);
  if (!userSnap.exists()) return null;

  const userData = userSnap.data();
  const localProfile = loadProfile(uid);
  if (localProfile && !sameProfile(userData?.profile, localProfile)) {
    await setDoc(userRef, { uid, profile: localProfile, updatedAt: serverTimestamp() }, { merge: true });
  }

  const coupleId = String(userData?.coupleId ?? '');
  const expectedPartnerUid = String(userData?.partnerUid ?? '');
  if (!coupleId || !expectedPartnerUid || isTestCouple(coupleId)) return null;

  const coupleSnap = await getDoc(doc(db, 'couples', coupleId));
  if (!coupleSnap.exists() || coupleSnap.data()?.testMode) return null;

  const coupleData = coupleSnap.data();
  const memberUids = (coupleData?.memberUids ?? []) as string[];
  if (memberUids.length !== 2 || !memberUids.includes(uid) || !memberUids.includes(expectedPartnerUid)) return null;

  const partnerUid = memberUids.find((memberUid) => memberUid !== uid);
  if (!partnerUid || partnerUid !== expectedPartnerUid) return null;

  try {
    const partnerSnap = await getDoc(doc(db, 'users', partnerUid));
    if (!partnerSnap.exists()) return null;
    const partnerData = partnerSnap.data();
    if (String(partnerData?.coupleId ?? '') !== coupleId) return null;
    if (String(partnerData?.partnerUid ?? '') !== uid) return null;

    const cloudProfile = (partnerData?.profile as UserProfile | undefined) ?? null;
    const fallbackName = String(coupleData?.members?.[partnerUid]?.displayName ?? '').trim();
    const sharedNickname = String(coupleData?.nicknames?.[partnerUid] ?? '').trim();
    const partnerProfile: UserProfile | null = cloudProfile
      ? { ...cloudProfile, nickname: sharedNickname || cloudProfile.nickname }
      : fallbackName
        ? { name: fallbackName, birthDate: '', gender: 'other', completedAt: '', nickname: sharedNickname || undefined }
        : null;

    return { coupleId, partnerUid, partnerProfile };
  } catch {
    return null;
  }
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

export async function connectWithInviteCode(uid: string, displayName: string, rawCode: string) {
  const existing = await getRealCoupleConnection(uid);
  if (existing) throw new Error('already-connected');

  const code = normalizeCode(rawCode);
  if (!/^ROUTE-[A-Z2-9]{6}$/.test(code)) throw new Error('invalid-code');
  const inviteRef = doc(db, 'coupleInvites', code);

  return runTransaction(db, async (transaction) => {
    const inviteSnap = await transaction.get(inviteRef);
    if (!inviteSnap.exists()) throw new Error('invite-not-found');
    const invite = inviteSnap.data();
    if (invite.status !== 'open') throw new Error(invite.status === 'requested' ? 'invite-pending' : 'invite-used');
    if (Number(invite.expiresAt ?? 0) < Date.now()) throw new Error('invite-expired');
    const ownerUid = String(invite.ownerUid ?? '');
    if (!ownerUid || ownerUid === uid) throw new Error('self-invite');

    transaction.update(inviteRef, {
      status: 'requested',
      joinerUid: uid,
      joinerName: displayName,
      requestedAt: serverTimestamp(),
    });
    return { code, ownerUid, ownerName: String(invite.ownerName ?? '상대방') };
  });
}

export async function finalizeInviteAsOwner(uid: string, ownerName: string, rawCode: string): Promise<RealCoupleConnection | null> {
  const existing = await getRealCoupleConnection(uid);
  if (existing) return existing;

  const code = normalizeCode(rawCode);
  if (!/^ROUTE-[A-Z2-9]{6}$/.test(code)) return null;
  const inviteRef = doc(db, 'coupleInvites', code);
  const ownerUserRef = doc(db, 'users', uid);

  const result = await runTransaction(db, async (transaction) => {
    const inviteSnap = await transaction.get(inviteRef);
    if (!inviteSnap.exists()) return null;
    const invite = inviteSnap.data();
    if (String(invite.ownerUid ?? '') !== uid) return null;

    if (invite.status === 'accepted') return { coupleId: String(invite.coupleId ?? ''), partnerUid: String(invite.joinerUid ?? '') };
    if (invite.status !== 'requested') return null;

    const joinerUid = String(invite.joinerUid ?? '');
    const joinerName = String(invite.joinerName ?? '상대방');
    if (!joinerUid || joinerUid === uid) return null;

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
      status: 'pending-joiner',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    transaction.set(ownerUserRef, { coupleId, partnerUid: joinerUid, updatedAt: serverTimestamp() }, { merge: true });
    transaction.update(inviteRef, { status: 'accepted', coupleId, acceptedAt: serverTimestamp() });
    return { coupleId, partnerUid: joinerUid };
  });

  if (!result?.coupleId || !result.partnerUid) return null;
  return null;
}

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

  await setDoc(doc(db, 'users', uid), { coupleId, partnerUid, updatedAt: serverTimestamp() }, { merge: true });
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
