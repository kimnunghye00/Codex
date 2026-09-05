export const PERSISTENT_STATE_CHANGE_EVENT = 'route-persistent-state-change';

const OBSERVED_KEYS = new Set([
  'route.messages.v2',
  'route.memories.v2',
  'route.memories.deleted.v1',
]);

const OBSERVED_PREFIXES = [
  'meluni-profile:',
  'meluni-location-visits:',
  'meluni-location-sharing:',
  'route-scheduled-chat:',
  'route-date-plans:',
  'route-local-schedules:',
];

let storageObserverInstalled = false;

function shouldSignal(key: string) {
  return OBSERVED_KEYS.has(key) || OBSERVED_PREFIXES.some((prefix) => key.startsWith(prefix));
}

export function signalPersistentStateChange() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(PERSISTENT_STATE_CHANGE_EVENT));
}

export function installPersistentStorageObserver() {
  if (storageObserverInstalled || typeof window === 'undefined' || typeof Storage === 'undefined') return;
  storageObserverInstalled = true;

  const originalSetItem = Storage.prototype.setItem;
  const originalRemoveItem = Storage.prototype.removeItem;

  Storage.prototype.setItem = function setItem(key: string, value: string) {
    originalSetItem.call(this, key, value);
    if (this === window.localStorage && shouldSignal(key)) signalPersistentStateChange();
  };

  Storage.prototype.removeItem = function removeItem(key: string) {
    const existed = this === window.localStorage && localStorage.getItem(key) !== null;
    originalRemoveItem.call(this, key);
    if (existed && shouldSignal(key)) signalPersistentStateChange();
  };
}
