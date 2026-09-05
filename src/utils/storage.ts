import type { Memory, Message } from '../types';
import { signalPersistentStateChange } from './persistenceSignal';

const MESSAGE_KEY = 'route.messages.v2';
const MEMORY_KEY = 'route.memories.v2';
export const MEMORY_DELETED_KEY = 'route.memories.deleted.v1';
const MEMORY_CHANGE_EVENT = 'route-memories-local-change';

export type MemoryDeletionMap = Record<string, string>;

function load<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) as T : fallback;
  } catch {
    return fallback;
  }
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

export function loadDeletedMemories(): MemoryDeletionMap {
  return load<MemoryDeletionMap>(MEMORY_DELETED_KEY, {});
}

export function saveDeletedMemories(value: MemoryDeletionMap) {
  if (save(MEMORY_DELETED_KEY, value)) signalPersistentStateChange();
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
export const loadMessages = (_fallback: Message[]) => load<Message[]>(MESSAGE_KEY, []);
export const saveMessages = (messages: Message[]) => {
  if (save(MESSAGE_KEY, messages)) signalPersistentStateChange();
};
export const loadMemories = (_fallback: Memory[]) => {
  const deleted = loadDeletedMemories();
  return load<Memory[]>(MEMORY_KEY, []).filter((memory) => !deleted[String(memory.id)]);
};
export const saveMemories = (memories: Memory[]) => {
  const previous = load<Memory[]>(MEMORY_KEY, []);
  const deletionsChanged = reconcileDeletionMap(previous, memories);
  const memoriesChanged = save(MEMORY_KEY, memories);
  if (memoriesChanged || deletionsChanged) {
    signalPersistentStateChange();
    window.dispatchEvent(new CustomEvent(MEMORY_CHANGE_EVENT, {
      detail: { deleted: deletionsChanged },
    }));
  }
};
