import { Heart, MapPin } from 'lucide-react';
import type { Memory } from '../../types';

export function MemoryCard({ memory, onOpen, onFavorite }: { memory: Memory; onOpen: () => void; onFavorite: () => void }) {
  const date = new Date(`${memory.date}T00:00:00`);
  return <article className="memory-card" onClick={onOpen}><div className="memory-cover"><img src={memory.images[0]} alt={memory.title} /><button className={memory.favorite ? 'favorite active' : 'favorite'} onClick={(event) => { event.stopPropagation(); onFavorite(); }} aria-label={memory.favorite ? '즐겨찾기 해제' : '즐겨찾기'}><Heart size={19} fill={memory.favorite ? 'currentColor' : 'none'} /></button></div><div className="memory-card-copy"><span>{date.getMonth() + 1}월 {date.getDate()}일</span><h3>{memory.title}</h3>{memory.location && <p><MapPin size={12} />{memory.location}</p>}</div></article>;
}
