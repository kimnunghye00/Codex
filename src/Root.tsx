import { lazy, Suspense, useEffect, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth } from './lib/firebaseAuth';
import { loadProfile, saveProfile, type UserProfile } from './utils/profile';
import './route-performance-v27.css';

const App = lazy(() => import('./App'));
const AuthFlow = lazy(() => import('./components/auth/AuthFlow').then((module) => ({ default: module.AuthFlow })));
const ProfileSetup = lazy(() => import('./components/auth/ProfileSetup').then((module) => ({ default: module.ProfileSetup })));

const SIGNUP_PENDING_KEY = 'meluni-signup-pending';
const initialUser = auth.currentUser;
const initialProfile = initialUser ? loadProfile(initialUser.uid) : null;

function RouteLoading() {
  return <div className="app-shell auth-loading !mx-auto !grid !min-h-dvh !w-full !max-w-none place-items-center" role="status" aria-live="polite"><div className="wordmark"><strong>ROUTE.</strong></div><div className="loading-mark" /><p>ROUTE를 불러오는 중이에요</p></div>;
}

function ResponsiveAppFrame({ children }: { children: React.ReactNode }) {
  return <div className="route-responsive-root min-h-dvh w-full min-w-0 overflow-x-hidden bg-[var(--background)] [&_.app-shell]:!m-0 [&_.app-shell]:!min-h-dvh [&_.app-shell]:!w-full [&_.app-shell]:!max-w-none [&_.app-shell]:!overflow-x-hidden [&_.page]:!min-w-0 [&_.page]:!max-w-none lg:[&_.page]:!mx-auto lg:[&_.page]:!w-[min(1480px,calc(100vw-64px))] lg:[&_.page]:!px-0 lg:[&_.chat-page]:!w-[min(1180px,calc(100vw-96px))]">
    {children}
  </div>;
}

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

    const expectedUid = nextUser.uid;
    setReady(false);
    // Cloud profile recovery needs Firestore, but only accounts without a local
    // profile need it. Keep coupleData outside the normal returning-user path.
    void import('./lib/coupleData')
      .then(({ loadCloudProfile }) => loadCloudProfile(expectedUid))
      .then((cloud) => {
        if (auth.currentUser?.uid !== expectedUid) return;
        if (cloud) {
          saveProfile(expectedUid, cloud);
          setProfile(cloud);
          localStorage.removeItem(SIGNUP_PENDING_KEY);
        } else {
          setProfile(null);
        }
      })
      .catch(() => {
        if (auth.currentUser?.uid === expectedUid) setProfile(null);
      })
      .finally(() => {
        if (auth.currentUser?.uid === expectedUid) setReady(true);
      });
  }), []);

  const signupPending = localStorage.getItem(SIGNUP_PENDING_KEY) === '1';

  if (!ready) return <RouteLoading />;
  if (!user) return <Suspense fallback={<RouteLoading />}><AuthFlow /></Suspense>;
  if (signupPending && !profile) return <Suspense fallback={<RouteLoading />}><AuthFlow /></Suspense>;

  if (!profile) {
    return <Suspense fallback={<RouteLoading />}><ProfileSetup user={user} onComplete={(nextProfile) => setProfile(nextProfile)} /></Suspense>;
  }

  return <ResponsiveAppFrame><Suspense fallback={<RouteLoading />}><App user={user} profile={profile} onProfileChange={setProfile} /></Suspense></ResponsiveAppFrame>;
}
