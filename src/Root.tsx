import { useEffect, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import App from './App';
import { AuthFlow, SIGNUP_PENDING_KEY } from './components/auth/AuthFlow';
import { ProfileSetup } from './components/auth/ProfileSetup';
import { auth } from './lib/firebase';
import { loadCloudProfile } from './lib/coupleData';
import { loadProfile, saveProfile, type UserProfile } from './utils/profile';

export default function Root() {
  const [user, setUser] = useState<User | null>(auth.currentUser);
  const [profile, setProfile] = useState<UserProfile | null>(() => auth.currentUser ? loadProfile(auth.currentUser.uid) : null);
  const [ready, setReady] = useState(false);

  useEffect(() => onAuthStateChanged(auth, (nextUser) => {
    setReady(false);
    setUser(nextUser);
    if (!nextUser) {
      setProfile(null);
      setReady(true);
      return;
    }

    const local = loadProfile(nextUser.uid);
    if (local) {
      setProfile(local);
      localStorage.removeItem(SIGNUP_PENDING_KEY);
      setReady(true);
      return;
    }

    void loadCloudProfile(nextUser.uid)
      .then((cloud) => {
        if (cloud) {
          saveProfile(nextUser.uid, cloud);
          setProfile(cloud);
          localStorage.removeItem(SIGNUP_PENDING_KEY);
        } else {
          setProfile(null);
        }
      })
      .catch(() => setProfile(null))
      .finally(() => setReady(true));
  }), []);

  const signupPending = localStorage.getItem(SIGNUP_PENDING_KEY) === '1';

  if (!ready) return null;
  if (user && signupPending && !profile) return <AuthFlow />;
  if (!user) return <App />;

  // 기존 가입자는 Firestore에 저장된 프로필을 복원하므로 다시 프로필 설정을 하지 않습니다.
  // 실제로 프로필이 한 번도 생성되지 않은 신규 가입자만 이 화면을 거칩니다.
  if (!profile) {
    return <ProfileSetup user={user} onComplete={(nextProfile) => setProfile(nextProfile)} />;
  }

  return <App />;
}
