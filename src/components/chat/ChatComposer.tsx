import { ImagePlus, Send, X } from 'lucide-react';
import { useRef } from 'react';
import type { Message } from '../../types';

export function ChatComposer({ draft, reply, partnerName, onDraft, onSend, onImage, onCancelReply }: {
  draft: string; reply?: Message; partnerName: string; onDraft: (value: string) => void; onSend: () => void;
  onImage: (file: File) => void; onCancelReply: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  return <div className="composer-area">{reply && <div className="composer-reply"><div><b>{reply.sender === 'partner' ? `${partnerName}에게 답장` : '내 메시지에 답장'}</b><span>{reply.type === 'image' ? '사진' : reply.text}</span></div><button onClick={onCancelReply} aria-label="답장 취소"><X size={17} /></button></div>}<div className="composer"><input ref={fileRef} className="file-input" type="file" accept="image/*" onChange={(event) => { const file = event.target.files?.[0]; if (file) onImage(file); event.target.value = ''; }} /><button type="button" onClick={() => fileRef.current?.click()} aria-label="사진 선택"><ImagePlus size={21} /></button><textarea rows={1} value={draft} onChange={(event) => onDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); onSend(); } }} placeholder="메시지를 입력하세요..." /><button type="button" className={`send ${draft.trim() ? 'ready' : ''}`} disabled={!draft.trim()} onClick={onSend} aria-label="전송"><Send size={18} /></button></div></div>;
}
