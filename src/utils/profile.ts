export type Gender = 'male' | 'female' | 'other';

export type UserProfile = {
  name: string;
  birthDate: string;
  gender: Gender;
  photoDataUrl?: string;
  completedAt: string;
};

const profileKey = (uid: string) => `meluni-profile:${uid}`;

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
