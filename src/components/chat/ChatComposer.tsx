import { CalendarClock, Gift, ImagePlus, Plus, Send, Sticker as StickerIcon, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Message } from '../../types';
import { DANDULI_STICKERS, DanduliSticker, stickerToken } from './DanduliSticker';

const QUICK = ['기분 좋아 😊', '배고파 🍚', '심심해 🫠', '우울해 🥺', '놀아줘 ❤️'];
const MAX_CHAT_PHOTO_SELECTION = 100;

type PendingPhoto = {
  id: string;
  file: File;
  previewUrl: string;
};

export function ChatComposer({ draft, reply, partnerName, onDraft, onSend, onImages, onGif, onQuick, onSticker, onSchedule, onGift, onCancelReply }: {
  draft: string; reply?: Message; partnerName: string; onDraft: (value: string) => void; onSend: () => void;
  onImages: (files: File[]) => Promise<void> | void; onGif: (file: File) => Promise<void> | void; onQuick: (text: string) => void;
  onSticker: (sticker: string) => void; onSchedule: () => void; onGift: () => void; onCancelReply: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const gifRef = useRef<HTMLInputElement>(null);
  const composingRef = useRef(false);
  const pendingRef = useRef<PendingPhoto[]>([]);
  const [extras, setExtras] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [stickerOpen, setStickerOpen] = useState(false);
  const [pendingPhotos, setPendingPhotos] = useState<PendingPhoto[]>([]);
  const [photoSending, setPhotoSending] = useState(false);

  useEffect(() => {
    pendingRef.current = pendingPhotos;
  }, [pendingPhotos]);

  useEffect(() => () => {
    pendingRef.current.forEach((item) => URL.revokeObjectURL(item.previewUrl));
  }, []);

  const clearPendingPhotos = () => {
    pendingRef.current.forEach((item) => URL.revokeObjectURL(item.previewUrl));
    pendingRef.current = [];
    setPendingPhotos([]);
  };

  const addPendingPhotos = (rawFiles: File[]) => {
    if (!rawFiles.length) return;
    const remaining = Math.max(0, MAX_CHAT_PHOTO_SELECTION - pendingRef.current.length);
    if (!remaining) return;
    const next = rawFiles.slice(0, remaining).map((rawFile, index) => ({
      id: `${rawFile.name}-${rawFile.lastModified}-${Date.now()}-${index}`,
      file: rawFile,
      previewUrl: URL.createObjectURL(rawFile),
    }));
    setPendingPhotos((current) => [...current, ...next]);
    setExtras(false);
    setQuickOpen(false);
  };

  const removePendingPhoto = (id: string) => {
    setPendingPhotos((current) => {
      const removed = current.find((item) => item.id === id);
      if (removed) URL.revokeObjectURL(removed.previewUrl);
      return current.filter((item) => item.id !== id);
    });
  };

  const sendPendingPhotos = async () => {
    if (photoSending) return;
    const originals = pendingRef.current.map((item) => item.file);
    if (!originals.length) return;
    pendingRef.current.forEach((item) => URL.revokeObjectURL(item.previewUrl));
    pendingRef.current = [];
    setPendingPhotos([]);
    setPhotoSending(true);
    try {
      // Keep the selected File objects intact all the way to ChatPage/Firebase.
      // This avoids cloning and lets the upload path stream Blob bytes directly
      // instead of first expanding every photo into a Base64 data URL.
      await Promise.resolve(onImages(originals));
    } finally {
      setPhotoSending(false);
    }
  };

  const preview = pendingPhotos.length > 0 && typeof document !== 'undefined'
    ? createPortal(
      <div className="route-photo-send-preview" role="dialog" aria-modal="true" aria-label={`사진 ${pendingPhotos.length}장 전송 미리보기`}>
        <header className="route-photo-send-head">
          <button type="button" aria-label="사진 선택 취소" onClick={clearPendingPhotos}><X /></button>
          <div><strong>사진 보내기</strong><span>{pendingPhotos.length} / {MAX_CHAT_PHOTO_SELECTION}장 선택</span></div>
          <button type="button" className="route-photo-add-more" onClick={() => fileRef.current?.click()}><Plus size={18} /> 추가</button>
        </header>
        <div className="route-photo-send-grid">
          {pendingPhotos.map((item, index) => <figure key={item.id}>
            <img src={item.previewUrl} alt={`전송할 사진 ${index + 1}`} />
            <span className="route-photo-order">{index + 1}</span>
            <button type="button" className="route-photo-remove" aria-label={`${index + 1}번째 사진 선택 해제`} onClick={() => removePendingPhoto(item.id)}><X size={16} /></button>
          </figure>)}
        </div>
        <footer className="route-photo-send-footer">
          <div><b>{pendingPhotos.length}장</b><span>채팅에는 압축 미리보기 · 저장은 원본 화질</span></div>
          <button type="button" className="route-photo-send-confirm" disabled={photoSending} onClick={() => void sendPendingPhotos()}><Send size={18} /> {photoSending ? '전송 중' : `${pendingPhotos.length}장 보내기`}</button>
        </footer>
      </div>,
      document.body,
    )
    : null;

  return <>
    <div className="composer-area">
      {reply && <div className="composer-reply"><div><b>{reply.sender === 'partner' ? `${partnerName}에게 답장` : '내 메시지에 답장'}</b><span>{reply.type === 'sticker' ? '이모티콘' : reply.type === 'image' || reply.type === 'gallery' || reply.type === 'gif' ? '미디어' : reply.text}</span></div><button onClick={onCancelReply} aria-label="답장 취소"><X size={17} /></button></div>}
      {stickerOpen && <div className="composer-sticker-tray" aria-label="단둘이 이모티콘 16종">{DANDULI_STICKERS.map((item) => <button key={item.id} type="button" aria-label={`${item.label} 이모티콘 보내기`} onClick={() => { onSticker(stickerToken(item.id)); setStickerOpen(false); }}><DanduliSticker id={item.id} /></button>)}</div>}
      {quickOpen && <div className="quick-contact-strip">{QUICK.map((item) => <button key={item} type="button" onClick={() => { onQuick(item); setQuickOpen(false); setStickerOpen(false); }}>{item}</button>)}</div>}
      {extras && <div className="composer-extra-row">
        <button type="button" onClick={() => fileRef.current?.click()}><ImagePlus size={18} /><span>사진</span></button>
        <button type="button" onClick={() => { setQuickOpen((value) => !value); }}><span className="extra-heart">♥</span><span>빠른 연락</span></button>
        <button type="button" onClick={onSchedule}><CalendarClock size={18} /><span>예약</span></button>
        <button type="button" onClick={onGift}><Gift size={18} /><span>선물</span></button>
      </div>}
      <div className="composer">
        <input ref={fileRef} className="file-input" type="file" accept="image/*" multiple aria-label={`사진 선택, 최대 ${MAX_CHAT_PHOTO_SELECTION}장`} onChange={(event) => { addPendingPhotos(Array.from(event.target.files ?? [])); event.target.value = ''; }} />
        <input ref={gifRef} className="file-input" type="file" accept="image/gif" onChange={(event) => { const file = event.target.files?.[0]; if (file) void onGif(file); event.target.value = ''; }} />
        <button type="button" onClick={() => { setExtras((value) => !value); setStickerOpen(false); }} aria-label="추가 기능"><Plus size={21} /></button>
        <button type="button" className={`composer-sticker-toggle ${stickerOpen ? 'active' : ''}`} onClick={() => { setStickerOpen((value) => !value); setExtras(false); setQuickOpen(false); }} aria-label="이모티콘"><StickerIcon size={20} /></button>
        <textarea
          rows={1}
          value={draft}
          onChange={(event) => onDraft(event.target.value)}
          onCompositionStart={() => { composingRef.current = true; }}
          onCompositionEnd={(event) => { composingRef.current = false; onDraft(event.currentTarget.value); }}
          onKeyDown={(event) => {
            const nativeEvent = event.nativeEvent as KeyboardEvent;
            if (event.key === 'Enter' && !event.shiftKey && !composingRef.current && !nativeEvent.isComposing) {
              event.preventDefault();
              onSend();
            }
          }}
          enterKeyHint="send"
          autoCorrect="on"
          spellCheck
          placeholder="메시지를 입력하세요..."
        />
        {draft.trim()
          ? <button type="button" className="send ready" onClick={onSend} aria-label="메시지 전송"><Send size={18} /></button>
          : <button type="button" className="composer-gif-shortcut" onClick={() => gifRef.current?.click()} aria-label="움짤 보내기">
            <span className="composer-gif-lens" aria-hidden="true" />
          </button>}
      </div>
    </div>
    {preview}
  </>;
}
