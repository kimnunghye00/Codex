import { Image as ImageIcon, Video } from 'lucide-react';
import { useEffect, useState } from 'react';
import type React from 'react';
import { chatMediaPreviewUrl } from '../../lib/chatMediaReference';

export function isMemoryVideo(src?: string) {
  if (!src) return false;
  if (src.startsWith('data:video/')) return true;
  let normalized = src.split('#')[0];
  try { normalized = decodeURIComponent(normalized); } catch {}
  return /\.(mp4|webm|mov)(\?|$)/i.test(normalized);
}

export function MemoryImage({ src, alt, className, loading = 'lazy', decoding = 'async', onClick }: {
  src?: string;
  alt: string;
  className?: string;
  loading?: 'eager' | 'lazy';
  decoding?: 'async' | 'auto' | 'sync';
  onClick?: React.MouseEventHandler<HTMLImageElement>;
}) {
  const [failed, setFailed] = useState(false);
  const displayUrl = src ? chatMediaPreviewUrl(src) : '';

  useEffect(() => setFailed(false), [displayUrl]);

  if (!displayUrl || failed) {
    return <span className={`memory-media-fallback ${className ?? ''}`} role="img" aria-label={alt || '사진 미리보기'}><ImageIcon size={20} /><small>사진 미리보기</small></span>;
  }

  return <img
    src={displayUrl}
    alt={alt}
    className={className}
    loading={loading}
    decoding={decoding}
    onError={() => setFailed(true)}
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
