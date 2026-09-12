import { onAuthStateChanged } from 'firebase/auth';
import { PERSISTENT_STATE_CHANGE_EVENT } from '../utils/persistenceSignal';
import { auth } from './firebase';
import { saveBackupValue } from './persistentBackup';

const DEBOUNCE_MS = 1_500;
const STARTUP_FLUSH_MS = 4_000;
const SAFETY_INTERVAL_MS = 120_000;

let initialized = false;
let activeUid = '';
let dirty = false;
let flushTimer: number | undefined;
let safetyTimer: number | undefined;
let running = false;
let rerun = false;
let lastLocalState = '';

function localStateKeys(uid: string) {
  return [
    `route-scheduled-chat:${uid}`,
    `route-date-plans:${uid}`,
    `route-local-schedules:${uid}`,
    `meluni-location-visits:${uid}`,
    `meluni-location-sharing:${uid}`,
    'route.memories.deleted.v1',
  ];
}

function readLocalState(uid: string) {
  const result: Record<string, string> = {};
  for (const key of localStateKeys(uid)) {
    const value = localStorage.getItem(key);
    if (value !== null) result[key] = value;
  }
  return result;
}

function clearFlushTimer() {
  if (flushTimer !== undefined) window.clearTimeout(flushTimer);
  flushTimer = undefined;
}

function scheduleFlush(delay = DEBOUNCE_MS) {
  if (!activeUid) return;
  dirty = true;
  clearFlushTimer();
  flushTimer = window.setTimeout(() => {
    flushTimer = undefined;
    if (document.visibilityState === 'hidden') return;
    void flushBackup();
  }, delay);
}

async function flushBackup(force = false) {
  const uid = activeUid;
  if (!uid || auth.currentUser?.uid !== uid) return;
  if (running) {
    rerun = true;
    return;
  }

  const localStateSnapshot = JSON.stringify(readLocalState(uid));
  const localStateChanged = localStateSnapshot !== lastLocalState;

  if (!force && !dirty && !localStateChanged) return;
  if (!localStateChanged) {
    dirty = false;
    return;
  }

  running = true;
  try {
    await saveBackupValue(uid, 'local-state-latest', JSON.parse(localStateSnapshot) as Record<string, string>);
    lastLocalState = localStateSnapshot;
    dirty = false;
    localStorage.setItem('route.backup.lastSuccess', new Date().toISOString());
    localStorage.removeItem('route.backup.lastError');
  } catch (error) {
    dirty = true;
    localStorage.setItem('route.backup.lastError', error instanceof Error ? error.message : String(error));
    console.error('[ROUTE efficient backup]', error);
  } finally {
    running = false;
    if (rerun) {
      rerun = false;
      scheduleFlush(500);
    }
  }
}

function resetForUser(uid: string) {
  activeUid = uid;
  dirty = Boolean(uid);
  lastLocalState = uid ? JSON.stringify(readLocalState(uid)) : '';
  clearFlushTimer();
  if (safetyTimer !== undefined) window.clearInterval(safetyTimer);
  safetyTimer = undefined;

  if (!uid) return;
  flushTimer = window.setTimeout(() => {
    flushTimer = undefined;
    void flushBackup(true);
  }, STARTUP_FLUSH_MS);
  safetyTimer = window.setInterval(() => {
    if (document.visibilityState === 'visible' && dirty) void flushBackup();
  }, SAFETY_INTERVAL_MS);
}

export function startEfficientPersistentBackup() {
  if (initialized) return;
  initialized = true;

  onAuthStateChanged(auth, (user) => resetForUser(user?.uid ?? ''));
  window.addEventListener(PERSISTENT_STATE_CHANGE_EVENT, () => scheduleFlush());

  document.addEventListener('visibilitychange', () => {
    if (!activeUid) return;
    if (document.visibilityState === 'hidden') {
      clearFlushTimer();
      void flushBackup(true);
    } else if (dirty) {
      scheduleFlush(500);
    }
  });

  window.addEventListener('route-app-pause', () => {
    clearFlushTimer();
    if (activeUid) void flushBackup(true);
  });
  window.addEventListener('route-app-resume', () => {
    if (dirty) scheduleFlush(500);
  });
  window.addEventListener('pagehide', () => {
    clearFlushTimer();
    if (activeUid) void flushBackup(true);
  });
}
