import { Capacitor } from '@capacitor/core';
import { clearIndexedDbPersistence, initializeFirestore, persistentLocalCache, terminate } from 'firebase/firestore';
import { firebaseApp } from './firebaseCore';
import { auth, authPersistenceReady } from './firebaseAuth';

export { firebaseApp, auth, authPersistenceReady };

// Capacitor runs the web Firebase SDK inside a private app WebView. Keep its
// Firestore cache across app restarts so previously loaded chats, schedules,
// locations and settings remain readable during a temporary network outage.
// Firestore itself now enters the graph only when a feature imports this module;
// session restoration can finish through firebaseAuth.ts without initializing DB.
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
