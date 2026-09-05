import { onAuthStateChanged } from 'firebase/auth';
import { doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import { getDownloadURL, ref, uploadString } from 'firebase/storage';
import type { Memory } from '../types';
import {
  loadDeletedMemories,
  MEMORY_DELETED_KEY,
  saveDeletedMemories,
  type MemoryDeletionMap,
} from '../utils/storage';
import { auth, db, storage } from './firebase';

const MEMORY_KEY = 'route.memories.v2';
const LIVE_BACKUP_KEY = 'memories-live';
const LATEST_BACKUP_KEY = 'memories-latest';
const DEVICE_KEY = 'route.albumSync.deviceId';
const DIRTY_KEY = 'route.albumSync.pending';
const CHANGE_EVENT = 'route-memories-local-change';
const REMOTE_CHANGE_EVENT = 'route-memories-remote-change';

function getDeviceId() {
  try {
    const existing = localStorage.getItem(DEVICE_KEY);
    if (existing) return existing;
    const next = typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `device-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(DEVICE_KEY, next);
    return next;
  } catch {
    return `session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

const DEVICE_ID = getDeviceId();

let activeUid = '';
let cloudReady = false;
let localDirty = false;
let saving = false;
let saveAgain = false;
let saveTimer: number | undefined;
let unsubscribeCloud: (() => void) | undefined;

function backupRef(uid: string, key: string) {
  return doc(db, 'users', uid, 'backups', key);
}

function liveRef(uid: string) {
  return backupRef(uid, LIVE_BACKUP_KEY);
}

function safeSegment(value: string | number) {
  return String(value).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
}

function readMemories(): Memory[] {
  try {
    const raw = localStorage.getItem(MEMORY_KEY);
    const deleted = loadDeletedMemories();
    const memories = raw ? JSON.parse(raw) as Memory[] : [];
    return memories.filter((memory) => !deleted[String(memory.id)]);
  } catch {
    return [];
  }
}

function writeMemories(memories: Memory[]) {
  localStorage.setItem(MEMORY_KEY, JSON.stringify(memories));
}

function mergeDeleted(a: MemoryDeletionMap, b: MemoryDeletionMap) {
  const merged: MemoryDeletionMap = { ...a };
  Object.entries(b).forEach(([id, timestamp]) => {
    if (!merged[id] || timestamp > merged[id]) merged[id] = timestamp;
  });
  return merged;
}

function setDirty(value: boolean) {
  localDirty = value;
  try {
    if (value) localStorage.setItem(DIRTY_KEY, '1');
    else localStorage.removeItem(DIRTY_KEY);
  } catch { /* localDirty still protects this session */ }
}

async function persistMedia(uid: string, memoryId: number, index: number, value: string) {
  if (!value.startsWith('data:')) return value;
  const target = ref(storage, `users/${uid}/backupMedia/memories-live/${safeSegment(memoryId)}-${index}`);
  await uploadString(target, value, 'data_url');
  return getDownloadURL(target);
}

async function prepareMemory(uid: string, memory: Memory): Promise<Memory> {
  const images = await Promise.all(memory.images.map((value, index) => persistMedia(uid, memory.id, index, value)));
  const videos = memory.videos?.length
    ? await Promise.all(memory.videos.map((value, index) => persistMedia(uid, memory.id, 1000 + index, value)))
    : undefined;
  return { ...memory, images, videos };
}

async function pushCurrentMemories(uid: string) {
  if (!uid) return;
  if (saving) {
    saveAgain = true;
    return;
  }

  saving = true;
  try {
    const deleted = loadDeletedMemories();
    const current = readMemories().filter((memory) => !deleted[String(memory.id)]);
    const prepared: Memory[] = [];
    for (const memory of current) prepared.push(await prepareMemory(uid, memory));

    const envelope = {
      value: prepared,
      deleted,
      sourceDeviceId: DEVICE_ID,
      updatedAt: serverTimestamp(),
      retentionPolicy: 'keep-until-user-deletes',
    };

    // Keep both restore sources consistent. A deleted album item must never survive
    // in memories-latest while memories-live already knows it was deleted.
    await Promise.all([
      setDoc(liveRef(uid), envelope, { merge: true }),
      setDoc(backupRef(uid, LATEST_BACKUP_KEY), envelope, { merge: true }),
    ]);

    setDirty(false);
    localStorage.setItem('route.albumSync.lastSuccess', new Date().toISOString());
    localStorage.removeItem('route.albumSync.lastError');
  } catch (error) {
    console.error('[ROUTE album sync]', error);
    setDirty(true);
    localStorage.setItem('route.albumSync.lastError', error instanceof Error ? error.message : String(error));
  } finally {
    saving = false;
    if (saveAgain) {
      saveAgain = false;
      window.setTimeout(() => void pushCurrentMemories(activeUid), 80);
    }
  }
}

function schedulePush(delay = 120) {
  if (!activeUid || !cloudReady) return;
  if (saveTimer !== undefined) window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => void pushCurrentMemories(activeUid), delay);
}

function applyCloudMemories(value: Memory[], cloudDeleted: MemoryDeletionMap) {
  if (localDirty) return;

  const deleted = mergeDeleted(loadDeletedMemories(), cloudDeleted);
  saveDeletedMemories(deleted);
  const remote = [...value]
    .filter((memory) => !deleted[String(memory.id)])
    .sort((a, b) => b.date.localeCompare(a.date));
  const local = readMemories();
  if (JSON.stringify(local) === JSON.stringify(remote)) return;

  try {
    writeMemories(remote);
    localStorage.setItem(MEMORY_DELETED_KEY, JSON.stringify(deleted));
    localStorage.setItem('route.albumSync.lastReceived', new Date().toISOString());
    window.dispatchEvent(new CustomEvent(REMOTE_CHANGE_EVENT, { detail: remote }));
  } catch (error) {
    console.warn('[ROUTE album sync apply]', error);
  }
}

function subscribe(uid: string) {
  unsubscribeCloud?.();
  cloudReady = false;
  unsubscribeCloud = onSnapshot(liveRef(uid), (snapshot) => {
    const firstSnapshot = !cloudReady;
    cloudReady = true;

    if (!snapshot.exists()) {
      if (firstSnapshot && (readMemories().length || Object.keys(loadDeletedMemories()).length)) schedulePush(0);
      return;
    }

    const data = snapshot.data() as {
      value?: Memory[];
      deleted?: MemoryDeletionMap;
      sourceDeviceId?: string;
    };
    if (!Array.isArray(data.value)) return;

    const cloudDeleted = data.deleted ?? {};
    const localDeleted = loadDeletedMemories();
    const hasLocalOnlyDeletion = Object.keys(localDeleted).some((id) => !cloudDeleted[id]);

    // A reload used to clear the in-memory dirty flag and let an older cloud
    // snapshot resurrect a just-deleted photo. Pending state and tombstones now win.
    if (localDirty || hasLocalOnlyDeletion) {
      setDirty(true);
      schedulePush(0);
      return;
    }

    applyCloudMemories(data.value, cloudDeleted);
  }, (error) => {
    cloudReady = true;
    console.warn('[ROUTE album sync subscribe]', error);
  });
}

export function requestAlbumSyncNow() {
  setDirty(true);
  if (activeUid && cloudReady) schedulePush(0);
}

export function initializeCrossDeviceAlbumSync() {
  onAuthStateChanged(auth, (user) => {
    unsubscribeCloud?.();
    unsubscribeCloud = undefined;
    activeUid = user?.uid ?? '';
    cloudReady = false;
    localDirty = localStorage.getItem(DIRTY_KEY) === '1';
    if (activeUid) subscribe(activeUid);
  });

  window.addEventListener(CHANGE_EVENT, (event) => {
    const detail = (event as CustomEvent<{ deleted?: boolean }>).detail;
    setDirty(true);
    // Deletions are flushed immediately; additions/edits keep a tiny debounce so
    // multiple local writes can coalesce into one cloud update.
    schedulePush(detail?.deleted ? 0 : 120);
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && activeUid && cloudReady && localDirty) {
      void pushCurrentMemories(activeUid);
    }
  });

  window.addEventListener('pagehide', () => {
    if (activeUid && cloudReady && localDirty) void pushCurrentMemories(activeUid);
  });
}
