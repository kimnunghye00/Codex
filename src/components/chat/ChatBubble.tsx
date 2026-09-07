import { Bookmark, ChevronLeft, ChevronRight, CornerUpLeft, Download, Image as ImageIcon, X } from 'lucide-react';
import { memo, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import '../../route-chat-gallery-v21.css';
import '../../route-chat-hotfix-v24.css';
import { chatMediaPreviewUrl, downloadOriginalChatMedia, hasOptimizedChatPreview } from '../../lib/chatMediaReference';
import type { Message } from '../../types';
import { messageTime } from '../../utils/dates';
import { ReactionPicker } from './ReactionPicker';

const MAX_INLINE_GALLERY_ITEMS = 4;
const SWIPE_THRESHOLD = 42;

function replyLabel(message: Message) {
  if (message.type === 'image') return '사진';
  if (message.type === 'gallery') return `사진 ${message.imageUrls?.length ?? 0}장`;
  if (message.type === 'gif') return '움짤';
  return message.text?.slice(0, 45);
}

function DeferredMediaImage({ src, alt, className, onClick }: {
  src: string;
  alt: string;
  className?: string;
  onClick?: (event: React.MouseEvent<HTMLElement>) => void;
}) {
  const optimizedPreview = hasOptimizedChatPreview(src);
  const [failed, setFailed] = useState(false);

  useEffect(() => setFailed(false), [src]);

  // Photos sent before the compact-preview rollout intentionally never attach
  // their large original URL to an <img>. The incremental migration replaces
  // this status tile with a tiny preview reference as soon as it is ready.
  if (!optimizedPreview) {
    return <span
      className={`chat-legacy-media-gate ${className ?? ''}`}
      role="status"
      aria-label="사진 미리보기 최적화 중"
    ><ImageIcon size={20} /><small>미리보기 준비 중</small></span>;
  }

  if (failed) {
    return <span
      className={`chat-legacy-media-gate chat-preview-fallback ${className ?? ''}`}
      role={onClick ? 'button' : 'status'}
      tabIndex={onClick ? 0 : undefined}
      aria-label="사진 미리보기를 불러오지 못했어요"
      onClick={onClick}
      onKeyDown={onClick ? (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        onClick(event as unknown as React.MouseEvent<HTMLElement>);
      } : undefined}
    ><ImageIcon size={20} /><small>미리보기 다시 열기</small></span>;
  }

  // The previews are already ultra-small. Give WebView the real preview URL
  // immediately and let native loading="lazy" decide when off-screen images are
  // fetched. This avoids blank <img> nodes whose src stayed undefined while an
  // IntersectionObserver was waiting to fire.
  return <img
    className={className}
    src={chatMediaPreviewUrl(src)}
    alt={alt}
    loading="lazy"
    decoding="async"
    onError={() => setFailed(true)}
    onClick={onClick}
  />;
}

function GalleryViewer({ urls, initialIndex, onClose }: { urls: string[]; initialIndex: number; onClose: () => void }) {
  const [index, setIndex] = useState(() => Math.min(Math.max(0, initialIndex), Math.max(0, urls.length - 1)));
  const touchStartX = useRef<number | undefined>(undefined);

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
          <button type="button" className="route-gallery-download" aria-label="현재 사진 원본 저장" onClick={() => void downloadOriginalChatMedia(urls[index], index + 1)}><Download /></button>
          <button type="button" aria-label="사진 닫기" onClick={onClose}><X /></button>
        </header>
        <div className="route-gallery-viewer-media">
          {urls.length > 1 && <button type="button" className="route-gallery-arrow route-gallery-prev" aria-label="이전 사진" onClick={() => move(-1)}><ChevronLeft /></button>}
          <DeferredMediaImage src={urls[index]} alt={`묶음 사진 ${index + 1} / ${urls.length}`} />
          {urls.length > 1 && <button type="button" className="route-gallery-arrow route-gallery-next" aria-label="다음 사진" onClick={() => move(1)}><ChevronRight /></button>}
        </div>
        {urls.length > 1 && <div className="route-gallery-thumbs" aria-label="묶음 사진 목록">
          {urls.map((url, thumbIndex) => <button key={`${thumbIndex}-${chatMediaPreviewUrl(url).slice(-20)}`} type="button" className={thumbIndex === index ? 'active' : ''} onClick={() => setIndex(thumbIndex)} aria-label={`${thumbIndex + 1}번째 사진`}><DeferredMediaImage src={url} alt="" /></button>)}
        </div>}
        <div className="route-gallery-swipe-hint">미리보기는 데이터 절약 화질 · 저장하면 원본 화질</div>
      </section>
    </div>,
    document.body,
  );
}

type ChatBubbleProps = {
  message: Message; reply?: Message; partnerName: string; partnerInitial: string; active: boolean; highlighted: boolean;
  onAction: () => void; onReact: (emoji: string) => void; onReply: () => void;
  onSave: () => void; onImage: (url: string) => void; onJump: (id: number) => void;
};

function sameMessage(a?: Message, b?: Message) {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.id === b.id
    && a.sender === b.sender
    && a.type === b.type
    && a.text === b.text
    && a.imageUrl === b.imageUrl
    && a.imageUrls === b.imageUrls
    && a.timestamp === b.timestamp
    && a.read === b.read
    && a.replyTo === b.replyTo
    && a.reactions === b.reactions
    && a.saved === b.saved
    && a.scheduledFor === b.scheduledFor;
}

function ChatBubbleView({ message, reply, partnerName, partnerInitial, active, highlighted, onAction, onReact, onReply, onSave, onImage, onJump }: ChatBubbleProps) {
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
          {message.type === 'image' && message.imageUrl && <DeferredMediaImage className="chat-image" src={message.imageUrl} alt="채팅으로 보낸 사진" onClick={(event) => { event.stopPropagation(); onImage(message.imageUrl!); }} />}
          {message.type === 'gif' && message.imageUrl && <DeferredMediaImage className="chat-image chat-gif" src={message.imageUrl} alt="채팅으로 보낸 움짤" onClick={(event) => { event.stopPropagation(); onImage(message.imageUrl!); }} />}
          {message.type === 'gallery' && !!galleryUrls.length && <span className="chat-gallery-bundle">
            <span className="chat-gallery-total">사진 {galleryUrls.length}장</span>
            <span className="chat-gallery route-gallery-grid">{visibleGalleryUrls.map((url, index) => <span key={`${message.id}-${index}`} className="chat-gallery-item"><DeferredMediaImage src={url} alt={`묶음 사진 ${index + 1} / ${galleryUrls.length}`} onClick={(event) => { event.stopPropagation(); setGalleryIndex(index); }} />{index === visibleGalleryUrls.length - 1 && hiddenGalleryCount > 0 && <em>+{hiddenGalleryCount}</em>}</span>)}</span>
          </span>}
          {message.type === 'text' && <span className="message-text">{message.text}</span>}
        </button>
        {mediaBubble && message.imageUrl && <button type="button" className="chat-original-download" aria-label="원본 화질로 저장" onClick={(event) => { event.stopPropagation(); void downloadOriginalChatMedia(message.imageUrl!, 1); }}><Download size={13} /><span>원본</span></button>}
        <div className="message-meta">{message.saved && <Bookmark className="saved-mark" size={12} fill="currentColor" />}{message.scheduledFor && <span className="scheduled-mark">예약</span>}{galleryUrls.length > 1 && <span className="message-gallery-count">{galleryUrls.length}장</span>}<time>{messageTime(message.timestamp)}</time>{mine && <span>{message.read ? '읽음' : '전송됨'}</span>}</div>
        {!!message.reactions?.length && <div className="reaction-list">{Object.entries(message.reactions.reduce<Record<string, number>>((counts, reaction) => ({ ...counts, [reaction.emoji]: (counts[reaction.emoji] ?? 0) + 1 }), {})).map(([emoji, count]) => <button key={emoji} onClick={() => onReact(emoji)}>{emoji}{count > 1 && ` ${count}`}</button>)}</div>}
      </div>
    </div>
    {galleryIndex != null && <GalleryViewer urls={galleryUrls} initialIndex={galleryIndex} onClose={() => setGalleryIndex(undefined)} />}
  </>;
}

export const ChatBubble = memo(ChatBubbleView, (previous, next) => (
  sameMessage(previous.message, next.message)
  && sameMessage(previous.reply, next.reply)
  && previous.partnerName === next.partnerName
  && previous.partnerInitial === next.partnerInitial
  && previous.active === next.active
  && previous.highlighted === next.highlighted
));
