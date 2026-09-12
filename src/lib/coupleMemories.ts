import { collection, deleteDoc, doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import type { Memory } from '../types';
import { db } from './firebase';

type CloudMemory = Omit<Memory, 'createdBy'> & {
  ownerUid: string;
  updatedAt?: unknown;
  createdAt?: unknown;
};

function memoryRef(coupleId: string, memoryId: number) {
  return doc(db, 'couples', coupleId, 'memories', String(memoryId));
}

function sanitizeMemory(memory: Memory, currentUid: string) {
  const ownerUid = memory.ownerUid || currentUid;
  const payload = JSON.parse(JSON.stringify({
    id: memory.id,
    title: memory.title,
    date: memory.date,
    description: memory.description,
    images: memory.images,
    videos: memory.videos,
    location: memory.location,
    tags: memory.tags,
    favorite: memory.favorite ?? false,
    ownerUid,
  })) as Omit<CloudMemory, 'updatedAt' | 'createdAt'>;
  return { payload, ownerUid };
}

/**
 * Canonical, persisted-field-only signature for a memory. This MUST stay in
 * sync with sanitizeMemory()'s payload shape and with how
 * subscribeCoupleMemories() rebuilds a Memory from a Firestore doc.
 *
 * Why this exists: App.tsx compares "the memory we last synced" against "the
 * current memory" to decide whether to write it back to Firestore. Comparing
 * raw Memory objects was buggy because Memory carries fields that are either
 * locally-derived and never persisted (createdBy, which flips between 'me'
 * and 'partner' purely based on which device is looking at it) or whose
 * on/off-device defaults don't match (a brand-new memory has `favorite:
 * undefined`, but Firestore always stores `favorite: false`). Those mismatches
 * meant a memory could look "changed" forever, even though nothing the user
 * did actually changed it - the couple's two devices would keep re-writing
 * the same memory back and forth, which is exactly what was flooding
 * Firestore ("Write stream exhausted maximum allowed queued writes") and
 * ballooning memory while the app just sat idle.
 */
export function memorySyncSignature(memory: Memory) {
  return JSON.stringify({
    id: memory.id,
    title: memory.title,
    date: memory.date,
    description: memory.description,
    images: memory.images,
    videos: memory.videos ?? [],
    location: memory.location ?? '',
    tags: memory.tags ?? [],
    favorite: memory.favorite ?? false,
    ownerUid: memory.ownerUid ?? '',
  });
}

export function subscribeCoupleMemories(
  coupleId: string,
  currentUid: string,
  onChange: (memories: Memory[]) => void,
  onError: (error: unknown) => void = () => undefined,
) {
  return onSnapshot(collection(db, 'couples', coupleId, 'memories'), (snapshot) => {
    const memories: Memory[] = [];
    snapshot.docs.forEach((item) => {
      const data = item.data() as Partial<CloudMemory>;
      const id = Number(data.id ?? item.id);
      if (!Number.isFinite(id)) return;
      const ownerUid = String(data.ownerUid ?? '');

      const memory: Memory = {
        id,
        title: String(data.title ?? ''),
        date: String(data.date ?? ''),
        description: String(data.description ?? ''),
        images: Array.isArray(data.images) ? data.images.filter((value): value is string => typeof value === 'string') : [],
        ownerUid: ownerUid || undefined,
        createdBy: ownerUid && ownerUid !== currentUid ? 'partner' : 'me',
        favorite: Boolean(data.favorite),
      };
      if (Array.isArray(data.videos)) memory.videos = data.videos.filter((value): value is string => typeof value === 'string');
      if (data.location) memory.location = String(data.location);
      if (Array.isArray(data.tags)) memory.tags = data.tags.filter((value): value is string => typeof value === 'string');
      memories.push(memory);
    });
    memories.sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
    onChange(memories);
  }, onError);
}

export async function upsertCoupleMemory(coupleId: string, currentUid: string, memory: Memory) {
  const { payload } = sanitizeMemory(memory, currentUid);
  // Only bump updatedAt. createdAt isn't read back into the app's Memory type
  // (see subscribeCoupleMemories below), so re-stamping it on every edit only
  // churns the document for no benefit - and every churn re-broadcasts to
  // both partners' onSnapshot listeners, which used to feed the sync loop
  // described above.
  await setDoc(memoryRef(coupleId, memory.id), {
    ...payload,
    updatedAt: serverTimestamp(),
  }, { merge: true });
}

export async function deleteCoupleMemory(coupleId: string, memoryId: number) {
  await deleteDoc(memoryRef(coupleId, memoryId));
}

export async function migrateLocalMemoriesToCouple(coupleId: string, currentUid: string, memories: Memory[]) {
  if (!memories.length) return;
  await Promise.all(memories.map((memory) => upsertCoupleMemory(coupleId, currentUid, {
    ...memory,
    ownerUid: memory.ownerUid || currentUid,
    createdBy: memory.ownerUid && memory.ownerUid !== currentUid ? 'partner' : 'me',
  })));
}
