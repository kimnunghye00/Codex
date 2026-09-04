import { CalendarClock, Gift, ImagePlus, Laugh, Plus, Send, X } from 'lucide-react';
import { useRef, useState } from 'react';
import type { Message } from '../../types';

const QUICK = ['기분 좋아 😊', '배고파 🍚', '심심해 🫠', '우울해 🥺', '놀아줘 ❤️'];

export function ChatComposer({ draft, reply, partnerName, onDraft, onSend, onImages, onGif, onQuick, onSchedule, onGift, onCancelReply }: {
  draft: string; reply?: Message; partnerName: string; onDraft: (value: string) => void; onSend: () => void;
  onImages: (files: File[]) => void; onGif: (file: File) => void; onQuick: (text: string) => void;
  onSchedule: () => void; onGift: () => void; onCancelReply: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const gifRef = useRef<HTMLInputElement>(null);
  const composingRef = useRef(false);
  const [extras, setExtras] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  return <div className="composer-area">
    {reply && <div className="composer-reply"><div><b>{reply.sender === 'partner' ? `${partnerName}에게 답장` : '내 메시지에 답장'}</b><span>{reply.type === 'image' || reply.type === 'gallery' || reply.type === 'gif' ? '미디어' : reply.text}</span></div><button onClick={onCancelReply} aria-label="답장 취소"><X size={17} /></button></div>}
    {quickOpen && <div className="quick-contact-strip">{QUICK.map((item) => <button key={item} type="button" onClick={() => { onQuick(item); setQuickOpen(false); }}>{item}</button>)}</div>}
    {extras && <div className="composer-extra-row">
      <button type="button" onClick={() => fileRef.current?.click()}><ImagePlus size={18} /><span>사진</span></button>
      <button type="button" onClick={() => gifRef.current?.click()}><Laugh size={18} /><span>움짤</span></button>
      <button type="button" onClick={() => { setQuickOpen((value) => !value); }}><span className="extra-heart">♥</span><span>빠른 연락</span></button>
      <button type="button" onClick={onSchedule}><CalendarClock size={18} /><span>예약</span></button>
      <button type="button" onClick={onGift}><Gift size={18} /><span>선물</span></button>
    </div>}
    <div className="composer">
      <input ref={fileRef} className="file-input" type="file" accept="image/*" multiple onChange={(event) => { const files = Array.from(event.target.files ?? []).slice(0, 10); if (files.length) onImages(files); event.target.value = ''; }} />
      <input ref={gifRef} className="file-input" type="file" accept="image/gif" onChange={(event) => { const file = event.target.files?.[0]; if (file) onGif(file); event.target.value = ''; }} />
      <button type="button" onClick={() => setExtras((value) => !value)} aria-label="추가 기능"><Plus size={21} /></button>
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
      <button type="button" className={`send ${draft.trim() ? 'ready' : ''}`} disabled={!draft.trim()} onClick={onSend} aria-label="전송"><Send size={18} /></button>
    </div>
  </div>;
}
