import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

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
export const db = getFirestore(firebaseApp);
auth.languageCode = 'ko';
