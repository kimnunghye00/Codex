import { getApps, initializeApp } from 'firebase/app';

const firebaseConfig = {
  apiKey: 'AIzaSyAHuK_VnRYMsGHRO9FrztR5KvCQouNZPGg',
  authDomain: 'meluni-f4e00.firebaseapp.com',
  projectId: 'meluni-f4e00',
  storageBucket: 'meluni-f4e00.firebasestorage.app',
  messagingSenderId: '630506014881',
  appId: '1:630506014881:web:856c3faddac2b4533a08e0',
};

// Keep the lightweight Firebase app core independent from Auth, Firestore and
// Storage so ROUTE can decide when each heavier SDK enters the startup path.
export const firebaseApp = getApps()[0] ?? initializeApp(firebaseConfig);
