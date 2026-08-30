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

export type LocalAiPartner = {
  connected: boolean;
  uid: string;
  displayName: string;
  connectedAt: string;
  cloudSynced: boolean;
};

export const AI_TEST_PARTNER_UID = 'meluni-ai-test-partner';
export const AI_TEST_PARTNER_NAME = '멜루니';

const localAiKey = (uid: string) => `meluni-ai-partner:${uid}`;

function withTimeout<T>(promise: Promise<T>, ms = 5000): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => window.setTimeout(() => reject(new Error('firestore-timeout')), ms)),
  ]);
}

export function connectLocalAiPartner(uid: string): LocalAiPartner {
  const existing = loadLocalAiPartner(uid);
  if (existing?.connected) return existing;
  const next: LocalAiPartner = {
    connected: true,
    uid: AI_TEST_PARTNER_UID,
    displayName: AI_TEST_PARTNER_NAME,
    connectedAt: new Date().toISOString(),
    cloudSynced: false,
  };
  localStorage.setItem(localAiKey(uid), JSON.stringify(next));
  return next;
}

export function loadLocalAiPartner(uid: string): LocalAiPartner | null {
  try {
    const raw = localStorage.getItem(localAiKey(uid));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LocalAiPartner;
    return parsed?.connected ? parsed : null;
  } catch {
    return null;
  }
}

function markLocalAiCloudSynced(uid: string) {
  const current = loadLocalAiPartner(uid);
  if (!current) return;
  localStorage.setItem(localAiKey(uid), JSON.stringify({ ...current, cloudSynced: true }));
}

export async function syncUserProfile(uid: string, profile: UserProfile) {
  await withTimeout(setDoc(doc(db, 'users', uid), {
    uid,
    profile,
    updatedAt: serverTimestamp(),
  }, { merge: true }));
}

export async function loadCloudProfile(uid: string): Promise<UserProfile | null> {
  const snapshot = await withTimeout(getDoc(doc(db, 'users', uid)));
  if (!snapshot.exists()) return null;
  const profile = snapshot.data()?.profile as UserProfile | undefined;
  return profile?.name && profile?.birthDate && profile?.gender ? profile : null;
}

export async function connectAiTestPartner(uid: string, displayName: string) {
  // Firestore 상태와 무관하게 테스트 파트너는 즉시 로컬에 연결한다.
  const localPartner = connectLocalAiPartner(uid);
  const coupleId = `test-${uid}`;
  const coupleRef = doc(db, 'couples', coupleId);

  try {
    await withTimeout(setDoc(doc(db, 'users', AI_TEST_PARTNER_UID), {
      uid: AI_TEST_PARTNER_UID,
      profile: {
        name: AI_TEST_PARTNER_NAME,
        nickname: AI_TEST_PARTNER_NAME,
        gender: 'other',
        birthDate: '2026-01-01',
        completedAt: new Date().toISOString(),
      },
      testAccount: true,
      updatedAt: serverTimestamp(),
    }, { merge: true }));

    await withTimeout(setDoc(coupleRef, {
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
    }, { merge: true }));

    await withTimeout(setDoc(doc(db, 'users', uid), {
      coupleId,
      testPartnerUid: AI_TEST_PARTNER_UID,
      updatedAt: serverTimestamp(),
    }, { merge: true }));

    markLocalAiCloudSynced(uid);
    return { coupleId, localPartner: { ...localPartner, cloudSynced: true }, cloudSynced: true };
  } catch (error) {
    console.warn('[MELUNI Firestore AI partner sync]', error);
    return { coupleId, localPartner, cloudSynced: false };
  }
}

export async function getCoupleId(uid: string): Promise<string | null> {
  const snapshot = await withTimeout(getDoc(doc(db, 'users', uid)));
  if (!snapshot.exists()) return null;
  return String(snapshot.data()?.coupleId ?? '') || null;
}
