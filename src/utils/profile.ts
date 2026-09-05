import { signalPersistentStateChange } from './persistenceSignal';

export type Gender = 'male' | 'female' | 'other';
export type NicknameSetBy = 'partner' | 'self';

export type UserProfile = {
  name: string;
  birthDate: string;
  gender: Gender;
  photoDataUrl?: string;
  nickname?: string;
  nicknameSetBy?: NicknameSetBy;
  nicknameChangedAt?: string;
  selfNicknameChangedAt?: string;
  completedAt: string;
};

const profileKey = (uid: string) => `meluni-profile:${uid}`;
const NICKNAME_CHANGE_DAYS = 30;

export function loadProfile(uid: string): UserProfile | null {
  try {
    const raw = localStorage.getItem(profileKey(uid));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as UserProfile;
    return parsed?.name && parsed?.birthDate && parsed?.gender ? parsed : null;
  } catch {
    return null;
  }
}

export function saveProfile(uid: string, profile: UserProfile) {
  localStorage.setItem(profileKey(uid), JSON.stringify(profile));
  signalPersistentStateChange();
}

export function calculateAge(birthDate: string, today = new Date()) {
  const birth = new Date(`${birthDate}T00:00:00`);
  if (Number.isNaN(birth.getTime())) return 0;
  let age = today.getFullYear() - birth.getFullYear();
  const birthdayPassed = today.getMonth() > birth.getMonth()
    || (today.getMonth() === birth.getMonth() && today.getDate() >= birth.getDate());
  if (!birthdayPassed) age -= 1;
  return Math.max(0, age);
}

export function displayName(profile: UserProfile) {
  return profile.nickname?.trim() || profile.name;
}

export function nicknameChangeState(profile: UserProfile, now = new Date()) {
  if (!profile.selfNicknameChangedAt) return { canChange: true, daysLeft: 0, nextDate: null as Date | null };
  const last = new Date(profile.selfNicknameChangedAt);
  if (Number.isNaN(last.getTime())) return { canChange: true, daysLeft: 0, nextDate: null as Date | null };
  const nextDate = new Date(last.getTime() + NICKNAME_CHANGE_DAYS * 86_400_000);
  const diff = nextDate.getTime() - now.getTime();
  if (diff <= 0) return { canChange: true, daysLeft: 0, nextDate };
  return { canChange: false, daysLeft: Math.ceil(diff / 86_400_000), nextDate };
}

export function setSelfNickname(profile: UserProfile, nickname: string, now = new Date()): UserProfile {
  const state = nicknameChangeState(profile, now);
  if (!state.canChange) throw new Error('nickname-change-locked');
  const timestamp = now.toISOString();
  return {
    ...profile,
    nickname: nickname.trim(),
    nicknameSetBy: 'self',
    nicknameChangedAt: timestamp,
    selfNicknameChangedAt: timestamp,
  };
}

// 커플 연결 기능이 추가되면 상대방 계정에서 이 함수를 호출해 별명을 지정한다.
// 상대방이 지어주는 별명은 사용자의 월 1회 직접 변경 횟수를 소모하지 않는다.
export function setPartnerNickname(profile: UserProfile, nickname: string, now = new Date()): UserProfile {
  return {
    ...profile,
    nickname: nickname.trim(),
    nicknameSetBy: 'partner',
    nicknameChangedAt: now.toISOString(),
  };
}
