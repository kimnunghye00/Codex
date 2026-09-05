import { onAuthStateChanged } from 'firebase/auth';
import { doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import { getDownloadURL, ref, uploadString } from 'firebase/storage';
import type { Memory } from '../types';
import { auth, db, storage } from './firebase';

const MEMORY_KEY = 'route.memories.v2';
const LIVE_BACKUP_KEY = 'memories-live';
const DEVICE_KEY = 'route.albumSync.deviceId';
const CHANGE_EVENT = 'route-memories-local-change';

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
let reloadPending = false;
let unsubscribeCloud: (() => void) | undefined;

function liveRef(uid: string) {
  return doc(db, 'users', uid, 'backups', LIVE_BACKUP_KEY);
}

function safeSegment(value: string | number) {
  return String(value).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
}

function readMemories(): Memory[] {
  try {
    const raw = localStorage.getItem(MEMORY_KEY);
    return raw ? JSON.parse(raw) as Memory[] : [];
  } catch {
    return [];
  }
}

function writeMemories(memories: Memory[]) {
  localStorage.setItem(MEMORY_KEY, JSON.stringify(memories));
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
    const current = readMemories();
    const prepared: Memory[] = [];
    for (const memory of current) prepared.push(await prepareMemory(uid, memory));

    await setDoc(liveRef(uid), {
      value: prepared,
      sourceDeviceId: DEVICE_ID,
      updatedAt: serverTimestamp(),
      retentionPolicy: 'keep-until-user-deletes',
    }, { merge: true });

    localDirty = false;
    localStorage.setItem('route.albumSync.lastSuccess', new Date().toISOString());
    localStorage.removeItem('route.albumSync.lastError');
  } catch (error) {
    console.error('[ROUTE album sync]', error);
    localStorage.setItem('route.albumSync.lastError', error instanceof Error ? error.message : String(error));
  } finally {
    saving = false;
    if (saveAgain) {
      saveAgain = false;
      window.setTimeout(() => void pushCurrentMemories(activeUid), 120);
    }
  }
}

function schedulePush(delay = 120) {
  if (!activeUid || !cloudReady) return;
  if (saveTimer !== undefined) window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => void pushCurrentMemories(activeUid), delay);
}

function applyCloudMemories(value: Memory[]) {
  if (localDirty) return;
  const remote = [...value].sort((a, b) => b.date.localeCompare(a.date));
  const local = readMemories();
  if (JSON.stringify(local) === JSON.stringify(remote)) return;

  try {
    writeMemories(remote);
    localStorage.setItem('route.albumSync.lastReceived', new Date().toISOString());
    if (document.visibilityState === 'visible') window.location.reload();
    else reloadPending = true;
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
      if (firstSnapshot && readMemories().length) schedulePush(20);
      return;
    }

    const data = snapshot.data() as { value?: Memory[]; sourceDeviceId?: string };
    if (!Array.isArray(data.value)) return;
    if (data.sourceDeviceId === DEVICE_ID) return;
    applyCloudMemories(data.value);
  }, (error) => {
    cloudReady = true;
    console.warn('[ROUTE album sync subscribe]', error);
  });
}

export function initializeCrossDeviceAlbumSync() {
  onAuthStateChanged(auth, (user) => {
    unsubscribeCloud?.();
    unsubscribeCloud = undefined;
    activeUid = user?.uid ?? '';
    cloudReady = false;
    localDirty = false;
    if (activeUid) subscribe(activeUid);
  });

  window.addEventListener(CHANGE_EVENT, () => {
    localDirty = true;
    schedulePush();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && activeUid && cloudReady && localDirty) {
      void pushCurrentMemories(activeUid);
      return;
    }
    if (document.visibilityState === 'visible' && reloadPending) {
      reloadPending = false;
      window.location.reload();
    }
  });

  window.addEventListener('pagehide', () => {
    if (activeUid && cloudReady && localDirty) void pushCurrentMemories(activeUid);
  });
}
