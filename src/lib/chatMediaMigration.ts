import { doc, updateDoc } from 'firebase/firestore';
import type { Message } from '../types';
import { replaceChatMemoryMediaReference } from '../utils/featureFlow';
import { db } from './firebase';
import { createLegacyChatMediaReference } from './chatMedia';
import { hasOptimizedChatPreview } from './chatMediaReference';

const MIGRATION_GAP_MS = 180;
const MAX_CONCURRENT_MIGRATIONS = 2;

type RoomState = {
  coupleId: string;
  ownerUid: string;
  messages: Message[];
  attempted: Set<string>;
  active: number;
  timer?: number;
};

type Candidate = {
  message: Message;
  url: string;
  index: number;
};

const rooms = new Map<string, RoomState>();

function roomKey(coupleId: string, ownerUid: string) {
  return `${coupleId}:${ownerUid}`;
}

function migratable(value?: string) {
  return Boolean(value && !value.startsWith('blob:') && !value.startsWith('data:') && !hasOptimizedChatPreview(value));
}

function candidateKey(candidate: Candidate) {
  return `${candidate.message.id}:${candidate.index}:${candidate.url}`;
}

function nextCandidate(state: RoomState): Candidate | undefined {
  // Chat is anchored at the newest messages. Migrate from the bottom of the
  // loaded page first so the photos the user can actually see become available
  // before older off-screen media.
  for (let messageIndex = state.messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = state.messages[messageIndex];
    if (message.type === 'image' && migratable(message.imageUrl)) {
      const candidate = { message, url: message.imageUrl!, index: 0 };
      if (!state.attempted.has(candidateKey(candidate))) return candidate;
    }
    if (message.type === 'gallery' && message.imageUrls?.length) {
      // The first four gallery cells are rendered inline, so optimize them first.
      for (let index = 0; index < message.imageUrls.length; index += 1) {
        const url = message.imageUrls[index];
        if (!migratable(url)) continue;
        const candidate = { message, url, index };
        if (!state.attempted.has(candidateKey(candidate))) return candidate;
      }
    }
  }
  return undefined;
}

function schedulePump(state: RoomState, delay = MIGRATION_GAP_MS) {
  if (state.timer !== undefined || document.visibilityState === 'hidden') return;
  if (state.active >= MAX_CONCURRENT_MIGRATIONS || !nextCandidate(state)) return;
  state.timer = window.setTimeout(() => {
    state.timer = undefined;
    pump(state);
  }, delay);
}

function pump(state: RoomState) {
  if (document.visibilityState === 'hidden') return;

  while (state.active < MAX_CONCURRENT_MIGRATIONS) {
    const candidate = nextCandidate(state);
    if (!candidate) break;
    state.attempted.add(candidateKey(candidate));
    state.active += 1;
    void migrateCandidate(state, candidate);
  }
}

async function migrateCandidate(state: RoomState, candidate: Candidate) {
  try {
    const reference = await createLegacyChatMediaReference(
      state.coupleId,
      state.ownerUid,
      candidate.message.id,
      candidate.index,
      candidate.url,
    );

    const messageDoc = doc(db, 'couples', state.coupleId, 'messages', String(candidate.message.id));
    if (candidate.message.type === 'image') {
      await updateDoc(messageDoc, { imageUrl: reference });
      replaceChatMemoryMediaReference(candidate.message.id, candidate.url, reference);
    } else {
      const latest = state.messages.find((message) => message.id === candidate.message.id);
      const currentUrls = latest?.imageUrls ?? candidate.message.imageUrls ?? [];
      const nextUrls = [...currentUrls];
      if (candidate.index < nextUrls.length && nextUrls[candidate.index] === candidate.url) {
        nextUrls[candidate.index] = reference;
        await updateDoc(messageDoc, { imageUrls: nextUrls });
        replaceChatMemoryMediaReference(candidate.message.id, candidate.url, reference);
      }
    }
  } catch (error) {
    console.warn('[ROUTE incremental legacy preview]', candidate.message.id, candidate.index, error);
  } finally {
    state.active = Math.max(0, state.active - 1);
    schedulePump(state);
  }
}

export function migrateLoadedLegacyChatMedia(coupleId: string, ownerUid: string, messages: Message[]) {
  if (!coupleId || !ownerUid || !messages.length) return;
  const key = roomKey(coupleId, ownerUid);
  const existing = rooms.get(key);
  const state = existing ?? {
    coupleId,
    ownerUid,
    messages: [],
    attempted: new Set<string>(),
    active: 0,
  };
  state.messages = messages;
  rooms.set(key, state);
  schedulePump(state, 80);
}

/**
 * Backward-compatible no-op for older chatRealtime wiring. The actual migration
 * is driven by migrateLoadedLegacyChatMedia(), which only sees the paged messages
 * already loaded in the room and therefore never performs a full history scan.
 */
export async function startLegacyChatMediaMigration(_coupleId: string, _ownerUid: string) {
  return Promise.resolve();
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  rooms.forEach((state) => schedulePump(state, 120));
});
