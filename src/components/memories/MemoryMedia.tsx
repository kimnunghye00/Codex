import { Image as ImageIcon, RefreshCw, Video } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type React from 'react';
import { chatMediaPreviewUrl } from '../../lib/chatMediaReference';

const IMAGE_RETRY_DELAYS_MS = [600, 1_800] as const;

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

export function MemoryImage({ src, alt, className, loading = 'lazy', decoding = 'async', onClick }: {
  src?: string;
  alt: string;
  className?: string;
  loading?: 'eager' | 'lazy';
  decoding?: 'async' | 'auto' | 'sync';
  onClick?: React.MouseEventHandler<HTMLImageElement>;
}) {
  const [attempt, setAttempt] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const [failed, setFailed] = useState(false);
  const retryTimer = useRef<number | undefined>(undefined);
  const displayUrl = src ? chatMediaPreviewUrl(src) : '';

  useEffect(() => {
    if (retryTimer.current) window.clearTimeout(retryTimer.current);
    setAttempt(0);
    setRetrying(false);
    setFailed(false);
    return () => {
      if (retryTimer.current) window.clearTimeout(retryTimer.current);
    };
  }, [displayUrl]);

  const retryNow = (event: React.MouseEvent<HTMLElement> | React.KeyboardEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (retryTimer.current) window.clearTimeout(retryTimer.current);
    setFailed(false);
    setRetrying(false);
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
    setFailed(true);
  };

  if (!displayUrl) {
    return <span className={`memory-media-fallback ${className ?? ''}`} role="img" aria-label={alt || '사진 미리보기'}><ImageIcon size={20} /><small>사진 미리보기</small></span>;
  }

  if (retrying) {
    return <span className={`memory-media-fallback memory-media-retrying ${className ?? ''}`} role="status" aria-label="사진 다시 불러오는 중"><RefreshCw size={20} /><small>사진 다시 불러오는 중…</small></span>;
  }

  if (failed) {
    return <span
      className={`memory-media-fallback memory-media-retry ${className ?? ''}`}
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
