import { Heart, MapPin } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { Memory } from '../../types';

const isVideo = (src: string) => src.startsWith('data:video/') || /\.(mp4|webm|mov)(\?|$)/i.test(src);

export function MemoryCard({ memory, onOpen }: { memory: Memory; onOpen: () => void; onFavorite: () => void }) {
  const date = new Date(`${memory.date}T00:00:00`);
  const videoRef = useRef<HTMLVideoElement>(null);
  const cover = memory.images[0];

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && entry.intersectionRatio >= 0.65) void video.play().catch(() => undefined);
      else video.pause();
    }, { threshold: [0, 0.65, 1] });
    observer.observe(video);
    return () => observer.disconnect();
  }, [cover]);

  return <article className="memory-card" onClick={onOpen}>
    <div className="memory-cover">
      {isVideo(cover) ? <video ref={videoRef} src={cover} muted loop playsInline preload="metadata" /> : <img src={cover} alt={memory.title} />}
      <span className={memory.favorite ? 'memory-favorite-badge active' : 'memory-favorite-badge'}><Heart size={17} fill={memory.favorite ? 'currentColor' : 'none'} /></span>
    </div>
    <div className="memory-card-copy"><span>{date.getMonth() + 1}월 {date.getDate()}일</span><h3>{memory.title}</h3>{memory.location && <p><MapPin size={12} />{memory.location}</p>}</div>
  </article>;
}
