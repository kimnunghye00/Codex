import type { Memory, Message } from '../types';
import { loadMemories, saveMemories } from './storage';

const CHAT_MEMORY_TAG_PREFIX = 'chat-message:';
const MEMORY_REFRESH_EVENT = 'route-memories-remote-change';

export function isChatMediaMessage(message: Message) {
  return message.type === 'image' || message.type === 'gallery' || message.type === 'gif';
}

function mediaUrls(message: Message) {
  if (message.type === 'gallery') return (message.imageUrls ?? []).filter(Boolean);
  return message.imageUrl ? [message.imageUrl] : [];
}

function localDateKey(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return new Date().toISOString().slice(0, 10);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function chatMemoryTag(messageId: number) {
  return `${CHAT_MEMORY_TAG_PREFIX}${messageId}`;
}

export function loadChatMemoryMessageIds() {
  const ids = new Set<number>();
  for (const memory of loadMemories([])) {
    for (const tag of memory.tags ?? []) {
      if (!tag.startsWith(CHAT_MEMORY_TAG_PREFIX)) continue;
      const id = Number(tag.slice(CHAT_MEMORY_TAG_PREFIX.length));
      if (Number.isFinite(id)) ids.add(id);
    }
  }
  return ids;
}

export function replaceChatMemoryMediaReference(messageId: number, previousUrl: string, nextUrl: string) {
  if (!previousUrl || !nextUrl || previousUrl === nextUrl) return false;
  const tag = chatMemoryTag(messageId);
  const current = loadMemories([]);
  let changed = false;
  const next = current.map((memory) => {
    if (!memory.tags?.includes(tag)) return memory;
    const images = memory.images.map((url) => {
      if (url !== previousUrl) return url;
      changed = true;
      return nextUrl;
    });
    return changed ? { ...memory, images } : memory;
  });

  if (!changed) return false;
  saveMemories(next);
  window.dispatchEvent(new CustomEvent<Memory[]>(MEMORY_REFRESH_EVENT, { detail: next }));
  return true;
}

export function toggleChatMessageMemory(message: Message, partnerName: string) {
  if (!isChatMediaMessage(message)) return { saved: Boolean(message.saved), memories: loadMemories([]) };

  const urls = mediaUrls(message);
  if (!urls.length) return { saved: false, memories: loadMemories([]) };

  const tag = chatMemoryTag(message.id);
  const current = loadMemories([]);
  const existing = current.find((memory) => memory.tags?.includes(tag));

  let next: Memory[];
  let saved: boolean;
  if (existing) {
    next = current.filter((memory) => memory.id !== existing.id);
    saved = false;
  } else {
    const memory: Memory = {
      // Chat message ids are timestamp based and positive. Negative ids keep these
      // generated album records separate from memories created in MemoryForm.
      id: -Math.abs(message.id || Date.now()),
      title: message.sender === 'partner' ? `${partnerName}와의 채팅 사진` : '채팅에서 남긴 추억',
      date: localDateKey(message.timestamp),
      description: urls.length > 1 ? `ROUTE 대화에서 저장한 사진 ${urls.length}장` : 'ROUTE 대화에서 저장한 사진',
      images: urls,
      createdBy: message.sender,
      tags: ['채팅', tag],
      favorite: false,
    };
    next = [memory, ...current];
    saved = true;
  }

  saveMemories(next);
  // App already consumes this event for cloud-originated album changes. Reusing
  // it here updates the mounted album/home state immediately without a reload.
  window.dispatchEvent(new CustomEvent<Memory[]>(MEMORY_REFRESH_EVENT, { detail: next }));
  return { saved, memories: next };
}
