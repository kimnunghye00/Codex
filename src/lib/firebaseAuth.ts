import { browserLocalPersistence, getAuth, setPersistence } from 'firebase/auth';
import { firebaseApp } from './firebaseCore';

export const auth = getAuth(firebaseApp);

// Auth persistence is part of the critical startup path. Firestore is kept in a
// separate module so a returning user can restore the session before database
// listeners and cache initialization are needed.
export const authPersistenceReady = setPersistence(auth, browserLocalPersistence).catch((cause) => {
  console.warn('[ROUTE auth persistence]', cause);
});

auth.languageCode = 'ko';
