import type { Memory, Message } from '../types';

const MESSAGE_KEY = 'meluni.messages.v1';
const MEMORY_KEY = 'meluni.memories.v1';
const LEGACY_MESSAGE_KEY = 'sai.messages.v1';
const LEGACY_MEMORY_KEY = 'sai.memories.v1';

function load<T>(key: string, legacyKey: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    if (value) return JSON.parse(value) as T;

    const legacyValue = localStorage.getItem(legacyKey);
    if (!legacyValue) return fallback;

    const migrated = JSON.parse(legacyValue) as T;
    localStorage.setItem(key, legacyValue);
    return migrated;
  } catch {
    return fallback;
  }
}

function save<T>(key: string, value: T) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage may be unavailable */ }
}

export const loadMessages = (fallback: Message[]) => load(MESSAGE_KEY, LEGACY_MESSAGE_KEY, fallback);
export const saveMessages = (messages: Message[]) => save(MESSAGE_KEY, messages);
export const loadMemories = (fallback: Memory[]) => load(MEMORY_KEY, LEGACY_MEMORY_KEY, fallback);
export const saveMemories = (memories: Memory[]) => save(MEMORY_KEY, memories);
