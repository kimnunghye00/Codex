import { ArrowLeft, ChevronLeft, ChevronRight, Clock3, Heart, MapPin, MoreHorizontal, Navigation, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { Memory } from '../../types';
import { auth } from '../../lib/firebase';
import { loadMemories } from '../../utils/storage';
import { loadLocationVisits } from '../../utils/location';

const isVideo = (src: string) => src.startsWith('data:video/') || /\.(mp4|webm|mov)(\?|$)/i.test(src);
const LOCATION_FOCUS_KEY = 'route-pending-location-focus';

function normalizePlace(value?: string) {
  return (value ?? '').trim().toLocaleLowerCase('ko-KR').replace(/[\s.,()\-_/·]+/g, '');
}

function samePlace(a?: string, b?: string) {
  const left = normalizePlace(a);
  const right = normalizePlace(b);
  if (!left || !right) return false;
  return left === right || (Math.min(left.length, right.length) >= 2 && (left.includes(right) || right.includes(left)));
}

function shortDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10).replaceAll('-', '.');
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`;
}

export function MemoryDetail({ memory, onBack, onFavorite, onEdit, onDelete }: { memory: Memory; onBack: () => void; onFavorite: () => void; onEdit: () => void; onDelete: () => void }) {
  const [image, setImage] = useState(0);
  const [menu, setMenu] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [relatedPreview, setRelatedPreview] = useState<Memory>();
  const date = new Date(`${memory.date}T00:00:00`);
  const current = memory.images[image];
  const uid = auth.currentUser?.uid ?? '';

  const relatedMemories = useMemo(() => {
    if (!memory.location) return [];
    return loadMemories([])
      .filter((item) => item.id !== memory.id && samePlace(item.location, memory.location))
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 6);
  }, [memory.id, memory.location]);

  const relatedVisits = useMemo(() => {
    if (!uid || !memory.location) return [];
    return loadLocationVisits(uid)
      .filter((visit) => samePlace(visit.placeName, memory.location))
      .sort((a, b) => b.arrivedAt.localeCompare(a.arrivedAt));
  }, [memory.location, uid]);

  useEffect(() => {
    setImage(0);
    setMenu(false);
    setConfirm(false);
    setRelatedPreview(undefined);
  }, [memory.id]);

  useEffect(() => {
    const handleBack = (event: Event) => {
      if (relatedPreview) { event.preventDefault(); setRelatedPreview(undefined); return; }
      if (confirm) { event.preventDefault(); setConfirm(false); return; }
      if (menu) { event.preventDefault(); setMenu(false); return; }
      event.preventDefault(); onBack();
    };
    window.addEventListener('route-native-back', handleBack);
    return () => window.removeEventListener('route-native-back', handleBack);
  }, [confirm, menu, onBack, relatedPreview]);

  const openLocation = () => {
    const place = memory.location?.trim();
    if (!place) return;
    try { sessionStorage.setItem(LOCATION_FOCUS_KEY, place); } catch {}
    const locationButton = Array.from(document.querySelectorAll<HTMLButtonElement>('.bottom-nav button')).find((button) => button.textContent?.includes('위치'));
    locationButton?.click();
  };

  const recentVisit = relatedVisits[0];

  return <div className="memory-detail"><header><button onClick={onBack} aria-label="목록으로"><ArrowLeft /></button><div className="detail-menu"><button onClick={() => setMenu(!menu)} aria-label="추억 메뉴"><MoreHorizontal /></button>{menu && <div><button onClick={() => { setMenu(false); onEdit(); }}>수정</button><button className="danger" onClick={() => { setMenu(false); setConfirm(true); }}>삭제</button></div>}</div></header><div className="detail-heading"><span>{date.getFullYear()}년 {date.getMonth() + 1}월 {date.getDate()}일</span><h1>{memory.title}</h1></div><div className="detail-gallery">{isVideo(current) ? <video src={current} controls autoPlay playsInline /> : <img src={current} alt={memory.title} />}{memory.images.length > 1 && <><button className="gallery-prev" onClick={() => setImage((image - 1 + memory.images.length) % memory.images.length)}><ChevronLeft /></button><button className="gallery-next" onClick={() => setImage((image + 1) % memory.images.length)}><ChevronRight /></button><span>{image + 1} / {memory.images.length}</span></>}</div>{memory.images.length > 1 && <div className="detail-thumbnails">{memory.images.map((item, index) => <button className={index === image ? 'active' : ''} onClick={() => setImage(index)} key={`${item.slice(0, 40)}-${index}`}>{isVideo(item) ? <video src={item} muted playsInline preload="metadata" /> : <img src={item} alt="" />}</button>)}</div>}<div className="detail-content"><button className={memory.favorite ? 'detail-favorite active' : 'detail-favorite'} onClick={onFavorite}><Heart fill={memory.favorite ? 'currentColor' : 'none'} />{memory.favorite ? '즐겨찾기됨' : '즐겨찾기'}</button><p>{memory.description}</p>{memory.location && <section className="detail-place-flow"><button type="button" className="detail-location detail-location-link" onClick={openLocation}><MapPin size={16} /><span><b>{memory.location}</b><small>ROUTE 지도에서 이 장소 보기</small></span><Navigation size={15} /></button>{(relatedMemories.length > 0 || relatedVisits.length > 0) && <div className="detail-place-related"><header><div><small>SAME PLACE</small><h2>이 장소에서의 우리</h2></div><strong>{relatedMemories.length + relatedVisits.length}개의 기록</strong></header>{relatedVisits.length > 0 && <div className="detail-visit-summary"><Clock3 size={15} /><span><b>방문 기록 {relatedVisits.length}회</b><small>{recentVisit ? `최근 ${shortDate(recentVisit.arrivedAt)} · ${recentVisit.placeName || memory.location}` : memory.location}</small></span><button type="button" onClick={openLocation}>지도</button></div>}{relatedMemories.length > 0 && <div className="detail-related-memories">{relatedMemories.map((item) => <button type="button" key={item.id} onClick={() => setRelatedPreview(item)}><span>{item.images[0] && (isVideo(item.images[0]) ? <video src={item.images[0]} muted playsInline preload="metadata" /> : <img src={item.images[0]} alt="" />)}</span><b>{item.title}</b><small>{item.date.replaceAll('-', '.')}</small></button>)}</div>}</div>}</section>}<div className="detail-tags">{memory.tags?.map((tag) => <span key={tag}>#{tag}</span>)}</div></div>{relatedPreview && <div className="related-memory-backdrop" role="dialog" aria-modal="true" onMouseDown={() => setRelatedPreview(undefined)}><section className="related-memory-preview" onMouseDown={(event) => event.stopPropagation()}><button type="button" className="related-memory-close" onClick={() => setRelatedPreview(undefined)} aria-label="닫기"><X size={18} /></button>{relatedPreview.images[0] && (isVideo(relatedPreview.images[0]) ? <video src={relatedPreview.images[0]} controls playsInline /> : <img src={relatedPreview.images[0]} alt={relatedPreview.title} />)}<small>{relatedPreview.date.replaceAll('-', '.')}</small><h2>{relatedPreview.title}</h2>{relatedPreview.description && <p>{relatedPreview.description}</p>}{relatedPreview.location && <button type="button" className="related-memory-map" onClick={() => { setRelatedPreview(undefined); try { sessionStorage.setItem(LOCATION_FOCUS_KEY, relatedPreview.location!); } catch {} const locationButton = Array.from(document.querySelectorAll<HTMLButtonElement>('.bottom-nav button')).find((button) => button.textContent?.includes('위치')); locationButton?.click(); }}><MapPin size={14} />{relatedPreview.location} 지도에서 보기</button>}</section></div>}{confirm && <div className="confirm-backdrop"><div className="confirm-dialog"><h3>이 추억을 삭제할까요?</h3><p>삭제한 추억은 다시 되돌릴 수 없어요.</p><div><button onClick={() => setConfirm(false)}>취소</button><button className="danger" onClick={() => { setConfirm(false); onDelete(); }}>삭제</button></div></div></div>}</div>;
}
