export type ActivityActor = 'me' | 'partner' | 'system';
export type ActivityKind = 'chat' | 'memory' | 'profile' | 'couple' | 'anniversary' | 'location' | 'system';

export type AppNotification = {
  id: string;
  actor: ActivityActor;
  kind: ActivityKind;
  title: string;
  detail?: string;
  createdAt: string;
  read: boolean;
};

const keyFor = (uid: string) => `meluni-notifications:${uid}`;
const MAX_ITEMS = 200;

export function loadNotifications(uid: string): AppNotification[] {
  try {
    const raw = localStorage.getItem(keyFor(uid));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as AppNotification[];
    return Array.isArray(parsed) ? parsed.slice(0, MAX_ITEMS) : [];
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
