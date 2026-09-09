import { getDownloadURL, ref } from 'firebase/storage';
import { Image as ImageIcon, RefreshCw, Video } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type React from 'react';
import { storage } from '../../lib/firebaseStorage';
import { chatMediaOriginalUrl, chatMediaPreviewUrl } from '../../lib/chatMediaReference';

const IMAGE_RETRY_DELAYS_MS = [500, 1_400] as const;

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

async function resolveStorageReference(value: string) {
  if (!value.startsWith('gs://')) return value;
  try {
    return await getDownloadURL(ref(storage, value));
  } catch (cause) {
    console.warn('[ROUTE memory storage recovery]', cause);
    return value;
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
  const [candidates, setCandidates] = useState<string[]>(() => sourceCandidates(src));
  const [candidateIndex, setCandidateIndex] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const [failed, setFailed] = useState(false);
  const retryTimer = useRef<number | undefined>(undefined);
  const displayUrl = candidates[candidateIndex] ?? '';

  useEffect(() => {
    if (retryTimer.current) window.clearTimeout(retryTimer.current);
    const rawCandidates = sourceCandidates(src);
    setCandidates(rawCandidates);
    setCandidateIndex(0);
    setAttempt(0);
    setRetrying(false);
    setFailed(false);
    let cancelled = false;

    void Promise.all(rawCandidates.map(resolveStorageReference)).then((resolved) => {
      if (cancelled) return;
      const durableCandidates = Array.from(new Set(resolved.filter(Boolean)));
      setCandidates(durableCandidates);
      setCandidateIndex(0);
      setAttempt(0);
      setRetrying(false);
      setFailed(false);
    });

    return () => {
      cancelled = true;
      if (retryTimer.current) window.clearTimeout(retryTimer.current);
    };
  }, [src]);

  const retryNow = (event: React.MouseEvent<HTMLElement> | React.KeyboardEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (retryTimer.current) window.clearTimeout(retryTimer.current);
    setFailed(false);
    setRetrying(false);
    setCandidateIndex(0);
    setAttempt((value) => value + 1);
  };

  const handleError = () => {
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
    setFailed(true);
  };

  if (!displayUrl) {
    return <span className={`memory-media-fallback ${className ?? ''} !grid place-items-center content-center gap-1`} role="img" aria-label={alt || '사진 미리보기'}><ImageIcon size={20} /><small>사진 미리보기</small></span>;
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
