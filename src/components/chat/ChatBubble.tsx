import { Bookmark, Check, ChevronLeft, ChevronRight, CornerUpLeft, Download, Image as ImageIcon, RefreshCw, Trash2, X } from 'lucide-react';
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
const CHAT_MEDIA_PREFETCH_MARGIN = '400px 0px';
const PREVIEW_STATUS_EVENT = 'route-chat-media-preview-status';
const PREVIEW_STATUS_REQUEST_EVENT = 'route-chat-media-preview-status-request';
const PREVIEW_RETRY_EVENT = 'route-chat-media-preview-retry';

// Virtualized rows are fully unmounted once they scroll out of range, so a
// photo you already scrolled past would otherwise replay its whole
// "wait to intersect -> start loading" dance the moment it re-enters view,
// even though the browser still has it cached. Remembering which src values
// have already painted once (module scope, so it survives remounts) lets a
// returning row skip straight to "ready".
const seenMediaSrcs = new Set<string>();

type LegacyPreviewState = 'optimizing' | 'retrying' | 'failed';
type PreviewStatusDetail = {
  reference?: string;
  status?: 'optimizing' | 'retrying' | 'failed' | 'ready';
  code?: string;
};

function replyLabel(message: Message) {
  if (message.type === 'image') return '사진';
  if (message.type === 'gallery') return `사진 ${message.imageUrls?.length ?? 0}장`;
  if (message.type === 'gif') return '움짤';
  return message.text?.slice(0, 45);
}

function retryableUrl(url: string, retry: number) {
  if (!retry) return url;
  return `${url}${url.includes('?') ? '&' : '?'}route-preview-retry=${retry}`;
}

function DeferredMediaImage({ src, alt, className, onClick, eager = false }: {
  src: string;
  alt: string;
  className?: string;
  onClick?: (event: React.MouseEvent<HTMLElement>) => void;
  eager?: boolean;
}) {
  const optimizedPreview = hasOptimizedChatPreview(src);
  const alreadySeen = seenMediaSrcs.has(src);
  const [legacyState, setLegacyState] = useState<LegacyPreviewState>('optimizing');
  const [failureCode, setFailureCode] = useState('');
  const [previewFailed, setPreviewFailed] = useState(false);
  const [previewRetry, setPreviewRetry] = useState(0);
  const [mediaReady, setMediaReady] = useState(eager || alreadySeen);
  const [legacyRequested, setLegacyRequested] = useState(eager || alreadySeen);
  const mediaAnchorRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const ready = eager || seenMediaSrcs.has(src);
    setLegacyState('optimizing');
    setFailureCode('');
    setPreviewFailed(false);
    setPreviewRetry(0);
    // Same-value setState calls below bail out without a re-render, so this
    // is a no-op for a row that mounted already-ready — it only matters when
    // `src` actually changes on a live instance (e.g. swiping the gallery
    // viewer to the next photo).
    setMediaReady(ready);
    setLegacyRequested(ready);
  }, [src, eager]);

  useEffect(() => {
    if (mediaReady || eager) return;
    const target = mediaAnchorRef.current;
    if (!target || typeof IntersectionObserver === 'undefined') {
      setMediaReady(true);
      return;
    }

    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      observer.disconnect();
      setMediaReady(true);
    }, { rootMargin: CHAT_MEDIA_PREFETCH_MARGIN, threshold: 0.01 });
    observer.observe(target);
    return () => observer.disconnect();
  }, [eager, mediaReady, src]);

  useEffect(() => {
    if (optimizedPreview || !mediaReady || legacyRequested) return;
    setLegacyRequested(true);
  }, [legacyRequested, mediaReady, optimizedPreview]);

  useEffect(() => {
    if (optimizedPreview || !legacyRequested) return;
    const handleStatus = (event: Event) => {
      const detail = (event as CustomEvent<PreviewStatusDetail>).detail;
      if (!detail || detail.reference !== src) return;
      if (detail.status === 'failed') {
        setLegacyState('failed');
        setFailureCode(detail.code ?? 'unknown');
      } else if (detail.status === 'retrying') {
        setLegacyState('retrying');
        setFailureCode(detail.code ?? '');
      } else if (detail.status === 'optimizing') {
        setLegacyState('optimizing');
        setFailureCode('');
      }
    };
    window.addEventListener(PREVIEW_STATUS_EVENT, handleStatus);
    window.dispatchEvent(new CustomEvent(PREVIEW_STATUS_REQUEST_EVENT, { detail: { reference: src } }));
    return () => window.removeEventListener(PREVIEW_STATUS_EVENT, handleStatus);
  }, [legacyRequested, optimizedPreview, src]);

  const retryLegacy = (event: React.MouseEvent<HTMLElement> | React.KeyboardEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setLegacyState('retrying');
    setFailureCode('');
    setLegacyRequested(true);
    window.dispatchEvent(new CustomEvent(PREVIEW_RETRY_EVENT, { detail: { reference: src } }));
  };

  if (!mediaReady) {
    return <span
      ref={mediaAnchorRef}
      className={`chat-legacy-media-gate ${className ?? ''}`}
      role="img"
      aria-label="사진 미리보기"
    ><ImageIcon size={20} /><small>사진 미리보기</small></span>;
  }

  if (!optimizedPreview && !legacyRequested) {
    return <span
      ref={mediaAnchorRef}
      className={`chat-legacy-media-gate ${className ?? ''}`}
      role="img"
      aria-label="사진 미리보기"
    ><ImageIcon size={20} /><small>사진 미리보기</small></span>;
  }

  if (!optimizedPreview) {
    const failed = legacyState === 'failed';
    const label = failed
      ? '미리보기 재시도'
      : legacyState === 'retrying'
        ? '미리보기 다시 시도 중…'
        : '사진 최적화 중…';
    return <span
      className={`chat-legacy-media-gate ${failed ? 'chat-preview-failed' : legacyState === 'retrying' ? 'chat-preview-retrying' : ''} ${className ?? ''}`}
      role={failed ? 'button' : 'status'}
      tabIndex={failed ? 0 : undefined}
      aria-label={failed ? `사진 미리보기 실패. 다시 시도${failureCode ? ` (${failureCode})` : ''}` : label}
      onClick={failed ? retryLegacy : undefined}
      onKeyDown={failed ? (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        retryLegacy(event);
      } : undefined}
    >{failed ? <RefreshCw size={20} /> : <ImageIcon size={20} />}<small>{label}</small></span>;
  }

  if (previewFailed) {
    return <span
      className={`chat-legacy-media-gate chat-preview-failed ${className ?? ''}`}
      role="button"
      tabIndex={0}
      aria-label="사진 미리보기를 불러오지 못했어요. 다시 시도"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setPreviewFailed(false);
        setPreviewRetry((value) => value + 1);
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        event.stopPropagation();
        setPreviewFailed(false);
        setPreviewRetry((value) => value + 1);
      }}
    ><RefreshCw size={20} /><small>미리보기 다시 불러오기</small></span>;
  }

  const displayUrl = retryableUrl(chatMediaPreviewUrl(src), previewRetry);
  return <img
    className={className}
    src={displayUrl}
    alt={alt}
    loading={eager ? 'eager' : 'lazy'}
    decoding="async"
    onLoad={() => seenMediaSrcs.add(src)}
    onError={() => setPreviewFailed(true)}
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
          <DeferredMediaImage src={urls[index]} alt={`묶음 사진 ${index + 1} / ${urls.length}`} eager />
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
  selectionMode: boolean; selected: boolean;
  onAction: () => void; onReact: (emoji: string) => void; onReply: () => void;
  onSave: () => void; onDelete: () => void; onToggleSelect: () => void;
  onImage: (url: string) => void; onJump: (id: number) => void;
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

function ChatBubbleView({ message, reply, partnerName, partnerInitial, active, highlighted, selectionMode, selected, onAction, onReact, onReply, onSave, onDelete, onToggleSelect, onImage, onJump }: ChatBubbleProps) {
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

  const mediaRow = message.type === 'image' || message.type === 'gif' || message.type === 'gallery';

  return <>
    <div id={`message-${message.id}`} className={`bubble-row ${mine ? 'mine' : ''} ${highlighted ? 'highlighted' : ''} ${mediaRow ? 'bubble-row-media' : ''} ${active && !selectionMode ? 'chat-actions-open' : ''} ${selectionMode && mine ? 'chat-selectable-row' : ''} ${selected ? 'chat-selected-row' : ''}`}>
      {selectionMode && mine && <button type="button" className={`chat-message-select ${selected ? 'selected' : ''}`} aria-label={selected ? '선택 해제' : '메시지 선택'} onClick={(event) => { event.stopPropagation(); onToggleSelect(); }}>{selected ? <Check size={15} strokeWidth={3} /> : null}</button>}
      {!mine && <div className="avatar tiny">{partnerInitial}</div>}
      {active && !selectionMode && <div className="chat-message-side-tools" onClick={(event) => event.stopPropagation()}>
        <ReactionPicker onSelect={onReact} />
        <div className="message-actions"><button onClick={onReply}><CornerUpLeft size={14} />답장</button><button onClick={onSave}>{message.saved ? <Bookmark size={14} fill="currentColor" /> : <Bookmark size={14} />} {saveLabel}</button>{mine && <button className="message-delete-action" onClick={onDelete}><Trash2 size={14} />삭제</button>}</div>
      </div>}
      <div className="message-wrap">
        <button type="button" className={`bubble ${message.type === 'gallery' ? 'gallery-bubble' : ''} ${mediaBubble ? 'media-bubble' : ''}`} onClick={(event) => { event.stopPropagation(); if (selectionMode && mine) onToggleSelect(); else if (!selectionMode) onAction(); }} onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); if (selectionMode && mine) onToggleSelect(); else if (!selectionMode) onAction(); }}>
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
  && previous.selectionMode === next.selectionMode
  && previous.selected === next.selected
));
