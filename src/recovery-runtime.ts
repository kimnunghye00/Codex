import { onAuthStateChanged } from 'firebase/auth';
import { auth, clearNativeFirestorePersistence } from './lib/firebase';
import { requestAlbumSyncNow } from './lib/crossDeviceAlbumSync';
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

// Capture native Storage methods before bootstrap installs ROUTE's persistence
// observer. Account-isolation cleanup must not look like a user edit and trigger
// a backup of another account's cleared cache during an auth transition.
const rawStorageSetItem = typeof Storage !== 'undefined' ? Storage.prototype.setItem : undefined;
const rawStorageRemoveItem = typeof Storage !== 'undefined' ? Storage.prototype.removeItem : undefined;
let onlineHideTimer: number | undefined;
let accountResetInProgress = false;

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
  } catch {
    // A reload is still safer than leaving React mounted with stale pre-restore state.
  }

  window.setTimeout(() => window.location.reload(), 80);
}

function clearRecoveryReloadMarkers() {
  try {
    for (let index = sessionStorage.length - 1; index >= 0; index -= 1) {
      const key = sessionStorage.key(index);
      if (key?.startsWith(RECOVERY_RELOAD_PREFIX)) sessionStorage.removeItem(key);
    }
  } catch {
    // Session storage is only a loop guard, never user data.
  }
}

function localDataOwner() {
  try { return localStorage.getItem(LOCAL_DATA_OWNER_KEY) || ''; }
  catch { return ''; }
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
  } catch {
    // Reload still reinitializes Firestore. The warning was logged by firebase.ts.
  }
  window.location.reload();
}

function prepareAccountLocalCache(uid: string) {
  const previousOwner = localDataOwner();
  if (!previousOwner) {
    setLocalDataOwner(uid);
    return false;
  }
  if (previousOwner === uid) return false;

  removeSharedLocalCache(false);
  setLocalDataOwner(uid);
  return true;
}

function installRuntimeRecovery() {
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

  onAuthStateChanged(auth, (user) => {
    if (!user) {
      clearRecoveryReloadMarkers();
      const previousOwner = localDataOwner();
      try { sessionStorage.removeItem(ACCOUNT_SWITCH_RELOAD_KEY); } catch {}
      if (!previousOwner) return;

      // Sign-out is a privacy boundary: clear ROUTE's shared local cache and the
      // persistent Firestore cache before another account can use this WebView.
      removeSharedLocalCache(true);
      void clearFirestoreAndReload(`signed-out:${previousOwner}`);
      return;
    }

    if (prepareAccountLocalCache(user.uid)) {
      // Direct A -> B account switches also clear Firestore's IndexedDB cache.
      void clearFirestoreAndReload(user.uid);
    }
  });
}

installRuntimeRecovery();
