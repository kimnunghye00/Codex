import { onAuthStateChanged, type User } from 'firebase/auth';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { getDownloadURL, ref, uploadString } from 'firebase/storage';
import type { Memory, Message } from '../types';
import { PERSISTENT_STATE_CHANGE_EVENT } from '../utils/persistenceSignal';
import {
  loadDeletedMemories,
  MEMORY_DELETED_KEY,
  saveDeletedMemories,
  type MemoryDeletionMap,
} from '../utils/storage';
import { auth, db } from './firebase';
import { storage } from './firebaseStorage';

const MAX_BACKUP_MESSAGES = 500;
const KEEP_POLICY = 'keep-until-user-deletes';
const MESSAGE_KEY = 'route.messages.v2';
const MEMORY_KEY = 'route.memories.v2';
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

type LocalStateBackup = Record<string, string>;

let activeUid = '';
let backupTimer: number | undefined;
let immediateBackupTimer: number | undefined;
let startupBackupTimer: number | undefined;
let lastMessageSnapshot = '';
let lastMemorySnapshot = '';
let lastLocalStateSnapshot = '';
let backupRunning = false;
let backupAgainUid = '';
let persistentBackupInitialized = false;
let authGeneration = 0;

function backupRef(uid: string, key: string) {
  return doc(db, 'users', uid, 'backups', key);
}

function safeSegment(value: string | number) {
  return String(value).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
}

function isDataUrl(value?: string) {
  return Boolean(value?.startsWith('data:'));
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : fallback;
  } catch {
    return fallback;
  }
}

function mergeById<T extends { id: string | number }>(cloud: T[], local: T[]) {
  const merged = new Map<string | number, T>();
  cloud.forEach((item) => merged.set(item.id, item));
  local.forEach((item) => merged.set(item.id, item));
  return [...merged.values()];
}

function mergeDeleted(a: MemoryDeletionMap, b: MemoryDeletionMap) {
  const merged: MemoryDeletionMap = { ...a };
  Object.entries(b).forEach(([id, timestamp]) => {
    if (!merged[id] || timestamp > merged[id]) merged[id] = timestamp;
  });
  return merged;
}

function localStateKeys(uid: string) {
  return [
    `meluni-profile:${uid}`,
    `route-scheduled-chat:${uid}`,
    `route-date-plans:${uid}`,
    `route-local-schedules:${uid}`,
    `meluni-location-visits:${uid}`,
    `meluni-location-sharing:${uid}`,
    MEMORY_DELETED_KEY,
  ];
}

function readLocalState(uid: string): LocalStateBackup {
  const result: LocalStateBackup = {};
  localStateKeys(uid).forEach((key) => {
    const value = localStorage.getItem(key);
    if (value !== null) result[key] = value;
  });
  return result;
}

async function persistMedia(uid: string, folder: string, name: string, value: string) {
  if (!isDataUrl(value)) return value;
  const target = ref(storage, `users/${uid}/backupMedia/${safeSegment(folder)}/${safeSegment(name)}`);
  await uploadString(target, value, 'data_url');
  return getDownloadURL(target);
}

async function persistMessageMedia(uid: string, message: Message): Promise<Message> {
  if (message.imageUrl) {
    const imageUrl = await persistMedia(uid, 'chat', `${message.id}-0`, message.imageUrl);
    return { ...message, imageUrl };
  }
  if (message.imageUrls?.length) {
    const imageUrls = await Promise.all(message.imageUrls.map((url, index) => persistMedia(uid, 'chat', `${message.id}-${index}`, url)));
    return { ...message, imageUrls };
  }
  return message;
}

async function persistMemoryMedia(uid: string, memory: Memory): Promise<Memory> {
  const images = await Promise.all(memory.images.map((url, index) => persistMedia(uid, 'memories', `${memory.id}-image-${index}`, url)));
  const videos = memory.videos?.length
    ? await Promise.all(memory.videos.map((url, index) => persistMedia(uid, 'memories', `${memory.id}-video-${index}`, url)))
    : undefined;
  return { ...memory, images, videos };
}

export async function saveBackupValue<T>(uid: string, key: string, value: T) {
  if (!uid) return;
  await setDoc(backupRef(uid, key), {
    value,
    updatedAt: serverTimestamp(),
    retentionPolicy: KEEP_POLICY,
  } satisfies BackupEnvelope<T>, { merge: true });
}

export async function loadBackupValue<T>(uid: string, key: string): Promise<T | undefined> {
  if (!uid) return undefined;
  const snapshot = await getDoc(backupRef(uid, key));
  if (!snapshot.exists()) return undefined;
  return (snapshot.data() as BackupEnvelope<T>).value;
}

async function loadBackupEnvelope<T>(uid: string, key: string): Promise<BackupEnvelope<T> | undefined> {
  if (!uid) return undefined;
  const snapshot = await getDoc(backupRef(uid, key));
  if (!snapshot.exists()) return undefined;
  return snapshot.data() as BackupEnvelope<T>;
}

export async function saveMessagesBackup(uid: string, messages: Message[]) {
  const recent = messages.slice(-MAX_BACKUP_MESSAGES);
  const prepared: Message[] = [];
  for (const message of recent) prepared.push(await persistMessageMedia(uid, message));
  await saveBackupValue(uid, 'messages-latest', prepared);
}

export async function saveMemoriesBackup(uid: string, memories: Memory[]) {
  const deleted = loadDeletedMemories();
  const prepared: Memory[] = [];
  for (const memory of memories) {
    if (!deleted[String(memory.id)]) prepared.push(await persistMemoryMedia(uid, memory));
  }
  await setDoc(backupRef(uid, 'memories-latest'), {
    value: prepared,
    deleted,
    updatedAt: serverTimestamp(),
    retentionPolicy: KEEP_POLICY,
  } satisfies BackupEnvelope<Memory[]>, { merge: true });
}

export async function restoreCoreBackup(uid: string) {
  const [messages, latestMemories, liveMemories] = await Promise.all([
    loadBackupValue<Message[]>(uid, 'messages-latest'),
    loadBackupEnvelope<Memory[]>(uid, 'memories-latest'),
    loadBackupEnvelope<Memory[]>(uid, 'memories-live'),
  ]);

  const chosen = liveMemories?.value ? liveMemories : latestMemories;
  const deleted = mergeDeleted(latestMemories?.deleted ?? {}, liveMemories?.deleted ?? {});
  const memories = (chosen?.value ?? []).filter((memory) => !deleted[String(memory.id)]);
  return { messages: messages ?? [], memories, deleted };
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
  const [core, localState, userSnapshot] = await Promise.all([
    restoreCoreBackup(uid),
    loadBackupValue<LocalStateBackup>(uid, 'local-state-latest'),
    getDoc(doc(db, 'users', uid)),
  ]);

  if (auth.currentUser?.uid !== uid) return false;

  const localMessages = readJson<Message[]>(MESSAGE_KEY, []);
  const rawLocalMemories = readJson<Memory[]>(MEMORY_KEY, []);
  const localDeleted = loadDeletedMemories();
  const deleted = mergeDeleted(core.deleted, localDeleted);
  const cloudMemories = core.memories.filter((memory) => !deleted[String(memory.id)]);
  const localMemories = rawLocalMemories.filter((memory) => !deleted[String(memory.id)]);

  const mergedMessages = mergeById(core.messages, localMessages).sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const mergedMemories = mergeById(cloudMemories, localMemories)
    .filter((memory) => !deleted[String(memory.id)])
    .sort((a, b) => b.date.localeCompare(a.date));

  let changed = false;
  if (JSON.stringify(localMessages) !== JSON.stringify(mergedMessages)) {
    localStorage.setItem(MESSAGE_KEY, JSON.stringify(mergedMessages));
    changed = true;
  }
  if (JSON.stringify(rawLocalMemories) !== JSON.stringify(mergedMemories)) {
    localStorage.setItem(MEMORY_KEY, JSON.stringify(mergedMemories));
    changed = true;
  }
  if (JSON.stringify(localDeleted) !== JSON.stringify(deleted)) {
    saveDeletedMemories(deleted);
    changed = true;
  }

  if (localState) {
    Object.entries(localState).forEach(([key, value]) => {
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

  lastMessageSnapshot = localStorage.getItem(MESSAGE_KEY) ?? '';
  lastMemorySnapshot = localStorage.getItem(MEMORY_KEY) ?? '';
  lastLocalStateSnapshot = JSON.stringify(readLocalState(uid));
  return changed;
}

async function backupCurrentLocalState(uid: string) {
  if (!uid || uid !== activeUid) return;
  if (backupRunning) {
    backupAgainUid = uid;
    return;
  }

  const messageSnapshot = localStorage.getItem(MESSAGE_KEY) ?? '[]';
  const memorySnapshot = localStorage.getItem(MEMORY_KEY) ?? '[]';
  const localState = readLocalState(uid);
  const localStateSnapshot = JSON.stringify(localState);

  const messagesChanged = messageSnapshot !== lastMessageSnapshot;
  const memoriesChanged = memorySnapshot !== lastMemorySnapshot;
  const localStateChanged = localStateSnapshot !== lastLocalStateSnapshot;
  if (!messagesChanged && !memoriesChanged && !localStateChanged) return;

  backupRunning = true;
  try {
    if (messagesChanged) {
      await saveMessagesBackup(uid, readJson<Message[]>(MESSAGE_KEY, []));
      lastMessageSnapshot = messageSnapshot;
    }
    if (memoriesChanged || localStateChanged) {
      await saveMemoriesBackup(uid, readJson<Memory[]>(MEMORY_KEY, []));
      lastMemorySnapshot = memorySnapshot;
    }
    if (localStateChanged) {
      await saveBackupValue(uid, 'local-state-latest', localState);
      lastLocalStateSnapshot = localStateSnapshot;
    }
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
    await restoreIntoLocalStorage(user.uid);
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
      .then((changed) => {
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
