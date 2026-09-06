import { Bookmark, ChevronLeft, ChevronRight, CornerUpLeft, Image as ImageIcon, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Message } from '../../types';
import { messageTime } from '../../utils/dates';
import { ReactionPicker } from './ReactionPicker';

const MAX_INLINE_GALLERY_ITEMS = 18;
const SWIPE_THRESHOLD = 42;

function replyLabel(message: Message) {
  if (message.type === 'image') return '사진';
  if (message.type === 'gallery') return `사진 ${message.imageUrls?.length ?? 0}장`;
  if (message.type === 'gif') return '움짤';
  return message.text?.slice(0, 45);
}

function GalleryViewer({ urls, initialIndex, onClose }: { urls: string[]; initialIndex: number; onClose: () => void }) {
  const [index, setIndex] = useState(() => Math.min(Math.max(0, initialIndex), Math.max(0, urls.length - 1)));
  const touchStartX = useRef<number>();

  const move = (delta: number) => {
    if (urls.length <= 1) return;
    setIndex((current) => (current + delta + urls.length) % urls.length);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowLeft') move(-1);
      if (event.key === 'ArrowRight') move(1);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  if (!urls.length || typeof document === 'undefined') return null;

  return createPortal(
    <div className="route-gallery-viewer" role="dialog" aria-modal="true" aria-label={`사진 ${index + 1} / ${urls.length}`} onClick={onClose}>
      <section
        className="route-gallery-viewer-stage"
        onClick={(event) => event.stopPropagation()}
        onTouchStart={(event) => { touchStartX.current = event.changedTouches[0]?.clientX; }}
        onTouchEnd={(event) => {
          const start = touchStartX.current;
          const end = event.changedTouches[0]?.clientX;
          touchStartX.current = undefined;
          if (start == null || end == null) return;
          const distance = end - start;
          if (Math.abs(distance) < SWIPE_THRESHOLD) return;
          move(distance > 0 ? -1 : 1);
        }}
      >
        <header className="route-gallery-viewer-head">
          <strong>{index + 1} / {urls.length}</strong>
          <button type="button" aria-label="사진 닫기" onClick={onClose}><X /></button>
        </header>
        <div className="route-gallery-viewer-media">
          {urls.length > 1 && <button type="button" className="route-gallery-arrow route-gallery-prev" aria-label="이전 사진" onClick={() => move(-1)}><ChevronLeft /></button>}
          <img src={urls[index]} alt={`묶음 사진 ${index + 1} / ${urls.length}`} />
          {urls.length > 1 && <button type="button" className="route-gallery-arrow route-gallery-next" aria-label="다음 사진" onClick={() => move(1)}><ChevronRight /></button>}
        </div>
        {urls.length > 1 && <div className="route-gallery-thumbs" aria-label="묶음 사진 목록">
          {urls.map((url, thumbIndex) => <button key={`${url.slice(0, 32)}-${thumbIndex}`} type="button" className={thumbIndex === index ? 'active' : ''} onClick={() => setIndex(thumbIndex)} aria-label={`${thumbIndex + 1}번째 사진`}><img src={url} alt="" /></button>)}
        </div>}
        <div className="route-gallery-swipe-hint">좌우로 밀어서 사진을 넘길 수 있어요</div>
      </section>
    </div>,
    document.body,
  );
}

export function ChatBubble({ message, reply, partnerName, partnerInitial, active, highlighted, onAction, onReact, onReply, onSave, onImage, onJump }: {
  message: Message; reply?: Message; partnerName: string; partnerInitial: string; active: boolean; highlighted: boolean;
  onAction: () => void; onReact: (emoji: string) => void; onReply: () => void;
  onSave: () => void; onImage: (url: string) => void; onJump: (id: number) => void;
}) {
  const [galleryIndex, setGalleryIndex] = useState<number>();
  const mine = message.sender === 'me';
  const mediaBubble = message.type === 'image' || message.type === 'gif';
  const memoryCapable = message.type === 'image' || message.type === 'gallery' || message.type === 'gif';
  const galleryUrls = message.type === 'gallery' ? message.imageUrls ?? [] : [];
  const visibleGalleryUrls = galleryUrls.slice(0, MAX_INLINE_GALLERY_ITEMS);
  const hiddenGalleryCount = Math.max(0, galleryUrls.length - visibleGalleryUrls.length);
  const saveLabel = memoryCapable
    ? message.saved ? '추억에서 제거' : '추억에 저장'
    : message.saved ? '저장 취소' : '메시지 저장';

  return <>
    <div id={`message-${message.id}`} className={`bubble-row ${mine ? 'mine' : ''} ${highlighted ? 'highlighted' : ''}`}>
      {!mine && <div className="avatar tiny">{partnerInitial}</div>}
      <div className="message-wrap">
        {active && <><ReactionPicker onSelect={onReact} /><div className="message-actions"><button onClick={onReply}><CornerUpLeft size={14} />답장</button><button onClick={onSave}>{message.saved ? <Bookmark size={14} fill="currentColor" /> : <Bookmark size={14} />} {saveLabel}</button></div></>}
        <button type="button" className={`bubble ${message.type === 'gallery' ? 'gallery-bubble' : ''} ${mediaBubble ? 'media-bubble' : ''}`} onClick={(event) => { event.stopPropagation(); onAction(); }} onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); onAction(); }}>
          {reply && <span className="reply-preview" onClick={(event) => { event.stopPropagation(); onJump(reply.id); }}><b>{reply.sender === 'me' ? '나' : partnerName}</b>{reply.type !== 'text' ? <><ImageIcon size={12} /> {replyLabel(reply)}</> : replyLabel(reply)}</span>}
          {message.type === 'image' && message.imageUrl && <img className="chat-image" src={message.imageUrl} alt="채팅으로 보낸 사진" onClick={(event) => { event.stopPropagation(); onImage(message.imageUrl!); }} />}
          {message.type === 'gif' && message.imageUrl && <img className="chat-image chat-gif" src={message.imageUrl} alt="채팅으로 보낸 움짤" onClick={(event) => { event.stopPropagation(); onImage(message.imageUrl!); }} />}
          {message.type === 'gallery' && !!galleryUrls.length && <span className="chat-gallery-bundle">
            <span className="chat-gallery-total">사진 {galleryUrls.length}장</span>
            <span className="chat-gallery route-gallery-grid">{visibleGalleryUrls.map((url, index) => <span key={`${url.slice(0, 24)}-${index}`} className="chat-gallery-item"><img src={url} alt={`묶음 사진 ${index + 1} / ${galleryUrls.length}`} onClick={(event) => { event.stopPropagation(); setGalleryIndex(index); }} />{index === visibleGalleryUrls.length - 1 && hiddenGalleryCount > 0 && <em>+{hiddenGalleryCount}</em>}</span>)}</span>
          </span>}
          {message.type === 'text' && <span className="message-text">{message.text}</span>}
        </button>
        <div className="message-meta">{message.saved && <Bookmark className="saved-mark" size={12} fill="currentColor" />}{message.scheduledFor && <span className="scheduled-mark">예약</span>}{galleryUrls.length > 1 && <span className="message-gallery-count">{galleryUrls.length}장</span>}<time>{messageTime(message.timestamp)}</time>{mine && <span>{message.read ? '읽음' : '전송됨'}</span>}</div>
        {!!message.reactions?.length && <div className="reaction-list">{Object.entries(message.reactions.reduce<Record<string, number>>((counts, reaction) => ({ ...counts, [reaction.emoji]: (counts[reaction.emoji] ?? 0) + 1 }), {})).map(([emoji, count]) => <button key={emoji} onClick={() => onReact(emoji)}>{emoji}{count > 1 && ` ${count}`}</button>)}</div>}
      </div>
    </div>
    {galleryIndex != null && <GalleryViewer urls={galleryUrls} initialIndex={galleryIndex} onClose={() => setGalleryIndex(undefined)} />}
  </>;
}
