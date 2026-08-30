import type { Memory, Message } from '../types';

const MESSAGE_KEY = 'route.messages.v2';
const MEMORY_KEY = 'route.memories.v2';

function load<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) as T : fallback;
  } catch {
    return fallback;
  }
}

function save<T>(key: string, value: T) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage may be unavailable */ }
}

// Real-couple testing starts with a clean slate. Old MELUNI/SAI demo keys are intentionally ignored.
export const loadMessages = (_fallback: Message[]) => load<Message[]>(MESSAGE_KEY, []);
export const saveMessages = (messages: Message[]) => save(MESSAGE_KEY, messages);
export const loadMemories = (_fallback: Memory[]) => load<Memory[]>(MEMORY_KEY, []);
export const saveMemories = (memories: Memory[]) => save(MEMORY_KEY, memories);
