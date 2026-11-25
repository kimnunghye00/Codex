import type { Message } from '../types';
import type { ScheduledChatDraft } from '../lib/scheduledChat';

export function recentChatPhotos(messages: Message[], count = 4): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (let index = messages.length - 1; index >= 0 && result.length < count; index--) {
    const message = messages[index];
    const urls = message.type === 'image' && message.imageUrl ? [message.imageUrl] : message.type === 'gallery' ? message.imageUrls ?? [] : [];
    for (let i = urls.length - 1; i >= 0 && result.length < count; i--) {
      const url = urls[i];
      if (url && !seen.has(url)) { seen.add(url); result.push(url); }
    }
  }
  return result;
}

export function visibleScheduledDrafts(items: ScheduledChatDraft[], coupleId?: string): ScheduledChatDraft[] {
  return items.filter(item => !item.coupleId || item.coupleId === coupleId);
}
