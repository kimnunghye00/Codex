import { getStorage } from 'firebase/storage';
import { firebaseApp } from './firebaseCore';

// Firebase Storage is intentionally initialized outside the startup Firebase
// modules. Media/backup features import this file only when they are actually
// needed, keeping both Storage and Firestore out of ROUTE's first auth frame.
export const storage = getStorage(firebaseApp);
