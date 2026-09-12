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
  await setDoc(memoryRef(coupleId, memory.id), {
    ...payload,
    updatedAt: serverTimestamp(),
    createdAt: serverTimestamp(),
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
