import { onAuthStateChanged, type User } from 'firebase/auth';
import { doc, getDoc, getDocFromServer, serverTimestamp, setDoc } from 'firebase/firestore';
import { PERSISTENT_STATE_CHANGE_EVENT } from '../utils/persistenceSignal';
import {
  type MemoryDeletionMap,
} from '../utils/storage';
import { auth, db } from './firebase';
import { readLocalStateBackup, validLocalStateBackup, type LocalStateBackup } from './localStateBackup';

const KEEP_POLICY = 'keep-until-user-deletes';
const RESTORED_SESSION_KEY = 'route.backup.restored.uid';
const BACKUP_INTERVAL_MS = 8_000;
const IMMEDIATE_BACKUP_DELAY_MS = 120;

type BackupEnvelope<T> = {
  value?: T;
  deleted?: MemoryDeletionMap;
  updatedAt?: unknown;
  retentionPolicy?: string;
  sourceDeviceId?: string;
};

let activeUid = '';
let backupTimer: number | undefined;
let immediateBackupTimer: number | undefined;
let startupBackupTimer: number | undefined;
let lastLocalStateSnapshot = '';
let backupRunning = false;
let backupAgainUid = '';
let persistentBackupInitialized = false;
let authGeneration = 0;

function backupRef(uid: string, key: string) {
  return doc(db, 'users', uid, 'backups', key);
}





function readLocalState(uid: string): LocalStateBackup {
  return readLocalStateBackup(uid, localStorage);
}




export async function saveBackupValue<T>(uid: string, key: string, value: T) {
  if (!uid) return;
  await setDoc(backupRef(uid, key), {
    value,
    updatedAt: serverTimestamp(),
    retentionPolicy: KEEP_POLICY,
  } satisfies BackupEnvelope<T>, { mergeFields: ['value', 'updatedAt', 'retentionPolicy'] });
}

export async function loadBackupValue<T>(uid: string, key: string): Promise<T | undefined> {
  if (!uid) return undefined;
  // A stale offline snapshot cannot establish a safe baseline for replacement.
  const snapshot = await getDocFromServer(backupRef(uid, key));
  if (!snapshot.exists()) return undefined;
  return (snapshot.data() as BackupEnvelope<T>).value;
}




export async function restoreCoreBackup() {
  // Chat and couple memories are now restored by their realtime Firestore
  // collections. Reading legacy "messages-latest" / "memories-live" documents
  // here could pull old base64 media into memory a second time and crash Chrome.
  return { messages: [], memories: [], deleted: {} as MemoryDeletionMap };
}

async function waitForInitialAuth(): Promise<User | null> {
  return new Promise((resolve) => {
    let done = false;
    let unsubscribe: () => void = () => {};
    const finish = (user: User | null) => {
      if (done) return;
      done = true;
      window.clearTimeout(timeout);
      unsubscribe();
      resolve(user);
    };
    const timeout = window.setTimeout(() => finish(auth.currentUser), 3500);
    unsubscribe = onAuthStateChanged(auth, finish);
  });
}

async function restoreIntoLocalStorage(uid: string) {
  const expectedUser = auth.currentUser;
  if (expectedUser?.uid !== uid) throw new Error('backup-user-changed');
  const [localState, userSnapshot] = await Promise.all([
    loadBackupValue<LocalStateBackup>(uid, 'local-state-latest'),
    getDoc(doc(db, 'users', uid)),
  ]);

  if (auth.currentUser !== expectedUser) throw new Error('backup-user-changed');

  let changed = false;
  const cloudState = validLocalStateBackup(uid, localState);

  if (localState) {
    Object.entries(cloudState).forEach(([key, value]) => {
      if (localStorage.getItem(key) === null && typeof value === 'string') {
        localStorage.setItem(key, value);
        changed = true;
      }
    });
  }

  const profileKey = `meluni-profile:${uid}`;
  if (localStorage.getItem(profileKey) === null && userSnapshot.exists()) {
    const cloudProfile = userSnapshot.data()?.profile;
    if (cloudProfile && typeof cloudProfile === 'object') {
      localStorage.setItem(profileKey, JSON.stringify(cloudProfile));
      changed = true;
    }
  }

  lastLocalStateSnapshot = JSON.stringify(readLocalState(uid));
  return { changed, cloudState };
}

let prepared: { user: User; promise: ReturnType<typeof restoreIntoLocalStorage> } | null = null;

// Share startup restoration with the efficient writer. Rejected restoration is
// never treated as an empty cloud backup, and may be retried after reconnecting.
export function prepareUserLocalStateBackup(uid: string) {
  const user = auth.currentUser;
  if (!user || user.uid !== uid) return Promise.reject(new Error('backup-user-changed'));
  if (prepared?.user === user) return prepared.promise;
  const promise = restoreIntoLocalStorage(uid).catch((error) => {
    if (prepared?.promise === promise) prepared = null;
    throw error;
  });
  prepared = { user, promise };
  return promise;
}

async function backupCurrentLocalState(uid: string) {
  if (!uid || uid !== activeUid) return;
  if (backupRunning) {
    backupAgainUid = uid;
    return;
  }

  const localState = readLocalState(uid);
  const localStateSnapshot = JSON.stringify(localState);
  const localStateChanged = localStateSnapshot !== lastLocalStateSnapshot;
  if (!localStateChanged) return;

  backupRunning = true;
  try {
    await saveBackupValue(uid, 'local-state-latest', localState);
    lastLocalStateSnapshot = localStateSnapshot;
    if (uid === activeUid) {
      localStorage.setItem('route.backup.lastSuccess', new Date().toISOString());
      localStorage.removeItem('route.backup.lastError');
    }
  } catch (error) {
    console.error('[ROUTE backup]', error);
    if (uid === activeUid) {
      localStorage.setItem('route.backup.lastError', error instanceof Error ? error.message : String(error));
    }
  } finally {
    backupRunning = false;
    const rerunUid = backupAgainUid;
    backupAgainUid = '';
    if (rerunUid && rerunUid === activeUid) {
      window.setTimeout(() => void backupCurrentLocalState(rerunUid), IMMEDIATE_BACKUP_DELAY_MS);
    }
  }
}

function scheduleImmediateBackup() {
  const uid = activeUid;
  if (!uid) return;
  if (immediateBackupTimer !== undefined) window.clearTimeout(immediateBackupTimer);
  immediateBackupTimer = window.setTimeout(() => {
    immediateBackupTimer = undefined;
    if (uid !== activeUid) return;
    void backupCurrentLocalState(uid);
  }, IMMEDIATE_BACKUP_DELAY_MS);
}

export async function preparePersistentBackup() {
  const user = await waitForInitialAuth();
  if (!user) return;
  try {
    await prepareUserLocalStateBackup(user.uid);
    if (auth.currentUser?.uid === user.uid) sessionStorage.setItem(RESTORED_SESSION_KEY, user.uid);
  } catch (error) {
    console.warn('[ROUTE backup restore]', error);
  }
}

export function startPersistentBackup() {
  if (persistentBackupInitialized) return;
  persistentBackupInitialized = true;

  const clearTimers = () => {
    if (backupTimer !== undefined) window.clearInterval(backupTimer);
    if (immediateBackupTimer !== undefined) window.clearTimeout(immediateBackupTimer);
    if (startupBackupTimer !== undefined) window.clearTimeout(startupBackupTimer);
    backupTimer = undefined;
    immediateBackupTimer = undefined;
    startupBackupTimer = undefined;
  };

  const schedule = (uid: string, generation: number) => {
    if (!uid || generation !== authGeneration || auth.currentUser?.uid !== uid) return;
    activeUid = uid;
    clearTimers();
    backupTimer = window.setInterval(() => {
      if (generation === authGeneration && activeUid === uid) void backupCurrentLocalState(uid);
    }, BACKUP_INTERVAL_MS);
    startupBackupTimer = window.setTimeout(() => {
      startupBackupTimer = undefined;
      if (generation === authGeneration && activeUid === uid) void backupCurrentLocalState(uid);
    }, 1500);
  };

  onAuthStateChanged(auth, (user) => {
    const generation = ++authGeneration;
    clearTimers();
    backupAgainUid = '';
    activeUid = '';

    if (!user) return;

    const uid = user.uid;
    const alreadyRestored = sessionStorage.getItem(RESTORED_SESSION_KEY) === uid;
    if (alreadyRestored) {
      schedule(uid, generation);
      return;
    }

    void restoreIntoLocalStorage(uid)
      .then(({ changed }) => {
        if (generation !== authGeneration || auth.currentUser?.uid !== uid) return;
        sessionStorage.setItem(RESTORED_SESSION_KEY, uid);
        schedule(uid, generation);
        if (changed) {
          window.dispatchEvent(new CustomEvent('route-backup-restored'));
        }
      })
      .catch((error) => {
        if (generation !== authGeneration || auth.currentUser?.uid !== uid) return;
        console.warn('[ROUTE backup login restore]', error);
        schedule(uid, generation);
      });
  });

  window.addEventListener(PERSISTENT_STATE_CHANGE_EVENT, scheduleImmediateBackup);
  document.addEventListener('visibilitychange', () => {
    const uid = activeUid;
    if (document.visibilityState === 'hidden' && uid) void backupCurrentLocalState(uid);
  });
  window.addEventListener('pagehide', () => {
    const uid = activeUid;
    if (uid) void backupCurrentLocalState(uid);
  });
}
