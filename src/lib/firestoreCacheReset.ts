import { clearNativeFirestorePersistence } from './firebase';

// This module exists only behind a dynamic import from recovery-runtime. Keeping
// the Firestore dependency one module deeper prevents the normal account-isolation
// bootstrap from becoming a direct consumer of the full database SDK.
export async function clearFirestoreCacheForAccountReset() {
  await clearNativeFirestorePersistence();
}
