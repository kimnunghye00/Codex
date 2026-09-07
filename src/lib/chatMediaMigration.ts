import { doc, updateDoc } from 'firebase/firestore';
import type { Message } from '../types';
import { replaceChatMemoryMediaReference } from '../utils/featureFlow';
import { db } from './firebase';
import { createLegacyChatMediaReference } from './chatMedia';
import { hasOptimizedChatPreview } from './chatMediaReference';

const MIGRATION_GAP_MS = 180;
const MAX_CONCURRENT_MIGRATIONS = 2;
const MAX_AUTO_ATTEMPTS = 4;
const RETRY_BACKOFF_MS = [1_200, 4_000, 12_000] as const;
const PREVIEW_STATUS_EVENT = 'route-chat-media-preview-status';
const PREVIEW_STATUS_REQUEST_EVENT = 'route-chat-media-preview-status-request';
const PREVIEW_RETRY_EVENT = 'route-chat-media-preview-retry';
const DIAGNOSTIC_KEY = 'route-chat-media-migration-diagnostics';

type JobStatus = 'waiting' | 'inflight' | 'done' | 'failed';
type PreviewStatus = 'optimizing' | 'retrying' | 'failed' | 'ready';

type JobState = {
  attempts: number;
  nextRetryAt: number;
  status: JobStatus;
  lastErrorCode?: string;
};

type RoomState = {
  coupleId: string;
  ownerUid: string;
  messages: Message[];
  jobs: Map<string, JobState>;
  active: number;
  timer?: number;
};

type Candidate = {
  message: Message;
  url: string;
  index: number;
};

type PreviewStatusDetail = {
  reference: string;
  status: PreviewStatus;
  attempt?: number;
  nextRetryAt?: number;
  code?: string;
};

type PreviewReferenceDetail = {
  reference?: string;
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

function candidates(state: RoomState) {
  const result: Candidate[] = [];
  for (let messageIndex = state.messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = state.messages[messageIndex];
    if (message.type === 'image' && migratable(message.imageUrl)) {
      result.push({ message, url: message.imageUrl!, index: 0 });
    }
    if (message.type === 'gallery' && message.imageUrls?.length) {
      for (let index = 0; index < message.imageUrls.length; index += 1) {
        const url = message.imageUrls[index];
        if (migratable(url)) result.push({ message, url, index });
      }
    }
  }
  return result;
}

function emitPreviewStatus(reference: string, status: PreviewStatus, extra: Omit<PreviewStatusDetail, 'reference' | 'status'> = {}) {
  window.dispatchEvent(new CustomEvent<PreviewStatusDetail>(PREVIEW_STATUS_EVENT, {
    detail: { reference, status, ...extra },
  }));
}

function emitKnownPreviewStatus(reference: string) {
  for (const state of rooms.values()) {
    for (const candidate of candidates(state)) {
      if (candidate.url !== reference) continue;
      const job = state.jobs.get(candidateKey(candidate));
      if (!job) {
        emitPreviewStatus(reference, 'optimizing', { attempt: 0 });
        return;
      }
      if (job.status === 'failed') {
        emitPreviewStatus(reference, 'failed', { attempt: job.attempts, code: job.lastErrorCode });
        return;
      }
      if (job.status === 'waiting' || job.status === 'inflight') {
        emitPreviewStatus(reference, job.attempts > 1 || job.status === 'waiting' ? 'retrying' : 'optimizing', {
          attempt: job.attempts,
          nextRetryAt: job.nextRetryAt || undefined,
          code: job.lastErrorCode,
        });
        return;
      }
      if (job.status === 'done') {
        emitPreviewStatus(reference, 'ready', { attempt: job.attempts });
        return;
      }
    }
  }
}

function migrationErrorCode(error: unknown) {
  const message = error instanceof Error ? `${error.name}:${error.message}` : String(error);
  if (/AbortError|legacy-media-timeout/i.test(message)) return 'timeout';
  if (/Failed to fetch|NetworkError|Load failed|legacy-media-network/i.test(message)) return 'network-or-cors';
  if (/legacy-media-401|legacy-media-403|storage\/unauthorized/i.test(message)) return 'storage-access';
  if (/legacy-media-404|object-not-found/i.test(message)) return 'source-missing';
  if (/decode|ImageBitmap|canvas|preview-encode/i.test(message)) return 'image-decode';
  return 'unknown';
}

function recordMigrationDiagnostic(candidate: Candidate, attempt: number, code: string) {
  try {
    const previous = JSON.parse(sessionStorage.getItem(DIAGNOSTIC_KEY) || '[]') as unknown[];
    const next = [
      ...previous.slice(-19),
      { at: new Date().toISOString(), messageId: candidate.message.id, mediaIndex: candidate.index, attempt, code },
    ];
    sessionStorage.setItem(DIAGNOSTIC_KEY, JSON.stringify(next));
  } catch {}
}

function nextCandidate(state: RoomState, now = Date.now()): Candidate | undefined {
  for (const candidate of candidates(state)) {
    const job = state.jobs.get(candidateKey(candidate));
    if (!job) return candidate;
    if (job.status === 'waiting' && job.nextRetryAt <= now) return candidate;
  }
  return undefined;
}

function nextWakeDelay(state: RoomState) {
  const now = Date.now();
  let earliest = Number.POSITIVE_INFINITY;
  for (const candidate of candidates(state)) {
    const job = state.jobs.get(candidateKey(candidate));
    if (!job) return 0;
    if (job.status === 'waiting') earliest = Math.min(earliest, job.nextRetryAt);
  }
  if (!Number.isFinite(earliest)) return undefined;
  return Math.max(0, earliest - now);
}

function schedulePump(state: RoomState, preferredDelay = MIGRATION_GAP_MS) {
  if (state.timer !== undefined || document.visibilityState === 'hidden') return;
  if (state.active >= MAX_CONCURRENT_MIGRATIONS) return;

  const immediate = nextCandidate(state);
  const waitForRetry = immediate ? 0 : nextWakeDelay(state);
  if (!immediate && waitForRetry === undefined) return;
  const delay = immediate ? preferredDelay : Math.max(80, waitForRetry ?? preferredDelay);

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

    const key = candidateKey(candidate);
    const previous = state.jobs.get(key);
    const attempt = (previous?.attempts ?? 0) + 1;
    state.jobs.set(key, {
      attempts: attempt,
      nextRetryAt: 0,
      status: 'inflight',
      lastErrorCode: previous?.lastErrorCode,
    });
    state.active += 1;
    emitPreviewStatus(candidate.url, attempt > 1 ? 'retrying' : 'optimizing', { attempt });
    void migrateCandidate(state, candidate, key);
  }

  schedulePump(state, 80);
}

async function migrateCandidate(state: RoomState, candidate: Candidate, key: string) {
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

    state.jobs.set(key, { attempts: state.jobs.get(key)?.attempts ?? 1, nextRetryAt: 0, status: 'done' });
    emitPreviewStatus(candidate.url, 'ready');
  } catch (error) {
    const previous = state.jobs.get(key);
    const attempts = previous?.attempts ?? 1;
    const code = migrationErrorCode(error);
    recordMigrationDiagnostic(candidate, attempts, code);

    if (attempts >= MAX_AUTO_ATTEMPTS) {
      state.jobs.set(key, { attempts, nextRetryAt: Number.POSITIVE_INFINITY, status: 'failed', lastErrorCode: code });
      emitPreviewStatus(candidate.url, 'failed', { attempt: attempts, code });
    } else {
      const backoff = RETRY_BACKOFF_MS[Math.min(attempts - 1, RETRY_BACKOFF_MS.length - 1)];
      const nextRetryAt = Date.now() + backoff;
      state.jobs.set(key, { attempts, nextRetryAt, status: 'waiting', lastErrorCode: code });
      emitPreviewStatus(candidate.url, 'retrying', { attempt: attempts, nextRetryAt, code });
    }

    console.warn('[ROUTE legacy preview migration]', {
      messageId: candidate.message.id,
      mediaIndex: candidate.index,
      attempt: attempts,
      code,
      retrying: attempts < MAX_AUTO_ATTEMPTS,
      error,
    });
  } finally {
    state.active = Math.max(0, state.active - 1);
    schedulePump(state, 80);
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
    jobs: new Map<string, JobState>(),
    active: 0,
  };
  state.messages = messages;
  rooms.set(key, state);
  schedulePump(state, 80);
}

export async function startLegacyChatMediaMigration(_coupleId: string, _ownerUid: string) {
  return Promise.resolve();
}

window.addEventListener(PREVIEW_STATUS_REQUEST_EVENT, (event) => {
  const reference = (event as CustomEvent<PreviewReferenceDetail>).detail?.reference;
  if (reference) emitKnownPreviewStatus(reference);
});

window.addEventListener(PREVIEW_RETRY_EVENT, (event) => {
  const reference = (event as CustomEvent<PreviewReferenceDetail>).detail?.reference;
  if (!reference) return;

  rooms.forEach((state) => {
    let reset = false;
    for (const candidate of candidates(state)) {
      if (candidate.url !== reference) continue;
      state.jobs.set(candidateKey(candidate), { attempts: 0, nextRetryAt: 0, status: 'waiting' });
      reset = true;
    }
    if (reset) schedulePump(state, 0);
  });
  emitPreviewStatus(reference, 'retrying', { attempt: 0 });
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  rooms.forEach((state) => schedulePump(state, 120));
});
