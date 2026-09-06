import { doc, updateDoc } from 'firebase/firestore';
import type { Message } from '../types';
import { db } from './firebase';
import { createLegacyChatMediaReference } from './chatMedia';
import { hasOptimizedChatPreview } from './chatMediaReference';

const MIGRATION_GAP_MS = 850;

type RoomState = {
  coupleId: string;
  ownerUid: string;
  messages: Message[];
  attempted: Set<string>;
  running: boolean;
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
  for (const message of state.messages) {
    if (message.type === 'image' && migratable(message.imageUrl)) {
      const candidate = { message, url: message.imageUrl!, index: 0 };
      if (!state.attempted.has(candidateKey(candidate))) return candidate;
    }
    if (message.type === 'gallery' && message.imageUrls?.length) {
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

function schedule(state: RoomState, delay = MIGRATION_GAP_MS) {
  if (state.running || state.timer !== undefined || document.visibilityState === 'hidden') return;
  if (!nextCandidate(state)) return;
  state.timer = window.setTimeout(() => {
    state.timer = undefined;
    void migrateOne(state);
  }, delay);
}

async function migrateOne(state: RoomState) {
  if (state.running || document.visibilityState === 'hidden') return;
  const candidate = nextCandidate(state);
  if (!candidate) return;

  const attemptKey = candidateKey(candidate);
  state.attempted.add(attemptKey);
  state.running = true;
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
    } else {
      const latest = state.messages.find((message) => message.id === candidate.message.id);
      const currentUrls = latest?.imageUrls ?? candidate.message.imageUrls ?? [];
      const nextUrls = [...currentUrls];
      if (candidate.index < nextUrls.length && nextUrls[candidate.index] === candidate.url) {
        nextUrls[candidate.index] = reference;
        await updateDoc(messageDoc, { imageUrls: nextUrls });
      }
    }
  } catch (error) {
    console.warn('[ROUTE incremental legacy preview]', candidate.message.id, candidate.index, error);
  } finally {
    state.running = false;
    schedule(state);
  }
}

/**
 * Feed only the currently loaded chat window into the migration queue. This
 * avoids a full Firestore history scan and converts at most one legacy photo per
 * idle gap. As pagination reveals older messages they naturally join the queue.
 */
export function migrateLoadedLegacyChatMedia(coupleId: string, ownerUid: string, messages: Message[]) {
  if (!coupleId || !ownerUid || !messages.length) return;
  const key = roomKey(coupleId, ownerUid);
  const existing = rooms.get(key);
  const state = existing ?? {
    coupleId,
    ownerUid,
    messages: [],
    attempted: new Set<string>(),
    running: false,
  };
  state.messages = messages;
  rooms.set(key, state);
  schedule(state, 250);
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  rooms.forEach((state) => schedule(state, 300));
});
