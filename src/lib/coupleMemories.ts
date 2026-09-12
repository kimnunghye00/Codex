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

const remoteMemorySignatures = new Map<string, string>();
const inFlightMemoryWrites = new Map<string, { signature: string; promise: Promise<void> }>();
const inFlightMemoryDeletes = new Map<string, Promise<void>>();

function memoryWriteKey(coupleId: string, memoryId: number) {
  return `${coupleId}:${memoryId}`;
}

function payloadSignature(payload: Omit<CloudMemory, 'updatedAt' | 'createdAt'>) {
  return JSON.stringify({
    id: payload.id,
    title: payload.title,
    date: payload.date,
    description: payload.description,
    images: payload.images,
    videos: payload.videos ?? [],
    location: payload.location ?? '',
    tags: payload.tags ?? [],
    favorite: payload.favorite ?? false,
    ownerUid: payload.ownerUid ?? '',
  });
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
    const seenKeys = new Set<string>();
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
      const key = memoryWriteKey(coupleId, id);
      seenKeys.add(key);
      remoteMemorySignatures.set(key, memorySyncSignature(memory));
    });
    const prefix = `${coupleId}:`;
    for (const key of [...remoteMemorySignatures.keys()]) {
      if (key.startsWith(prefix) && !seenKeys.has(key)) remoteMemorySignatures.delete(key);
    }
    memories.sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
    onChange(memories);
  }, onError);
}

export async function upsertCoupleMemory(coupleId: string, currentUid: string, memory: Memory) {
  const { payload } = sanitizeMemory(memory, currentUid);
  const key = memoryWriteKey(coupleId, memory.id);
  const signature = payloadSignature(payload);

  // onSnapshot already tells us the exact persisted shape. If Firestore has
  // this same payload, do not enqueue another write merely to refresh updatedAt.
  if (remoteMemorySignatures.get(key) === signature) return;

  const inFlight = inFlightMemoryWrites.get(key);
  if (inFlight?.signature === signature) {
    await inFlight.promise;
    return;
  }

  const promise = setDoc(memoryRef(coupleId, memory.id), {
    ...payload,
    updatedAt: serverTimestamp(),
  }, { merge: true }).then(() => {
    remoteMemorySignatures.set(key, signature);
  }).finally(() => {
    const current = inFlightMemoryWrites.get(key);
    if (current?.promise === promise) inFlightMemoryWrites.delete(key);
  });

  inFlightMemoryWrites.set(key, { signature, promise });
  await promise;
}

export async function deleteCoupleMemory(coupleId: string, memoryId: number) {
  const key = memoryWriteKey(coupleId, memoryId);
  if (!remoteMemorySignatures.has(key) && !inFlightMemoryWrites.has(key)) return;

  const existing = inFlightMemoryDeletes.get(key);
  if (existing) {
    await existing;
    return;
  }

  const promise = deleteDoc(memoryRef(coupleId, memoryId)).then(() => {
    remoteMemorySignatures.delete(key);
  }).finally(() => {
    if (inFlightMemoryDeletes.get(key) === promise) inFlightMemoryDeletes.delete(key);
  });

  inFlightMemoryDeletes.set(key, promise);
  await promise;
}

export async function migrateLocalMemoriesToCouple(coupleId: string, currentUid: string, memories: Memory[]) {
  if (!memories.length) return;

  // Do not dump dozens of migration writes into Firestore at once. A tiny
  // concurrency window keeps the SDK write stream responsive and still moves
  // an old local album quickly enough for the first sync.
  let cursor = 0;
  const worker = async () => {
    while (cursor < memories.length) {
      const memory = memories[cursor++];
      await upsertCoupleMemory(coupleId, currentUid, {
        ...memory,
        ownerUid: memory.ownerUid || currentUid,
        createdBy: memory.ownerUid && memory.ownerUid !== currentUid ? 'partner' : 'me',
      });
    }
  };
  await Promise.all([worker(), worker()]);
}
