import { useEffect, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import App from './App';
import { AuthFlow, SIGNUP_PENDING_KEY } from './components/auth/AuthFlow';
import { auth } from './lib/firebase';

export default function Root() {
  const [user, setUser] = useState<User | null>(auth.currentUser);
  const [ready, setReady] = useState(false);

  useEffect(() => onAuthStateChanged(auth, (nextUser) => {
    setUser(nextUser);
    setReady(true);
  }), []);

  const signupPending = localStorage.getItem(SIGNUP_PENDING_KEY) === '1';

  if (!ready) return null;
  if (user && signupPending) return <AuthFlow />;
  return <App />;
}
