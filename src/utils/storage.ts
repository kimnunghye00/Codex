import type { Memory, Message } from '../types';

const MESSAGE_KEY = 'sai.messages.v1';
const MEMORY_KEY = 'sai.memories.v1';
const MOOD_KEY = 'sai.mood.v1';

export type Mood = { emoji: string; label: string };

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

export const loadMessages = (fallback: Message[]) => load(MESSAGE_KEY, fallback);
export const saveMessages = (messages: Message[]) => save(MESSAGE_KEY, messages);
export const loadMemories = (fallback: Memory[]) => load(MEMORY_KEY, fallback);
export const saveMemories = (memories: Memory[]) => save(MEMORY_KEY, memories);
export const loadMood = (fallback: Mood) => load(MOOD_KEY, fallback);
export const saveMood = (mood: Mood) => save(MOOD_KEY, mood);
