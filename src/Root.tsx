import { lazy, Suspense, useEffect, useState } from 'react';
import { onAuthStateChanged, signOut, type User } from 'firebase/auth';
import { auth } from './lib/firebaseAuth';
import { loadProfile, saveProfile, type UserProfile } from './utils/profile';
import { ResponsiveAppFrame } from './components/layout/ResponsiveAppFrame';
import './route-performance-v27.css';

const App = lazy(() => import('./App'));
const AuthFlow = lazy(() => Promise.all([
  import('./styles/features/auth'),
  import('./components/auth/AuthFlow'),
]).then(([, module]) => ({ default: module.AuthFlow })));
const ProfileSetup = lazy(() => import('./components/auth/ProfileSetup').then((module) => ({ default: module.ProfileSetup })));

const SIGNUP_PENDING_KEY = 'meluni-signup-pending';
const initialUser = auth.currentUser;
const initialProfile = initialUser ? loadProfile(initialUser.uid) : null;

function RouteLoading() {
  return <div className="app-shell auth-loading !mx-auto !grid !min-h-dvh !w-full !max-w-none place-items-center" role="status" aria-live="polite"><div className="wordmark"><strong>단둘이</strong></div><div className="loading-mark" /><p>단둘이를 불러오는 중이에요</p></div>;
}

function readSignupPending() {
  try { return localStorage.getItem(SIGNUP_PENDING_KEY) === '1'; }
  catch { return false; }
}

function clearSignupPending() {
  try { localStorage.removeItem(SIGNUP_PENDING_KEY); }
  catch { /* A blocked cache must not hide a recovered cloud profile. */ }
}

function RouteProfileRecovery({ onRetry, onSignOut, signOutError }: {
  onRetry: () => void;
  onSignOut: () => void;
  signOutError: string;
}) {
  return <main className="app-shell profile-recovery" role="alert">
    <div className="wordmark"><strong>단둘이</strong></div>
    <section className="profile-recovery-card">
      <h1>프로필을 불러오지 못했어요</h1>
      <p>연결을 확인한 뒤 다시 시도해 주세요. 기존 프로필과 기록은 삭제되지 않았어요.</p>
      <button type="button" className="primary" onClick={onRetry}>다시 시도</button>
      <button type="button" className="secondary" onClick={onSignOut}>다른 계정으로 로그인</button>
      {signOutError && <p role="alert">{signOutError}</p>}
    </section>
  </main>;
}

export default function Root() {
  const [user, setUser] = useState<User | null>(initialUser);
  const [profile, setProfile] = useState<UserProfile | null>(initialProfile);
  // Firebase persistence is already awaited by main.tsx before Root mounts. A
  // returning user with a local profile therefore does not need a second blank
  // auth frame while onAuthStateChanged repeats the same state.
  const [ready, setReady] = useState(() => !initialUser || Boolean(initialProfile));
  const [profileLookupFailed, setProfileLookupFailed] = useState(false);
  const [signOutError, setSignOutError] = useState('');
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let disposed = false;
    const unsubscribe = onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      if (!nextUser) {
        setProfile(null);
        setProfileLookupFailed(false);
        setReady(true);
        return;
      }

      const local = loadProfile(nextUser.uid);
      if (local) {
        setProfile(local);
        setProfileLookupFailed(false);
        clearSignupPending();
        setReady(true);
        return;
      }

      const expectedUid = nextUser.uid;
      setReady(false);
      setProfileLookupFailed(false);
      // Cloud profile recovery needs Firestore, but only accounts without a local
      // profile need it. Keep coupleData outside the normal returning-user path.
      void import('./lib/coupleData')
        .then(({ loadCloudProfile }) => loadCloudProfile(expectedUid))
        .then((cloud) => {
          if (disposed || auth.currentUser?.uid !== expectedUid) return;
          if (cloud) {
            try { saveProfile(expectedUid, cloud); }
            catch (error) { console.warn('[DANDULI profile cache]', error); }
            setProfile(cloud);
            clearSignupPending();
          } else {
            setProfile(null);
          }
        })
        .catch((error) => {
          if (disposed || auth.currentUser?.uid !== expectedUid) return;
          console.warn('[DANDULI profile recovery]', error);
          // A network failure is not evidence that the account has no profile.
          setProfileLookupFailed(true);
        })
        .finally(() => {
          if (!disposed && auth.currentUser?.uid === expectedUid) setReady(true);
        });
    });
    return () => { disposed = true; unsubscribe(); };
  }, [retryKey]);

  useEffect(() => {
    if (!profileLookupFailed) return;
    const retryWhenOnline = () => setRetryKey((key) => key + 1);
    window.addEventListener('online', retryWhenOnline);
    return () => window.removeEventListener('online', retryWhenOnline);
  }, [profileLookupFailed]);

  const signupPending = readSignupPending();

  if (!ready) return <RouteLoading />;
  if (!user) return <Suspense fallback={<RouteLoading />}><AuthFlow /></Suspense>;
  if (profileLookupFailed) return <RouteProfileRecovery
    onRetry={() => { setSignOutError(''); setRetryKey((key) => key + 1); }}
    onSignOut={() => void signOut(auth).catch((error) => {
      console.warn('[DANDULI sign out]', error);
      setSignOutError('로그아웃하지 못했어요. 연결을 확인한 뒤 다시 시도해 주세요.');
    })}
    signOutError={signOutError}
  />;
  if (signupPending && !profile) return <Suspense fallback={<RouteLoading />}><AuthFlow /></Suspense>;

  if (!profile) {
    return <Suspense fallback={<RouteLoading />}><ProfileSetup key={user.uid} user={user} onComplete={(nextProfile) => setProfile(nextProfile)} /></Suspense>;
  }

  return <ResponsiveAppFrame><Suspense fallback={<RouteLoading />}><App user={user} profile={profile} onProfileChange={setProfile} /></Suspense></ResponsiveAppFrame>;
}
