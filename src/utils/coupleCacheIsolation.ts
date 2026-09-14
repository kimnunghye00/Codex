// Disposable views of shared server records. Clearing a view must not create
// deletion tombstones or remove either person's original server records.
const sharedKeys = ['route.messages.v2', 'route.memories.v2', 'route.memories.deleted.v1', 'route.albumSync.pending'];
const sessionScopes = new Map<string, string>();

export function transitionCoupleCache(uid: string, coupleId: string | null): boolean {
  const key = `route.coupleCache.scope:${uid}`;
  const next = coupleId ?? '';
  let previous = sessionScopes.get(uid);
  try { previous ??= localStorage.getItem(key) ?? undefined; } catch { /* Session fallback below. */ }
  const changed = Boolean(previous && previous !== next);
  sessionScopes.set(uid, next);
  try {
    if (changed) sharedKeys.forEach((item) => localStorage.removeItem(item));
    localStorage.setItem(key, next);
  } catch { /* React state must still clear if browser storage is unavailable. */ }
  return changed;
}
