import { onAuthStateChanged } from 'firebase/auth';
import { PERSISTENT_STATE_CHANGE_EVENT } from '../utils/persistenceSignal';
import { auth } from './firebaseAuth';
import { prepareUserLocalStateBackup, saveBackupValue } from './persistentBackup';
import { createBackupCoordinator } from './backupCoordinator';
import { readLocalStateBackup } from './localStateBackup';

const DEBOUNCE_MS = 1_500;
const STARTUP_FLUSH_MS = 4_000;
const SAFETY_INTERVAL_MS = 120_000;

let initialized = false;
let activeUid = '';
let authGeneration = 0;
let flushTimer: number | undefined;
let safetyTimer: number | undefined;
function reportError(error: unknown) {
  // Diagnostics must never turn a handled storage/network failure into an
  // unhandled rejection when localStorage is full or temporarily unavailable.
  try {
    localStorage.setItem('route.backup.lastError', error instanceof Error ? error.message : String(error));
  } catch { /* best-effort diagnostic only */ }
  console.error('[ROUTE efficient backup]', error);
}

const coordinator = createBackupCoordinator({
  currentUid: () => auth.currentUser?.uid ?? '',
  read: (uid) => readLocalStateBackup(uid, localStorage),
  save: (uid, value) => saveBackupValue(uid, 'local-state-latest', value),
  onSuccess: () => {
    try {
      localStorage.setItem('route.backup.lastSuccess', new Date().toISOString());
      localStorage.removeItem('route.backup.lastError');
    } catch { /* best-effort diagnostic only */ }
  },
  onError: reportError,
  schedule: (delay) => scheduleFlush(delay),
});

function clearFlushTimer() {
  if (flushTimer !== undefined) window.clearTimeout(flushTimer);
  flushTimer = undefined;
}

function scheduleFlush(delay = DEBOUNCE_MS) {
  if (!activeUid) return;
  clearFlushTimer();
  const generation = authGeneration;
  flushTimer = window.setTimeout(() => {
    flushTimer = undefined;
    if (generation !== authGeneration || document.visibilityState === 'hidden') return;
    void coordinator.flush();
  }, delay);
}

function resetForUser(uid: string) {
  const generation = ++authGeneration;
  activeUid = uid;
  coordinator.clear();
  clearFlushTimer();
  if (safetyTimer !== undefined) window.clearInterval(safetyTimer);
  safetyTimer = undefined;

  if (!uid) return;
  let preparationFailures = 0;
  const current = () => generation === authGeneration && auth.currentUser?.uid === uid;
  const prepare = async () => {
    try {
      const { cloudState, changed } = await prepareUserLocalStateBackup(uid);
      if (!current()) return;
      coordinator.activate(uid, cloudState);
      scheduleFlush(STARTUP_FLUSH_MS);
      safetyTimer = window.setInterval(() => {
        if (current() && document.visibilityState === 'visible' && coordinator.pending()) void coordinator.flush();
      }, SAFETY_INTERVAL_MS);
      if (changed) window.dispatchEvent(new Event('route-backup-restored'));
    } catch (error) {
      if (!current()) return;
      reportError(error);
      preparationFailures += 1;
      // Do not overwrite the cloud with an empty/partial local state when the
      // initial restore failed. Retry preparation with bounded backoff first.
      flushTimer = window.setTimeout(() => {
        flushTimer = undefined;
        if (current()) void prepare();
      }, Math.min(120_000, 2000 * 2 ** Math.min(6, preparationFailures - 1)));
    }
  };
  void prepare();
}

export function startEfficientPersistentBackup() {
  if (initialized) return;
  initialized = true;

  onAuthStateChanged(auth, (user) => resetForUser(user?.uid ?? ''));
  window.addEventListener(PERSISTENT_STATE_CHANGE_EVENT, () => {
    coordinator.markDirty();
    if (coordinator.pending()) scheduleFlush();
  });

  document.addEventListener('visibilitychange', () => {
    if (!activeUid) return;
    if (document.visibilityState === 'hidden') {
      if (coordinator.pending()) clearFlushTimer();
      void coordinator.flush();
    } else if (coordinator.pending()) {
      scheduleFlush(500);
    }
  });

  window.addEventListener('route-app-pause', () => {
    if (coordinator.pending()) clearFlushTimer();
    if (activeUid) void coordinator.flush();
  });
  window.addEventListener('route-app-resume', () => {
    if (coordinator.pending()) scheduleFlush(500);
  });
  window.addEventListener('pagehide', () => {
    if (coordinator.pending()) clearFlushTimer();
    if (activeUid) void coordinator.flush();
  });
}
