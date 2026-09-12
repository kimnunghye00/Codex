import { getDownloadURL, ref } from 'firebase/storage';
import { Image as ImageIcon, RefreshCw, Video } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type React from 'react';
import { storage } from '../../lib/firebaseStorage';
import { auth } from '../../lib/firebaseAuth';
import { chatMediaOriginalUrl, chatMediaPreviewUrl } from '../../lib/chatMediaReference';

const IMAGE_RETRY_DELAYS_MS = [500, 1_400] as const;
const MEMORY_KEY = 'route.memories.v2';
const MEMORY_MEDIA_PREFETCH_MARGIN = '240px 0px';

type MemorySlot = { memoryId: number; index: number };
type LegacyRecovery = { url: string; slot: MemorySlot | null };

const storageUrlCache = new Map<string, Promise<string>>();

export function isMemoryVideo(src?: string) {
  if (!src) return false;
  if (src.startsWith('data:video/')) return true;
  let normalized = src.split('#')[0];
  try { normalized = decodeURIComponent(normalized); } catch {}
  return /\.(mp4|webm|mov)(\?|$)/i.test(normalized);
}

function retryableUrl(url: string, attempt: number) {
  if (!attempt || url.startsWith('blob:') || url.startsWith('data:')) return url;
  return `${url}${url.includes('?') ? '&' : '?'}route-memory-retry=${attempt}`;
}

function sourceCandidates(source?: string) {
  if (!source) return [];
  const preview = chatMediaPreviewUrl(source);
  const original = chatMediaOriginalUrl(source);
  return Array.from(new Set([preview, original, source].filter((value): value is string => Boolean(value) && !value.includes('#route-original='))));
}

function immediateCandidates(source?: string) {
  return sourceCandidates(source).filter((value) => !value.startsWith('gs://'));
}

function storageCandidates(source?: string) {
  return sourceCandidates(source).filter((value) => value.startsWith('gs://'));
}

async function resolveStorageReference(value: string) {
  if (!value.startsWith('gs://')) return value;
  const cached = storageUrlCache.get(value);
  if (cached) return cached;

  const pending = getDownloadURL(ref(storage, value)).catch((cause) => {
    storageUrlCache.delete(value);
    console.warn('[ROUTE memory storage recovery]', cause);
    return value;
  });
  storageUrlCache.set(value, pending);
  return pending;
}

function safeSegment(value: string | number) {
  return String(value).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
}

function inferMemorySlot(source?: string): MemorySlot | null {
  if (!source) return null;
  try {
    const memories = JSON.parse(localStorage.getItem(MEMORY_KEY) || '[]') as Array<{ id: number; images?: string[] }>;
    for (const memory of memories) {
      const index = Array.isArray(memory.images) ? memory.images.indexOf(source) : -1;
      if (index >= 0) return { memoryId: memory.id, index };
    }
  } catch { /* an invalid local backup should not break image rendering */ }
  return null;
}

async function resolveLegacyBackup(source?: string): Promise<LegacyRecovery> {
  const uid = auth.currentUser?.uid;
  const slot = inferMemorySlot(source);
  if (!uid || !slot) return { url: '', slot: null };
  try {
    const target = ref(storage, `users/${uid}/backupMedia/memories-live/${safeSegment(slot.memoryId)}-${slot.index}`);
    return { url: await getDownloadURL(target), slot };
  } catch {
    return { url: '', slot };
  }
}

function persistRecoveredUrl(source: string | undefined, recoveredUrl: string, slot: MemorySlot | null) {
  if (!source || !recoveredUrl || !slot || source === recoveredUrl) return;
  try {
    const memories = JSON.parse(localStorage.getItem(MEMORY_KEY) || '[]') as Array<{ id: number; images?: string[] }>;
    let changed = false;
    const next = memories.map((memory) => {
      if (memory.id !== slot.memoryId || !Array.isArray(memory.images) || memory.images[slot.index] !== source) return memory;
      const images = [...memory.images];
      images[slot.index] = recoveredUrl;
      changed = true;
      return { ...memory, images };
    });
    if (!changed) return;
    localStorage.setItem(MEMORY_KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent('route-memories-local-change', { detail: { recovered: true } }));
    window.dispatchEvent(new CustomEvent('route-memories-remote-change', { detail: next }));
  } catch (cause) {
    console.warn('[ROUTE memory recovery persist]', cause);
  }
}

export function MemoryImage({ src, alt, className, loading = 'lazy', decoding = 'async', onClick }: {
  src?: string;
  alt: string;
  className?: string;
  loading?: 'eager' | 'lazy';
  decoding?: 'async' | 'auto' | 'sync';
  onClick?: React.MouseEventHandler<HTMLImageElement>;
}) {
  const [candidates, setCandidates] = useState<string[]>(() => immediateCandidates(src));
  const [candidateIndex, setCandidateIndex] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const [failed, setFailed] = useState(false);
  const [mediaReady, setMediaReady] = useState(loading === 'eager');
  const [legacyRecovery, setLegacyRecovery] = useState<LegacyRecovery>({ url: '', slot: null });
  const retryTimer = useRef<number | undefined>(undefined);
  const deferredAnchor = useRef<HTMLSpanElement>(null);
  const sourceRef = useRef(src);
  const storageResolutionStarted = useRef(false);
  const legacyRecoveryAttempted = useRef(false);
  const displayUrl = candidates[candidateIndex] ?? '';

  const resolveDurableCandidates = () => {
    const source = src;
    if (!source || storageResolutionStarted.current || storageCandidates(source).length === 0) return false;
    storageResolutionStarted.current = true;
    setRetrying(true);

    const rawCandidates = sourceCandidates(source);
    void Promise.all(rawCandidates.map(resolveStorageReference)).then((resolved) => {
      if (sourceRef.current !== source) return;
      const durableCandidates = Array.from(new Set(resolved.filter(Boolean)));
      setCandidates(durableCandidates);
      setCandidateIndex(0);
      setAttempt(0);
      setFailed(false);
      setRetrying(false);
    });
    return true;
  };

  const startLegacyRecovery = () => {
    const source = src;
    if (!source || legacyRecoveryAttempted.current) return false;
    legacyRecoveryAttempted.current = true;
    setRetrying(true);

    void resolveLegacyBackup(source).then((legacy) => {
      if (sourceRef.current !== source) return;
      setRetrying(false);
      if (!legacy.url) {
        setFailed(true);
        return;
      }
      setLegacyRecovery(legacy);
      setCandidates([legacy.url]);
      setCandidateIndex(0);
      setAttempt(0);
      setFailed(false);
    });
    return true;
  };

  useEffect(() => {
    sourceRef.current = src;
    if (retryTimer.current) window.clearTimeout(retryTimer.current);
    const initial = immediateCandidates(src);
    setCandidates(initial);
    setCandidateIndex(0);
    setAttempt(0);
    setRetrying(false);
    setFailed(false);
    setMediaReady(loading === 'eager');
    setLegacyRecovery({ url: '', slot: null });
    storageResolutionStarted.current = false;
    legacyRecoveryAttempted.current = false;

    if (!src) return;
    const activateMedia = () => {
      setMediaReady(true);
      if (storageCandidates(src).length > 0) resolveDurableCandidates();
    };
    if (loading === 'eager') {
      activateMedia();
      return;
    }

    const target = deferredAnchor.current;
    if (!target || typeof IntersectionObserver === 'undefined') {
      activateMedia();
      return;
    }

    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      observer.disconnect();
      activateMedia();
    }, { rootMargin: MEMORY_MEDIA_PREFETCH_MARGIN, threshold: 0.01 });
    observer.observe(target);

    return () => {
      observer.disconnect();
      if (retryTimer.current) window.clearTimeout(retryTimer.current);
    };
  }, [src, loading]);

  const retryNow = (event: React.MouseEvent<HTMLElement> | React.KeyboardEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (retryTimer.current) window.clearTimeout(retryTimer.current);
    storageResolutionStarted.current = false;
    legacyRecoveryAttempted.current = false;
    setLegacyRecovery({ url: '', slot: null });
    setFailed(false);
    setRetrying(false);
    setMediaReady(true);
    setCandidateIndex(0);

    const initial = immediateCandidates(src);
    setCandidates(initial);
    if (!initial.length && resolveDurableCandidates()) return;
    setAttempt((value) => value + 1);
  };

  const handleError = () => {
    if (displayUrl.startsWith('blob:')) {
      if (candidateIndex + 1 < candidates.length) {
        setCandidateIndex((value) => value + 1);
        setAttempt(0);
        return;
      }
      if (resolveDurableCandidates()) return;
      if (startLegacyRecovery()) return;
      setFailed(true);
      return;
    }

    if (attempt < IMAGE_RETRY_DELAYS_MS.length) {
      setRetrying(true);
      retryTimer.current = window.setTimeout(() => {
        retryTimer.current = undefined;
        setAttempt((value) => value + 1);
        setRetrying(false);
      }, IMAGE_RETRY_DELAYS_MS[attempt]);
      return;
    }

    if (candidateIndex + 1 < candidates.length) {
      setCandidateIndex((value) => value + 1);
      setAttempt(0);
      setRetrying(false);
      setFailed(false);
      return;
    }
    if (resolveDurableCandidates()) return;
    if (startLegacyRecovery()) return;
    setFailed(true);
  };

  if (!mediaReady || sourceRef.current !== src) {
    return <span ref={deferredAnchor} className={`memory-media-fallback ${className ?? ''} !grid place-items-center content-center gap-1`} role="img" aria-label={alt || '사진 미리보기'}><ImageIcon size={20} /><small>사진 미리보기</small></span>;
  }

  if (!displayUrl) {
    return <span ref={deferredAnchor} className={`memory-media-fallback ${className ?? ''} !grid place-items-center content-center gap-1`} role="img" aria-label={alt || '사진 미리보기'}><ImageIcon size={20} /><small>사진 미리보기</small></span>;
  }

  if (retrying) {
    return <span className={`memory-media-fallback memory-media-retrying ${className ?? ''} !grid place-items-center content-center gap-1`} role="status" aria-label="사진 다시 불러오는 중"><RefreshCw className="animate-spin" size={20} /><small>사진 다시 불러오는 중…</small></span>;
  }

  if (failed) {
    return <span
      className={`memory-media-fallback memory-media-retry ${className ?? ''} !grid cursor-pointer place-items-center content-center gap-1`}
      role="button"
      tabIndex={0}
      aria-label="사진을 불러오지 못했어요. 다시 시도"
      onClick={retryNow}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        retryNow(event);
      }}
    ><RefreshCw size={20} /><small>사진 다시 불러오기</small></span>;
  }

  return <img
    src={retryableUrl(displayUrl, attempt)}
    alt={alt}
    className={className}
    loading={loading}
    decoding={decoding}
    onLoad={() => {
      if (legacyRecovery.url && displayUrl === legacyRecovery.url) persistRecoveredUrl(src, legacyRecovery.url, legacyRecovery.slot);
    }}
    onError={handleError}
    onClick={onClick}
  />;
}

export function MemoryVideo({ src, className, controls = false, autoPlay = false, muted = false, loop = false, preload = 'metadata' }: {
  src?: string;
  className?: string;
  controls?: boolean;
  autoPlay?: boolean;
  muted?: boolean;
  loop?: boolean;
  preload?: 'none' | 'metadata' | 'auto';
}) {
  const [failed, setFailed] = useState(false);

  useEffect(() => setFailed(false), [src]);

  if (!src || failed) {
    return <span className={`memory-media-fallback ${className ?? ''}`} role="img" aria-label="영상 미리보기"><Video size={20} /><small>영상 미리보기</small></span>;
  }

  return <video
    src={src}
    className={className}
    controls={controls}
    autoPlay={autoPlay}
    muted={muted}
    loop={loop}
    playsInline
    preload={preload}
    onError={() => setFailed(true)}
  />;
}
