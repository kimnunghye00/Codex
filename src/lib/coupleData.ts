import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from './firebase';
import type { UserProfile } from '../utils/profile';

export type CoupleMember = {
  uid: string;
  role: 'user' | 'ai-test-partner';
  displayName: string;
};

export type CoupleRecord = {
  id: string;
  memberUids: string[];
  createdBy: string;
  testMode?: boolean;
};

export const AI_TEST_PARTNER_UID = 'meluni-ai-test-partner';
export const AI_TEST_PARTNER_NAME = 'MELUNI AI';

export async function syncUserProfile(uid: string, profile: UserProfile) {
  await setDoc(doc(db, 'users', uid), {
    uid,
    profile,
    updatedAt: serverTimestamp(),
  }, { merge: true });
}

export async function loadCloudProfile(uid: string): Promise<UserProfile | null> {
  const snapshot = await getDoc(doc(db, 'users', uid));
  if (!snapshot.exists()) return null;
  const profile = snapshot.data()?.profile as UserProfile | undefined;
  return profile?.name && profile?.birthDate && profile?.gender ? profile : null;
}

export async function connectAiTestPartner(uid: string, displayName: string) {
  const coupleId = `test-${uid}`;
  const coupleRef = doc(db, 'couples', coupleId);

  await setDoc(doc(db, 'users', AI_TEST_PARTNER_UID), {
    uid: AI_TEST_PARTNER_UID,
    profile: {
      name: AI_TEST_PARTNER_NAME,
      nickname: '멜루니',
      gender: 'other',
      birthDate: '2026-01-01',
      completedAt: new Date().toISOString(),
    },
    testAccount: true,
    updatedAt: serverTimestamp(),
  }, { merge: true });

  await setDoc(coupleRef, {
    id: coupleId,
    memberUids: [uid, AI_TEST_PARTNER_UID],
    members: {
      [uid]: { uid, role: 'user', displayName },
      [AI_TEST_PARTNER_UID]: { uid: AI_TEST_PARTNER_UID, role: 'ai-test-partner', displayName: AI_TEST_PARTNER_NAME },
    },
    createdBy: uid,
    testMode: true,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }, { merge: true });

  await setDoc(doc(db, 'users', uid), {
    coupleId,
    testPartnerUid: AI_TEST_PARTNER_UID,
    updatedAt: serverTimestamp(),
  }, { merge: true });

  return coupleId;
}

export async function getCoupleId(uid: string): Promise<string | null> {
  const snapshot = await getDoc(doc(db, 'users', uid));
  if (!snapshot.exists()) return null;
  return String(snapshot.data()?.coupleId ?? '') || null;
}
