import type { Memory, Message } from '../types';

const MESSAGE_KEY = 'route.messages.v2';
const MEMORY_KEY = 'route.memories.v2';
export const MEMORY_DELETED_KEY = 'route.memories.deleted.v1';
const MEMORY_CHANGE_EVENT = 'route-memories-local-change';
const CHAT_CACHE_LIMIT = 40;
const MEMORY_CACHE_LIMIT = 60;

export type MemoryDeletionMap = Record<string, string>;

function load<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) as T : fallback;
  } catch {
    return fallback;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function cachedMessages(): Message[] {
  const stored = load<unknown>(MESSAGE_KEY, []);
  if (!Array.isArray(stored)) return [];
  return stored.filter((item): item is Message => isRecord(item)
    && Number.isSafeInteger(item.id) && typeof item.timestamp === 'string'
    && (item.sender === 'me' || item.sender === 'partner')
    && ['text', 'image', 'gallery', 'gif'].includes(String(item.type)))
    .map((item) => ({
      ...item,
      text: typeof item.text === 'string' ? item.text : undefined,
      imageUrl: typeof item.imageUrl === 'string' ? item.imageUrl : undefined,
      imageUrls: item.imageUrls === undefined ? undefined : stringList(item.imageUrls),
      reactions: Array.isArray(item.reactions) ? item.reactions.filter((reaction) => isRecord(reaction)
        && typeof reaction.emoji === 'string' && (reaction.by === 'me' || reaction.by === 'partner')) : undefined,
    }));
}

function cachedMemories(): Memory[] {
  const stored = load<unknown>(MEMORY_KEY, []);
  if (!Array.isArray(stored)) return [];
  return stored.filter((item) => isRecord(item) && Number.isSafeInteger(item.id))
    .map((item) => ({
      ...item,
      title: typeof item.title === 'string' ? item.title : '',
      date: typeof item.date === 'string' ? item.date : '',
      description: typeof item.description === 'string' ? item.description : '',
      images: stringList(item.images),
      videos: item.videos === undefined ? undefined : stringList(item.videos),
      tags: item.tags === undefined ? undefined : stringList(item.tags),
      createdBy: item.createdBy === 'partner' ? 'partner' : 'me',
    } as Memory));
}

function save<T>(key: string, value: T) {
  try {
    const next = JSON.stringify(value);
    if (localStorage.getItem(key) === next) return false;
    localStorage.setItem(key, next);
    return true;
  } catch {
    return false;
  }
}

function isEphemeralMediaUrl(value?: string) {
  return Boolean(value && (value.startsWith('data:') || value.startsWith('blob:')));
}

/**
 * Base64/blob chat media can be several megabytes per photo. Persisting those
 * strings in localStorage makes every later message write stringify and copy the
 * full image payload again, which can freeze Android WebView after a gallery is
 * sent. Firebase/HTTP media URLs remain persistent; session-only media stays in
 * React state but is intentionally excluded from the local cache.
 */
function sanitizeMessagesForStorage(messages: Message[]) {
  return messages.filter((message) => {
    if ((message.type === 'image' || message.type === 'gif') && isEphemeralMediaUrl(message.imageUrl)) return false;
    if (message.type === 'gallery' && message.imageUrls?.some(isEphemeralMediaUrl)) return false;
    return true;
  });
}

function recentChatCache(messages: Message[]) {
  return sanitizeMessagesForStorage(messages).slice(-CHAT_CACHE_LIMIT);
}

/**
 * Memories can carry temporary blob:/data: URLs while a photo/video is still
 * being uploaded (see MemoryForm's preview handling). Unlike chat, this path
 * had no protection at all: a single in-flight upload could persist several
 * megabytes of base64 per item into localStorage, and every subsequent
 * unrelated save (favoriting a memory, editing a title, etc.) would then
 * re-stringify and rewrite that same multi-megabyte payload. Repeated over a
 * session this is exactly the kind of steady, generic memory growth that
 * eventually crashes the tab with "Out of Memory" - it is not tied to any one
 * screen because saveMemories() is called from the top-level App effect
 * whenever `memories` changes, regardless of which tab is open.
 */
function sanitizeMemoriesForStorage(memories: Memory[]) {
  return memories.map((memory) => ({
    ...memory,
    images: (memory.images ?? []).filter((url) => !isEphemeralMediaUrl(url)),
    videos: memory.videos?.filter((url) => !isEphemeralMediaUrl(url)),
  }));
}

function recentMemoryCache(memories: Memory[]) {
  // Firestore's couple-scoped memories collection is the durable source of
  // truth (see subscribeCoupleMemories in App.tsx); this cache only needs to
  // cover the fast first paint before that listener resolves.
  return sanitizeMemoriesForStorage(memories.slice(0, MEMORY_CACHE_LIMIT));
}

export function loadDeletedMemories(): MemoryDeletionMap {
  const stored = load<unknown>(MEMORY_DELETED_KEY, {});
  if (!isRecord(stored)) return {};
  return Object.fromEntries(Object.entries(stored).filter(([, value]) => typeof value === 'string')) as MemoryDeletionMap;
}

export function saveDeletedMemories(value: MemoryDeletionMap) {
  save(MEMORY_DELETED_KEY, value);
}

export function recordDeletedMemory(id: string | number) {
  const deleted = loadDeletedMemories();
  deleted[String(id)] = new Date().toISOString();
  saveDeletedMemories(deleted);
}

function reconcileDeletionMap(previous: Memory[], next: Memory[]) {
  const nextIds = new Set(next.map((memory) => String(memory.id)));
  const deleted = loadDeletedMemories();
  let changed = false;

  for (const memory of previous) {
    const id = String(memory.id);
    if (!nextIds.has(id) && !deleted[id]) {
      deleted[id] = new Date().toISOString();
      changed = true;
    }
  }

  // A newly-created memory should not inherit an ancient tombstone if an id is reused.
  for (const id of nextIds) {
    if (deleted[id] && !previous.some((memory) => String(memory.id) === id)) {
      delete deleted[id];
      changed = true;
    }
  }

  if (changed) saveDeletedMemories(deleted);
  return changed;
}

// Real-couple testing starts with a clean slate. Old MELUNI/SAI demo keys are intentionally ignored.
export const loadMessages = (_fallback: Message[]) => {
  const stored = cachedMessages();
  const recent = recentChatCache(stored);
  // Migrate away both old base64 galleries and oversized chat-history caches.
  save(MESSAGE_KEY, recent);
  return recent;
};
export const saveMessages = (messages: Message[]) => {
  // Firestore is the durable chat history. Local storage is only a fast startup
  // cache, so keeping the latest page prevents Android WebView from parsing a
  // growing multi-year conversation every time the app starts.
  save(MESSAGE_KEY, recentChatCache(messages));
};
export const loadMemories = (_fallback: Memory[]) => {
  const deleted = loadDeletedMemories();
  const stored = cachedMemories();
  const cleaned = recentMemoryCache(stored);
  // Rewrite immediately so an old cache saved before this fix (which could
  // hold embedded base64 photos with no size cap) never gets read again.
  save(MEMORY_KEY, cleaned);
  return cleaned.filter((memory) => !deleted[String(memory.id)]);
};
export const saveMemories = (memories: Memory[]) => {
  const previous = cachedMemories();
  const deletionsChanged = reconcileDeletionMap(previous, memories);
  const memoriesChanged = save(MEMORY_KEY, recentMemoryCache(memories));
  if (memoriesChanged || deletionsChanged) {
    window.dispatchEvent(new CustomEvent(MEMORY_CHANGE_EVENT, {
      detail: { deleted: deletionsChanged },
    }));
  }
};
