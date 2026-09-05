export const PERSISTENT_STATE_CHANGE_EVENT = 'route-persistent-state-change';

export function signalPersistentStateChange() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(PERSISTENT_STATE_CHANGE_EVENT));
}
