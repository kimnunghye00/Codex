import { collection, getDocs, orderBy, query, updateDoc, doc } from 'firebase/firestore';
import { db } from './firebase';
import { createLegacyChatMediaReference } from './chatMedia';
import { hasOptimizedChatPreview } from './chatMediaReference';

const runningRooms = new Map<string, Promise<void>>();
const completedRooms = new Set<string>();
const MEDIA_CONCURRENCY = 2;

type LegacyCloudMessage = {
  id?: number;
  type?: 'text' | 'image' | 'gallery' | 'gif';
  imageUrl?: string;
  imageUrls?: string[];
};

function isMigratableReference(value?: string) {
  return Boolean(value && !value.startsWith('blob:') && !hasOptimizedChatPreview(value));
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, worker: (item: T, index: number) => Promise<R>) {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

async function migrateMessage(coupleId: string, migrationOwnerUid: string, snapshotId: string, data: LegacyCloudMessage) {
  const messageId = Number(data.id || snapshotId);
  if (!Number.isFinite(messageId)) return false;

  if (data.type === 'image' && isMigratableReference(data.imageUrl)) {
    const next = await createLegacyChatMediaReference(coupleId, migrationOwnerUid, messageId, 0, data.imageUrl!);
    await updateDoc(doc(db, 'couples', coupleId, 'messages', snapshotId), { imageUrl: next });
    return true;
  }

  if (data.type === 'gallery' && data.imageUrls?.some(isMigratableReference)) {
    const originals = data.imageUrls;
    const next = await mapWithConcurrency(originals, MEDIA_CONCURRENCY, async (url, index) => {
      if (!isMigratableReference(url)) return url;
      try {
        return await createLegacyChatMediaReference(coupleId, migrationOwnerUid, messageId, index, url);
      } catch (error) {
        console.warn('[ROUTE legacy chat preview item]', messageId, index, error);
        return url;
      }
    });
    if (next.some((url, index) => url !== originals[index])) {
      await updateDoc(doc(db, 'couples', coupleId, 'messages', snapshotId), { imageUrls: next });
      return true;
    }
  }

  return false;
}

/**
 * One-time-in-this-session migration for pre-preview chat photos.
 *
 * The old original URL is never overwritten in Storage or deleted. We download
 * it once, create a tiny derivative, upload only that derivative, then store a
 * reference that carries both URLs. New and migrated clients therefore render
 * only the preview while the explicit download action still resolves to the
 * untouched original.
 */
export function startLegacyChatMediaMigration(coupleId: string, migrationOwnerUid: string) {
  const roomKey = `${coupleId}:${migrationOwnerUid}`;
  if (completedRooms.has(roomKey)) return Promise.resolve();
  const existing = runningRooms.get(roomKey);
  if (existing) return existing;

  const task = (async () => {
    let hadFailure = false;
    try {
      const snapshot = await getDocs(query(
        collection(db, 'couples', coupleId, 'messages'),
        orderBy('timestamp', 'desc'),
      ));
      const candidates = snapshot.docs.filter((item) => {
        const data = item.data() as LegacyCloudMessage;
        return (data.type === 'image' && isMigratableReference(data.imageUrl))
          || (data.type === 'gallery' && data.imageUrls?.some(isMigratableReference));
      });

      let completed = 0;
      for (const item of candidates) {
        try {
          await migrateMessage(coupleId, migrationOwnerUid, item.id, item.data() as LegacyCloudMessage);
        } catch (error) {
          hadFailure = true;
          console.warn('[ROUTE legacy chat preview migration]', item.id, error);
        }
        completed += 1;
        window.dispatchEvent(new CustomEvent('route-chat-media-migration-progress', {
          detail: { completed, total: candidates.length },
        }));
        // Yield between messages so a large historical gallery migration does
        // not monopolize the Android WebView main thread.
        await new Promise((resolve) => window.setTimeout(resolve, 40));
      }

      if (!hadFailure) completedRooms.add(roomKey);
    } finally {
      runningRooms.delete(roomKey);
      window.dispatchEvent(new CustomEvent('route-chat-media-migration-complete'));
    }
  })();

  runningRooms.set(roomKey, task);
  return task;
}
