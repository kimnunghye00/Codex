import { onAuthStateChanged } from 'firebase/auth';
import { auth } from './lib/firebase';
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

// Capture the native Storage methods before bootstrap installs ROUTE's persistence
// observer. Account-isolation cleanup must not look like a user edit and trigger a
// backup of another account's cleared cache during an auth transition.
const rawStorageSetItem = typeof Storage !== 'undefined' ? Storage.prototype.setItem : undefined;
const rawStorageRemoveItem = typeof Storage !== 'undefined' ? Storage.prototype.removeItem : undefined;
let onlineHideTimer: number | undefined;

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
  if (!navigator.onLine) return;

  // Album sync can upload media, so only retry it when the album layer itself
  // recorded a pending local change. Backup signaling is cheap: its own snapshot
  // guard prevents network writes when nothing changed.
  if (localStorage.getItem(ALBUM_PENDING_KEY) === '1') {
    try { requestAlbumSyncNow(); } catch (error) { console.warn('[ROUTE reconnect album]', error); }
  }
  try { signalPersistentStateChange(); } catch (error) { console.warn('[ROUTE reconnect backup]', error); }
  window.dispatchEvent(new Event('route-network-restored'));
}

function recoverRestoredBackup() {
  const uid = auth.currentUser?.uid;
  if (!uid) return;
  const key = `${RECOVERY_RELOAD_PREFIX}${uid}`;
  try {
    if (sessionStorage.getItem(key) === '1') return;
    sessionStorage.setItem(key, '1');
  } catch {
    // A reload is still safer than leaving React mounted with stale pre-restore state.
  }

  // Login-time backup restoration happens after React may already have read the
  // empty device cache. Reload once so the restored profile/messages/memories
  // become the app's initial state. The session marker prevents a reload loop.
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

function prepareAccountLocalCache(uid: string) {
  let previousOwner = '';
  try { previousOwner = localStorage.getItem(LOCAL_DATA_OWNER_KEY) || ''; } catch {}

  if (!previousOwner) {
    try {
      if (rawStorageSetItem) rawStorageSetItem.call(localStorage, LOCAL_DATA_OWNER_KEY, uid);
      else localStorage.setItem(LOCAL_DATA_OWNER_KEY, uid);
    } catch {}
    return false;
  }

  if (previousOwner === uid) return false;

  try {
    ACCOUNT_SHARED_CACHE_KEYS.forEach((key) => {
      if (rawStorageRemoveItem) rawStorageRemoveItem.call(localStorage, key);
      else localStorage.removeItem(key);
    });
    if (rawStorageSetItem) rawStorageSetItem.call(localStorage, LOCAL_DATA_OWNER_KEY, uid);
    else localStorage.setItem(LOCAL_DATA_OWNER_KEY, uid);
  } catch (error) {
    console.warn('[ROUTE account cache isolation]', error);
  }

  return true;
}

function reloadForAccountSwitch(uid: string) {
  try {
    const marker = sessionStorage.getItem(ACCOUNT_SWITCH_RELOAD_KEY);
    if (marker === uid) return;
    sessionStorage.setItem(ACCOUNT_SWITCH_RELOAD_KEY, uid);
  } catch {}
  window.setTimeout(() => window.location.reload(), 0);
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
      try { sessionStorage.removeItem(ACCOUNT_SWITCH_RELOAD_KEY); } catch {}
      return;
    }

    if (prepareAccountLocalCache(user.uid)) reloadForAccountSwitch(user.uid);
  });
}

installRuntimeRecovery();
