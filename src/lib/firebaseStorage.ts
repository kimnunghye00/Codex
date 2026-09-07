import { getStorage } from 'firebase/storage';
import { firebaseApp } from './firebase';

// Firebase Storage is intentionally initialized outside the startup Firebase
// module. Media/backup features import this file only when they are actually
// needed, keeping the Storage SDK out of ROUTE's first-screen execution path.
export const storage = getStorage(firebaseApp);
