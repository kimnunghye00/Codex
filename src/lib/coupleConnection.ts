import { collection, doc, getDoc, onSnapshot, runTransaction, serverTimestamp, setDoc } from 'firebase/firestore';
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

export type CoupleInviteState = CoupleInvite & {
  status: string;
  joinerUid?: string;
  joinerName?: string;
  coupleId?: string;
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

function partnerProfileFromData(coupleData: Record<string, any>, partnerUid: string, partnerData: Record<string, any>): UserProfile | null {
  const cloudProfile = (partnerData?.profile as UserProfile | undefined) ?? null;
  const fallbackName = String(coupleData?.members?.[partnerUid]?.displayName ?? '').trim();
  const sharedNickname = String(coupleData?.nicknames?.[partnerUid] ?? '').trim();
  if (cloudProfile) return { ...cloudProfile, nickname: sharedNickname || cloudProfile.nickname };
  if (!fallbackName) return null;
  return { name: fallbackName, birthDate: '', gender: 'other', completedAt: '', nickname: sharedNickname || undefined };
}

function connectionFromData(
  uid: string,
  coupleId: string,
  expectedPartnerUid: string,
  coupleData: Record<string, any>,
  partnerData: Record<string, any>,
): RealCoupleConnection | null {
  if (coupleData?.testMode) return null;
  const memberUids = (coupleData?.memberUids ?? []) as string[];
  if (memberUids.length !== 2 || !memberUids.includes(uid) || !memberUids.includes(expectedPartnerUid)) return null;

  const partnerUid = memberUids.find((memberUid) => memberUid !== uid);
  if (!partnerUid || partnerUid !== expectedPartnerUid) return null;
  if (String(partnerData?.coupleId ?? '') !== coupleId) return null;
  if (String(partnerData?.partnerUid ?? '') !== uid) return null;

  return {
    coupleId,
    partnerUid,
    partnerProfile: partnerProfileFromData(coupleData, partnerUid, partnerData),
  };
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

  const [coupleSnap, partnerSnap] = await Promise.all([
    getDoc(doc(db, 'couples', coupleId)),
    getDoc(doc(db, 'users', expectedPartnerUid)),
  ]);
  if (!coupleSnap.exists() || !partnerSnap.exists()) return null;
  return connectionFromData(uid, coupleId, expectedPartnerUid, coupleSnap.data(), partnerSnap.data());
}

export function subscribeRealCoupleConnection(
  uid: string,
  onChange: (connection: RealCoupleConnection | null) => void,
  onError: (error: unknown) => void = () => undefined,
) {
  let activePair = '';
  let generation = 0;
  let unsubscribeCouple: () => void = () => {};
  let unsubscribePartner: () => void = () => {};

  const clearNested = () => {
    generation += 1;
    unsubscribeCouple();
    unsubscribePartner();
    unsubscribeCouple = () => {};
    unsubscribePartner = () => {};
    activePair = '';
  };

  const userRef = doc(db, 'users', uid);
  const unsubscribeUser = onSnapshot(userRef, (userSnap) => {
    if (!userSnap.exists()) {
      clearNested();
      onChange(null);
      return;
    }

    const userData = userSnap.data();
    const localProfile = loadProfile(uid);
    if (localProfile && !sameProfile(userData?.profile, localProfile)) {
      void setDoc(userRef, { uid, profile: localProfile, updatedAt: serverTimestamp() }, { merge: true }).catch(onError);
    }

    const coupleId = String(userData?.coupleId ?? '');
    const partnerUid = String(userData?.partnerUid ?? '');
    if (!coupleId || !partnerUid || isTestCouple(coupleId)) {
      clearNested();
      onChange(null);
      return;
    }

    const pair = `${coupleId}:${partnerUid}`;
    if (pair === activePair) return;

    clearNested();
    activePair = pair;
    const currentGeneration = generation;
    let coupleReady = false;
    let partnerReady = false;
    let coupleData: Record<string, any> | null = null;
    let partnerData: Record<string, any> | null = null;

    const emit = () => {
      if (currentGeneration !== generation || !coupleReady || !partnerReady) return;
      if (!coupleData || !partnerData) {
        onChange(null);
        return;
      }
      onChange(connectionFromData(uid, coupleId, partnerUid, coupleData, partnerData));
    };

    unsubscribeCouple = onSnapshot(doc(db, 'couples', coupleId), (snapshot) => {
      if (currentGeneration !== generation) return;
      coupleReady = true;
      coupleData = snapshot.exists() ? snapshot.data() : null;
      emit();
    }, onError);

    unsubscribePartner = onSnapshot(doc(db, 'users', partnerUid), (snapshot) => {
      if (currentGeneration !== generation) return;
      partnerReady = true;
      partnerData = snapshot.exists() ? snapshot.data() : null;
      emit();
    }, onError);
  }, onError);

  return () => {
    unsubscribeUser();
    clearNested();
  };
}

export function subscribeCoupleInviteState(
  rawCode: string,
  onChange: (invite: CoupleInviteState | null) => void,
  onError: (error: unknown) => void = () => undefined,
) {
  const code = normalizeCode(rawCode);
  if (!/^ROUTE-[A-Z2-9]{6}$/.test(code)) {
    queueMicrotask(() => onChange(null));
    return () => {};
  }

  return onSnapshot(doc(db, 'coupleInvites', code), (snapshot) => {
    if (!snapshot.exists()) {
      onChange(null);
      return;
    }
    const data = snapshot.data();
    onChange({
      code,
      ownerUid: String(data.ownerUid ?? ''),
      ownerName: String(data.ownerName ?? ''),
      expiresAt: Number(data.expiresAt ?? 0),
      status: String(data.status ?? ''),
      joinerUid: data.joinerUid ? String(data.joinerUid) : undefined,
      joinerName: data.joinerName ? String(data.joinerName) : undefined,
      coupleId: data.coupleId ? String(data.coupleId) : undefined,
    });
  }, onError);
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

    if (invite.status === 'accepted') {
      return {
        coupleId: String(invite.coupleId ?? ''),
        partnerUid: String(invite.joinerUid ?? ''),
        partnerName: String(invite.joinerName ?? '상대방'),
      };
    }
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
    return { coupleId, partnerUid: joinerUid, partnerName: joinerName };
  });

  if (!result?.coupleId || !result.partnerUid) return null;
  return {
    coupleId: result.coupleId,
    partnerUid: result.partnerUid,
    partnerProfile: result.partnerName
      ? { name: result.partnerName, birthDate: '', gender: 'other', completedAt: '' }
      : null,
  };
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
