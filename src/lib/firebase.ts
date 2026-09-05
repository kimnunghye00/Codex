import { Capacitor } from '@capacitor/core';
import { initializeApp } from 'firebase/app';
import { browserLocalPersistence, getAuth, setPersistence } from 'firebase/auth';
import { clearIndexedDbPersistence, initializeFirestore, persistentLocalCache, terminate } from 'firebase/firestore';
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

// Capacitor runs the web Firebase SDK inside a private app WebView. Keep its
// Firestore cache across app restarts so previously loaded chats, schedules,
// locations and settings remain readable during a temporary network outage.
// The cache is explicitly cleared when a signed-in account leaves this device
// so another account cannot inherit cached couple data from the prior session.
export const nativeFirestorePersistenceEnabled = Capacitor.isNativePlatform() && typeof indexedDB !== 'undefined';
export const db = initializeFirestore(firebaseApp, nativeFirestorePersistenceEnabled
  ? {
      ignoreUndefinedProperties: true,
      localCache: persistentLocalCache({ cacheSizeBytes: 50 * 1024 * 1024 }),
    }
  : { ignoreUndefinedProperties: true });

export async function clearNativeFirestorePersistence() {
  if (!nativeFirestorePersistenceEnabled) return;
  try {
    await terminate(db);
  } catch (cause) {
    console.warn('[ROUTE firestore terminate]', cause);
  }
  try {
    await clearIndexedDbPersistence(db);
  } catch (cause) {
    console.warn('[ROUTE firestore cache clear]', cause);
    throw cause;
  }
}

export const storage = getStorage(firebaseApp);
export const authPersistenceReady = setPersistence(auth, browserLocalPersistence).catch((cause) => {
  console.warn('[ROUTE auth persistence]', cause);
});
auth.languageCode = 'ko';
