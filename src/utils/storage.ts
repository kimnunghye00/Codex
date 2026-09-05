import type { Memory, Message } from '../types';

const MESSAGE_KEY = 'route.messages.v2';
const MEMORY_KEY = 'route.memories.v2';
const MEMORY_CHANGE_EVENT = 'route-memories-local-change';

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

// Real-couple testing starts with a clean slate. Old MELUNI/SAI demo keys are intentionally ignored.
export const loadMessages = (_fallback: Message[]) => load<Message[]>(MESSAGE_KEY, []);
export const saveMessages = (messages: Message[]) => { void save(MESSAGE_KEY, messages); };
export const loadMemories = (_fallback: Memory[]) => load<Memory[]>(MEMORY_KEY, []);
export const saveMemories = (memories: Memory[]) => {
  if (save(MEMORY_KEY, memories)) window.dispatchEvent(new Event(MEMORY_CHANGE_EVENT));
};
