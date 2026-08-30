import { useEffect, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import App from './App';
import { AuthFlow, SIGNUP_PENDING_KEY } from './components/auth/AuthFlow';
import { ProfileSetup } from './components/auth/ProfileSetup';
import { auth } from './lib/firebase';
import { loadProfile, type UserProfile } from './utils/profile';

export default function Root() {
  const [user, setUser] = useState<User | null>(auth.currentUser);
  const [profile, setProfile] = useState<UserProfile | null>(() => auth.currentUser ? loadProfile(auth.currentUser.uid) : null);
  const [ready, setReady] = useState(false);

  useEffect(() => onAuthStateChanged(auth, (nextUser) => {
    setUser(nextUser);
    setProfile(nextUser ? loadProfile(nextUser.uid) : null);
    setReady(true);
  }), []);

  const signupPending = localStorage.getItem(SIGNUP_PENDING_KEY) === '1';

  if (!ready) return null;
  if (user && signupPending) return <AuthFlow />;
  if (!user) return <App />;

  // 회원가입 후 프로필까지만 필수로 완료합니다.
  // 상대방 연결은 메인 앱의 계정 설정에서 언제든 진행할 수 있습니다.
  if (!profile) {
    return <ProfileSetup user={user} onComplete={(nextProfile) => setProfile(nextProfile)} />;
  }

  return <App />;
}
