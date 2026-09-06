import { onAuthStateChanged } from 'firebase/auth';
import { auth, clearNativeFirestorePersistence } from './lib/firebase';
import { requestAlbumSyncNow } from './lib/crossDeviceAlbumSync';
import { decideAccountIsolation } from './utils/accountIsolationPolicy';
import { signalPersistentStateChange } from './utils/persistenceSignal';

const NETWORK_BANNER_ID = 'route-network-status';
const RECOVERY_RELOAD_PREFIX = 'route.backup.reloadApplied:';
const ACCOUNT_SWITCH_RELOAD_KEY = 'route.accountSwitch.reload';
const LOCAL_DATA_OWNER_KEY = 'route.localData.ownerUid';
const ALBUM_PENDING_KEY = 'route.albumSync.pending';
const ACCOUNT_SHARED_CACHE_KEYS = [
  'route.messages.v2',
  'route.memories.v2',
  'route.memories.deleted.v1',
  'route.albumSync.pending',
] as const;

const rawStorageSetItem = typeof Storage !== 'undefined' ? Storage.prototype.setItem : undefined;
const rawStorageRemoveItem = typeof Storage !== 'undefined' ? Storage.prototype.removeItem : undefined;
let onlineHideTimer: number | undefined;
let accountResetInProgress = false;
let runtimeListenersInstalled = false;
let runtimeRecoveryPromise: Promise<void> | undefined;

function banner() {
  let node = document.getElementById(NETWORK_BANNER_ID);
  if (node) return node;

  node = document.createElement('div');
  node.id = NETWORK_BANNER_ID;
  node.className = 'route-network-status';
  node.setAttribute('role', 'status');
  node.setAttribute('aria-live', 'polite');
  document.body.appendChild(node);
  return node;
}

function setNetworkState(online: boolean, announceReconnect = false) {
  const root = document.documentElement;
  root.dataset.routeNetwork = online ? 'online' : 'offline';
  root.classList.toggle('route-offline', !online);

  const node = banner();
  if (onlineHideTimer !== undefined) {
    window.clearTimeout(onlineHideTimer);
    onlineHideTimer = undefined;
  }

  if (!online) {
    node.textContent = '인터넷 연결이 끊겼어요 · 저장된 내용은 그대로 사용할 수 있어요';
    node.dataset.state = 'offline';
    node.classList.add('show');
    return;
  }

  if (announceReconnect) {
    node.textContent = '인터넷이 다시 연결됐어요 · 변경 내용을 동기화하고 있어요';
    node.dataset.state = 'online';
    node.classList.add('show');
    onlineHideTimer = window.setTimeout(() => node.classList.remove('show'), 2600);
  } else {
    node.classList.remove('show');
  }
}

function flushPendingState() {
  if (!navigator.onLine || accountResetInProgress) return;

  if (localStorage.getItem(ALBUM_PENDING_KEY) === '1') {
    try { requestAlbumSyncNow(); } catch (error) { console.warn('[ROUTE reconnect album]', error); }
  }
  try { signalPersistentStateChange(); } catch (error) { console.warn('[ROUTE reconnect backup]', error); }
  window.dispatchEvent(new Event('route-network-restored'));
}

function recoverRestoredBackup() {
  const uid = auth.currentUser?.uid;
  if (!uid || accountResetInProgress) return;
  const key = `${RECOVERY_RELOAD_PREFIX}${uid}`;
  try {
    if (sessionStorage.getItem(key) === '1') return;
    sessionStorage.setItem(key, '1');
  } catch {}

  window.setTimeout(() => window.location.reload(), 80);
}

function clearRecoveryReloadMarkers() {
  try {
    for (let index = sessionStorage.length - 1; index >= 0; index -= 1) {
      const key = sessionStorage.key(index);
      if (key?.startsWith(RECOVERY_RELOAD_PREFIX)) sessionStorage.removeItem(key);
    }
  } catch {}
}

function localDataOwner() {
  try { return localStorage.getItem(LOCAL_DATA_OWNER_KEY) || ''; }
  catch { return ''; }
}

function hasSharedLocalCache() {
  try {
    return ACCOUNT_SHARED_CACHE_KEYS.some((key) => {
      const value = localStorage.getItem(key);
      return value !== null && value !== '' && value !== '[]' && value !== '{}';
    });
  } catch {
    return false;
  }
}

function removeSharedLocalCache(clearOwner: boolean) {
  try {
    ACCOUNT_SHARED_CACHE_KEYS.forEach((key) => {
      if (rawStorageRemoveItem) rawStorageRemoveItem.call(localStorage, key);
      else localStorage.removeItem(key);
    });
    if (clearOwner) {
      if (rawStorageRemoveItem) rawStorageRemoveItem.call(localStorage, LOCAL_DATA_OWNER_KEY);
      else localStorage.removeItem(LOCAL_DATA_OWNER_KEY);
    }
  } catch (error) {
    console.warn('[ROUTE account cache isolation]', error);
  }
}

function setLocalDataOwner(uid: string) {
  try {
    if (rawStorageSetItem) rawStorageSetItem.call(localStorage, LOCAL_DATA_OWNER_KEY, uid);
    else localStorage.setItem(LOCAL_DATA_OWNER_KEY, uid);
  } catch {}
}

async function clearFirestoreAndReload(marker: string) {
  if (accountResetInProgress) return;
  accountResetInProgress = true;
  try { sessionStorage.setItem(ACCOUNT_SWITCH_RELOAD_KEY, marker); } catch {}
  try {
    await clearNativeFirestorePersistence();
  } catch {}
  window.location.reload();
}

async function applyAccountIsolation(uid: string | null, markInitialReady: () => void) {
  if (!uid) {
    clearRecoveryReloadMarkers();
    try { sessionStorage.removeItem(ACCOUNT_SWITCH_RELOAD_KEY); } catch {}
  }

  const previousOwner = localDataOwner();
  const sharedCachePresent = hasSharedLocalCache();
  const action = decideAccountIsolation(previousOwner, sharedCachePresent, uid);

  if (action === 'ready') {
    markInitialReady();
    return;
  }

  if (action === 'adopt-owner') {
    if (uid) setLocalDataOwner(uid);
    markInitialReady();
    return;
  }

  if (action === 'reset-signout') {
    removeSharedLocalCache(true);
    await clearFirestoreAndReload(`signed-out:${previousOwner}`);
    return;
  }

  if (action === 'reset-switch') {
    removeSharedLocalCache(false);
    if (uid) setLocalDataOwner(uid);
    await clearFirestoreAndReload(`account-switch:${uid ?? 'signed-out'}`);
    return;
  }

  if (action === 'reset-orphan') {
    // Builds before ownership tracking used global private message/memory keys.
    // Clear those orphaned caches before React is allowed to mount, even when
    // the first screen is signed out, so a later login can never inherit them.
    removeSharedLocalCache(!uid);
    if (uid) setLocalDataOwner(uid);
    await clearFirestoreAndReload(`orphaned-cache:${uid ?? 'signed-out'}`);
    return;
  }

  markInitialReady();
}

function installRuntimeListeners() {
  if (runtimeListenersInstalled) return;
  runtimeListenersInstalled = true;

  setNetworkState(navigator.onLine);

  window.addEventListener('offline', () => setNetworkState(false));
  window.addEventListener('online', () => {
    setNetworkState(true, true);
    flushPendingState();
  });

  window.addEventListener('route-backup-restored', recoverRestoredBackup);
  window.addEventListener('route-app-resume', () => {
    setNetworkState(navigator.onLine, false);
    flushPendingState();
  });

  window.addEventListener('pageshow', (event) => {
    if ((event as PageTransitionEvent).persisted) {
      setNetworkState(navigator.onLine, false);
      flushPendingState();
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      setNetworkState(navigator.onLine, false);
      flushPendingState();
    }
  });
}

export function initializeRuntimeRecovery() {
  if (runtimeRecoveryPromise) return runtimeRecoveryPromise;
  installRuntimeListeners();

  runtimeRecoveryPromise = new Promise<void>((resolve) => {
    let initialReady = false;
    const markInitialReady = () => {
      if (initialReady) return;
      initialReady = true;
      resolve();
    };

    onAuthStateChanged(auth, (user) => {
      void applyAccountIsolation(user?.uid ?? null, markInitialReady).catch((cause) => {
        console.error('[ROUTE account isolation]', cause);
        if (!accountResetInProgress) markInitialReady();
      });
    }, (cause) => {
      console.error('[ROUTE auth isolation listener]', cause);
      markInitialReady();
    });
  });

  return runtimeRecoveryPromise;
}
