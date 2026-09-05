import { initializeApp } from 'firebase/app';
import { browserLocalPersistence, getAuth, setPersistence } from 'firebase/auth';
import { initializeFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

const firebaseConfig = {
  apiKey: 'AIzaSyAHuK_VnRYMsGHRO9FrztR5KvCQouNZPGg',
  authDomain: 'meluni-f4e00.firebaseapp.com',
  projectId: 'meluni-f4e00',
  storageBucket: 'meluni-f4e00.firebasestorage.app',
  messagingSenderId: '630506014881',
  appId: '1:630506014881:web:856c3faddac2b4533a08e0',
};

export const firebaseApp = initializeApp(firebaseConfig);
export const auth = getAuth(firebaseApp);
export const db = initializeFirestore(firebaseApp, { ignoreUndefinedProperties: true });
export const storage = getStorage(firebaseApp);
export const authPersistenceReady = setPersistence(auth, browserLocalPersistence).catch((cause) => {
  console.warn('[ROUTE auth persistence]', cause);
});
auth.languageCode = 'ko';
