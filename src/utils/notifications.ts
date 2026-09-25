export type ActivityActor = 'me' | 'partner' | 'system';
export type ActivityKind = 'chat' | 'memory' | 'profile' | 'couple' | 'anniversary' | 'location' | 'call' | 'system' | 'date-plan';
export type NotificationDestination = { screen: 'chat' | 'album' | 'date-plan'; itemId: string };

export type AppNotification = {
  id: string;
  actor: ActivityActor;
  kind: ActivityKind;
  title: string;
  detail?: string;
  createdAt: string;
  read: boolean;
  target?: NotificationDestination;
};

const keyFor = (uid: string) => `meluni-notifications:${uid}`;
const MAX_ITEMS = 200;

export function loadNotifications(uid: string): AppNotification[] {
  try {
    const raw = localStorage.getItem(keyFor(uid));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as AppNotification[];
    return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item.id === 'string').slice(0, MAX_ITEMS) : [];
  } catch {
    return [];
  }
}

export function saveNotifications(uid: string, items: AppNotification[]) {
  localStorage.setItem(keyFor(uid), JSON.stringify(items.slice(0, MAX_ITEMS)));
}

export function makeNotification(input: Omit<AppNotification, 'id' | 'createdAt' | 'read'>): AppNotification {
  return {
    ...input,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    read: false,
  };
}

export function markAllNotificationsRead(items: AppNotification[]) {
  return items.map((item) => ({ ...item, read: true }));
}


/** Preserve local read state and de-duplicate remote activity by stable ID. */
export function mergePartnerNotifications(local: AppNotification[], incoming: AppNotification[]): AppNotification[] {
  const items = new Map(local.map((item) => [item.id, item]));
  for (const event of incoming) {
    const existing = items.get(event.id);
    if (existing) items.set(event.id, { ...event, read: existing.read });
    else items.set(event.id, event);
  }
  return [...items.values()].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, MAX_ITEMS);
}

/** Never accept arbitrary URLs or paths from an activity document. */
export function notificationDestination(value: unknown): NotificationDestination | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as { screen?: unknown; itemId?: unknown };
  if (!['chat', 'album', 'date-plan'].includes(String(input.screen))) return null;
  if (typeof input.itemId !== 'string' || !/^[a-zA-Z0-9_-]{1,160}$/.test(input.itemId)) return null;
  if ((input.screen === 'chat' || input.screen === 'album') && !/^\d{1,18}$/.test(input.itemId)) return null;
  return { screen: input.screen as NotificationDestination['screen'], itemId: input.itemId };
}

export function notificationRouteUrl(target: NotificationDestination): string {
  const params = new URLSearchParams({ open: target.screen, item: target.itemId });
  return '/?' + params.toString();
}
