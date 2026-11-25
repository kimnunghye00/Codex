import { Heart, MapPin } from 'lucide-react';
import { memo, useEffect, useRef, useState } from 'react';
import type { Memory } from '../../types';
import { isMemoryVideo, MemoryImage } from './MemoryMedia';

let activePreviewVideo: HTMLVideoElement | null = null;
let previewVisibilityWired = false;

// All album covers use the same viewport and prefetch margin. One observer
// avoids allocating an observer per record while preserving offscreen release.
let coverObserver: IntersectionObserver | null = null;
const coverListeners = new Map<Element, (active: boolean) => void>();

function observeCover(element: Element, listener: (active: boolean) => void) {
  if (typeof IntersectionObserver === 'undefined') {
    listener(true);
    return () => {};
  }
  coverObserver ??= new IntersectionObserver((entries) => {
    for (const entry of entries) coverListeners.get(entry.target)?.(entry.isIntersecting);
  }, { rootMargin: '520px 0px', threshold: 0.01 });
  coverListeners.set(element, listener);
  coverObserver.observe(element);
  return () => {
    coverObserver?.unobserve(element);
    coverListeners.delete(element);
    if (!coverListeners.size) {
      coverObserver?.disconnect();
      coverObserver = null;
    }
  };
}

function wirePreviewVisibilityGuard() {
  if (previewVisibilityWired || typeof document === 'undefined') return;
  previewVisibilityWired = true;
  const pauseActive = () => {
    activePreviewVideo?.pause();
    activePreviewVideo = null;
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') pauseActive();
  });
  window.addEventListener('route-app-pause', pauseActive);
}

function MemoryCardComponent({ memory, onOpen }: { memory: Memory; onOpen: (id: number) => void }) {
  const date = new Date(`${memory.date}T00:00:00`);
  const cardRef = useRef<HTMLElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [mediaActive, setMediaActive] = useState(false);
  const cover = memory.images[0];

  useEffect(() => {
    const card = cardRef.current;
    if (!card || typeof IntersectionObserver === 'undefined') {
      setMediaActive(true);
      return;
    }

    return observeCover(card, setMediaActive);
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !mediaActive || !isMemoryVideo(cover) || typeof IntersectionObserver === 'undefined') return;
    wirePreviewVisibilityGuard();

    const observer = new IntersectionObserver(([entry]) => {
      const shouldPlay = document.visibilityState === 'visible' && entry.isIntersecting && entry.intersectionRatio >= 0.72;
      if (!shouldPlay) {
        video.pause();
        if (activePreviewVideo === video) activePreviewVideo = null;
        return;
      }

      // A two-column album can expose more than one video card at once. Decode
      // and animate only one preview so scrolling does not multiply GPU/battery work.
      if (activePreviewVideo && activePreviewVideo !== video) activePreviewVideo.pause();
      activePreviewVideo = video;
      void video.play().catch(() => {
        if (activePreviewVideo === video) activePreviewVideo = null;
      });
    }, { threshold: [0, 0.72, 1] });

    observer.observe(video);
    return () => {
      observer.disconnect();
      video.pause();
      if (activePreviewVideo === video) activePreviewVideo = null;
      // Removing src and forcing load() asks Chromium/WebView to release the
      // decoded frame/buffer instead of retaining every video card ever seen.
      video.removeAttribute('src');
      try { video.load(); } catch { /* The element may already be detached during cleanup. */ }
    };
  }, [cover, mediaActive]);

  return <article ref={cardRef} className="memory-card" role="button" tabIndex={0} aria-label={`${memory.title} 추억 보기`} onClick={() => onOpen(memory.id)} onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onOpen(memory.id); } }}>
    <div className="memory-cover">
      {!mediaActive
        ? <span className="memory-media-fallback" aria-hidden="true" />
        : isMemoryVideo(cover)
          ? <video ref={videoRef} src={cover} muted loop playsInline preload="metadata" />
          : <MemoryImage src={cover} alt={memory.title} loading="eager" />}
      {memory.images.length > 1 && <span className="danduli-memory-count" aria-label={`사진 및 영상 ${memory.images.length}개`}>{memory.images.length}개</span>}
      <span className={memory.favorite ? 'memory-favorite-badge active' : 'memory-favorite-badge'}><Heart size={17} fill={memory.favorite ? 'currentColor' : 'none'} /></span>
    </div>
    <div className="memory-card-copy"><span>{date.getFullYear()}년 {date.getMonth() + 1}월 {date.getDate()}일</span><h3>{memory.title}</h3>{memory.location && <p><MapPin size={12} />{memory.location}</p>}</div>
  </article>;
}

export const MemoryCard = memo(MemoryCardComponent, (previous, next) => previous.memory === next.memory && previous.onOpen === next.onOpen);
