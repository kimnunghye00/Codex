import { onAuthStateChanged, type User } from 'firebase/auth';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { getDownloadURL, ref, uploadString } from 'firebase/storage';
import type { Memory, Message } from '../types';
import { auth, db, storage } from './firebase';

const MAX_BACKUP_MESSAGES = 500;
const KEEP_POLICY = 'keep-until-user-deletes';
const MESSAGE_KEY = 'route.messages.v2';
const MEMORY_KEY = 'route.memories.v2';
const RESTORED_SESSION_KEY = 'route.backup.restored.uid';
const BACKUP_INTERVAL_MS = 8_000;

type BackupEnvelope<T> = {
  value?: T;
  updatedAt?: unknown;
  retentionPolicy?: string;
};

type LocalStateBackup = Record<string, string>;

let activeUid = '';
let backupTimer: number | undefined;
let lastMessageSnapshot = '';
let lastMemorySnapshot = '';
let lastLocalStateSnapshot = '';
let backupRunning = false;

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

function localStateKeys(uid: string) {
  return [
    `route-scheduled-chat:${uid}`,
    `route-date-plans:${uid}`,
    `route-local-schedules:${uid}`,
    `meluni-location-visits:${uid}`,
    `meluni-location-sharing:${uid}`,
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

export async function saveMessagesBackup(uid: string, messages: Message[]) {
  const recent = messages.slice(-MAX_BACKUP_MESSAGES);
  const prepared: Message[] = [];
  for (const message of recent) prepared.push(await persistMessageMedia(uid, message));
  await saveBackupValue(uid, 'messages-latest', prepared);
}

export async function saveMemoriesBackup(uid: string, memories: Memory[]) {
  const prepared: Memory[] = [];
  for (const memory of memories) prepared.push(await persistMemoryMedia(uid, memory));
  await saveBackupValue(uid, 'memories-latest', prepared);
}

export async function restoreCoreBackup(uid: string) {
  const [messages, memories] = await Promise.all([
    loadBackupValue<Message[]>(uid, 'messages-latest'),
    loadBackupValue<Memory[]>(uid, 'memories-latest'),
  ]);
  return { messages: messages ?? [], memories: memories ?? [] };
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
  const [core, localState] = await Promise.all([
    restoreCoreBackup(uid),
    loadBackupValue<LocalStateBackup>(uid, 'local-state-latest'),
  ]);

  const localMessages = readJson<Message[]>(MESSAGE_KEY, []);
  const localMemories = readJson<Memory[]>(MEMORY_KEY, []);
  const mergedMessages = mergeById(core.messages, localMessages).sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const mergedMemories = mergeById(core.memories, localMemories).sort((a, b) => b.date.localeCompare(a.date));

  let changed = false;
  if (mergedMessages.length && JSON.stringify(localMessages) !== JSON.stringify(mergedMessages)) {
    localStorage.setItem(MESSAGE_KEY, JSON.stringify(mergedMessages));
    changed = true;
  }
  if (mergedMemories.length && JSON.stringify(localMemories) !== JSON.stringify(mergedMemories)) {
    localStorage.setItem(MEMORY_KEY, JSON.stringify(mergedMemories));
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

  lastMessageSnapshot = localStorage.getItem(MESSAGE_KEY) ?? '';
  lastMemorySnapshot = localStorage.getItem(MEMORY_KEY) ?? '';
  lastLocalStateSnapshot = JSON.stringify(readLocalState(uid));
  return changed;
}

async function backupCurrentLocalState(uid: string) {
  if (!uid || backupRunning) return;
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
    if (memoriesChanged) {
      await saveMemoriesBackup(uid, readJson<Memory[]>(MEMORY_KEY, []));
      lastMemorySnapshot = memorySnapshot;
    }
    if (localStateChanged) {
      await saveBackupValue(uid, 'local-state-latest', localState);
      lastLocalStateSnapshot = localStateSnapshot;
    }
    localStorage.setItem('route.backup.lastSuccess', new Date().toISOString());
    localStorage.removeItem('route.backup.lastError');
  } catch (error) {
    console.error('[ROUTE backup]', error);
    localStorage.setItem('route.backup.lastError', error instanceof Error ? error.message : String(error));
  } finally {
    backupRunning = false;
  }
}

export async function preparePersistentBackup() {
  const user = await waitForInitialAuth();
  if (!user) return;
  try {
    await restoreIntoLocalStorage(user.uid);
    sessionStorage.setItem(RESTORED_SESSION_KEY, user.uid);
  } catch (error) {
    console.warn('[ROUTE backup restore]', error);
  }
}

export function startPersistentBackup() {
  const schedule = (uid: string) => {
    activeUid = uid;
    if (backupTimer !== undefined) window.clearInterval(backupTimer);
    backupTimer = window.setInterval(() => void backupCurrentLocalState(activeUid), BACKUP_INTERVAL_MS);
    window.setTimeout(() => void backupCurrentLocalState(activeUid), 1500);
  };

  onAuthStateChanged(auth, (user) => {
    if (!user) {
      activeUid = '';
      if (backupTimer !== undefined) window.clearInterval(backupTimer);
      backupTimer = undefined;
      return;
    }

    const alreadyRestored = sessionStorage.getItem(RESTORED_SESSION_KEY) === user.uid;
    if (alreadyRestored) {
      schedule(user.uid);
      return;
    }

    void restoreIntoLocalStorage(user.uid)
      .then((changed) => {
        sessionStorage.setItem(RESTORED_SESSION_KEY, user.uid);
        schedule(user.uid);
        if (changed) {
          window.dispatchEvent(new CustomEvent('route-backup-restored'));
        }
      })
      .catch((error) => {
        console.warn('[ROUTE backup login restore]', error);
        schedule(user.uid);
      });
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && activeUid) void backupCurrentLocalState(activeUid);
  });
  window.addEventListener('pagehide', () => {
    if (activeUid) void backupCurrentLocalState(activeUid);
  });
}
