import { Heart, MapPin } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { Memory } from '../../types';

const isVideo = (src: string) => src.startsWith('data:video/') || /\.(mp4|webm|mov)(\?|$)/i.test(src);

let activePreviewVideo: HTMLVideoElement | null = null;
let previewVisibilityWired = false;

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

export function MemoryCard({ memory, onOpen }: { memory: Memory; onOpen: () => void; onFavorite: () => void }) {
  const date = new Date(`${memory.date}T00:00:00`);
  const videoRef = useRef<HTMLVideoElement>(null);
  const cover = memory.images[0];

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
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
    };
  }, [cover]);

  return <article className="memory-card" onClick={onOpen}>
    <div className="memory-cover">
      {isVideo(cover)
        ? <video ref={videoRef} src={cover} muted loop playsInline preload="metadata" />
        : <img src={cover} alt={memory.title} loading="lazy" decoding="async" />}
      <span className={memory.favorite ? 'memory-favorite-badge active' : 'memory-favorite-badge'}><Heart size={17} fill={memory.favorite ? 'currentColor' : 'none'} /></span>
    </div>
    <div className="memory-card-copy"><span>{date.getMonth() + 1}월 {date.getDate()}일</span><h3>{memory.title}</h3>{memory.location && <p><MapPin size={12} />{memory.location}</p>}</div>
  </article>;
}
