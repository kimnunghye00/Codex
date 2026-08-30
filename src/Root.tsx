import { useEffect, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import App from './App';
import { AuthFlow, SIGNUP_PENDING_KEY } from './components/auth/AuthFlow';
import { ProfileSetup } from './components/auth/ProfileSetup';
import { CoupleGate } from './components/couple/CoupleGate';
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

  // Onboarding order is enforced here so ProfileSetup completion cannot skip CoupleGate:
  // sign up/login -> profile -> couple connection -> main app.
  if (!profile) {
    return <ProfileSetup user={user} onComplete={(nextProfile) => setProfile(nextProfile)} />;
  }

  return <CoupleGate user={user}><App /></CoupleGate>;
}
