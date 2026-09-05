import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { getDownloadURL, ref, uploadString } from 'firebase/storage';
import type { Memory, Message } from '../types';
import { db, storage } from './firebase';

const MAX_BACKUP_MESSAGES = 500;
const KEEP_POLICY = 'keep-until-user-deletes';

type BackupEnvelope<T> = {
  value?: T;
  updatedAt?: unknown;
  retentionPolicy?: string;
};

function backupRef(uid: string, key: string) {
  return doc(db, 'users', uid, 'backups', key);
}

function safeSegment(value: string | number) {
  return String(value).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
}

function isDataUrl(value?: string) {
  return Boolean(value?.startsWith('data:'));
}

async function persistMedia(uid: string, folder: string, name: string, value: string) {
  if (!isDataUrl(value)) return value;
  const target = ref(storage, `users/${uid}/backupMedia/${safeSegment(folder)}/${safeSegment(name)}`);
  await uploadString(target, value, 'data_url');
  return getDownloadURL(target);
}

async function persistMessageMedia(uid: string, message: Message): Promise<Message> {
  if (message.imageUrl) {
    const imageUrl = await persistMedia(uid, 'chat', `${message.id}-0`, message.imageUrl);
    return { ...message, imageUrl };
  }
  if (message.imageUrls?.length) {
    const imageUrls = await Promise.all(message.imageUrls.map((url, index) => persistMedia(uid, 'chat', `${message.id}-${index}`, url)));
    return { ...message, imageUrls };
  }
  return message;
}

async function persistMemoryMedia(uid: string, memory: Memory): Promise<Memory> {
  const images = await Promise.all(memory.images.map((url, index) => persistMedia(uid, 'memories', `${memory.id}-image-${index}`, url)));
  const videos = memory.videos?.length
    ? await Promise.all(memory.videos.map((url, index) => persistMedia(uid, 'memories', `${memory.id}-video-${index}`, url)))
    : undefined;
  return { ...memory, images, videos };
}

export async function saveBackupValue<T>(uid: string, key: string, value: T) {
  if (!uid) return;
  await setDoc(backupRef(uid, key), {
    value,
    updatedAt: serverTimestamp(),
    retentionPolicy: KEEP_POLICY,
  } satisfies BackupEnvelope<T>, { merge: true });
}

export async function loadBackupValue<T>(uid: string, key: string): Promise<T | undefined> {
  if (!uid) return undefined;
  const snapshot = await getDoc(backupRef(uid, key));
  if (!snapshot.exists()) return undefined;
  return (snapshot.data() as BackupEnvelope<T>).value;
}

export async function saveMessagesBackup(uid: string, messages: Message[]) {
  const recent = messages.slice(-MAX_BACKUP_MESSAGES);
  const prepared: Message[] = [];
  for (const message of recent) {
    prepared.push(await persistMessageMedia(uid, message));
  }
  await saveBackupValue(uid, 'messages-latest', prepared);
}

export async function saveMemoriesBackup(uid: string, memories: Memory[]) {
  const prepared: Memory[] = [];
  for (const memory of memories) {
    prepared.push(await persistMemoryMedia(uid, memory));
  }
  await saveBackupValue(uid, 'memories-latest', prepared);
}

export async function restoreCoreBackup(uid: string) {
  const [messages, memories] = await Promise.all([
    loadBackupValue<Message[]>(uid, 'messages-latest'),
    loadBackupValue<Memory[]>(uid, 'memories-latest'),
  ]);
  return { messages: messages ?? [], memories: memories ?? [] };
}
