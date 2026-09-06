import { lazy, Suspense, useEffect, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { AuthFlow, SIGNUP_PENDING_KEY, Wordmark } from './components/auth/AuthFlow';
import { ProfileSetup } from './components/auth/ProfileSetup';
import { auth } from './lib/firebase';
import { loadCloudProfile } from './lib/coupleData';
import { loadProfile, saveProfile, type UserProfile } from './utils/profile';

const App = lazy(() => import('./App'));

const initialUser = auth.currentUser;
const initialProfile = initialUser ? loadProfile(initialUser.uid) : null;

export default function Root() {
  const [user, setUser] = useState<User | null>(initialUser);
  const [profile, setProfile] = useState<UserProfile | null>(initialProfile);
  // Firebase persistence is already awaited by main.tsx before Root mounts. A
  // returning user with a local profile therefore does not need a second blank
  // auth frame while onAuthStateChanged repeats the same state.
  const [ready, setReady] = useState(() => !initialUser || Boolean(initialProfile));

  useEffect(() => onAuthStateChanged(auth, (nextUser) => {
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

    setReady(false);
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

  if (!profile) {
    return <ProfileSetup user={user} onComplete={(nextProfile) => setProfile(nextProfile)} />;
  }

  return <Suspense fallback={<div className="app-shell auth-loading" role="status" aria-live="polite"><Wordmark /><div className="loading-mark" /><p>ROUTE를 불러오는 중이에요</p></div>}><App /></Suspense>;
}
