import { Bookmark, CornerUpLeft, Image as ImageIcon } from 'lucide-react';
import type { Message } from '../../types';
import { messageTime } from '../../utils/dates';
import { ReactionPicker } from './ReactionPicker';

function replyLabel(message: Message) {
  if (message.type === 'image') return '사진';
  if (message.type === 'gallery') return `사진 ${message.imageUrls?.length ?? 0}장`;
  if (message.type === 'gif') return '움짤';
  return message.text?.slice(0, 45);
}

export function ChatBubble({ message, reply, partnerName, partnerInitial, active, highlighted, onAction, onReact, onReply, onSave, onImage, onJump }: {
  message: Message; reply?: Message; partnerName: string; partnerInitial: string; active: boolean; highlighted: boolean;
  onAction: () => void; onReact: (emoji: string) => void; onReply: () => void;
  onSave: () => void; onImage: (url: string) => void; onJump: (id: number) => void;
}) {
  const mine = message.sender === 'me';
  const mediaBubble = message.type === 'image' || message.type === 'gif';
  return <div id={`message-${message.id}`} className={`bubble-row ${mine ? 'mine' : ''} ${highlighted ? 'highlighted' : ''}`}>
    {!mine && <div className="avatar tiny">{partnerInitial}</div>}
    <div className="message-wrap">
      {active && <><ReactionPicker onSelect={onReact} /><div className="message-actions"><button onClick={onReply}><CornerUpLeft size={14} />답장</button><button onClick={onSave}>{message.saved ? <Bookmark size={14} fill="currentColor" /> : <Bookmark size={14} />} {message.saved ? '저장 취소' : '추억으로 저장'}</button></div></>}
      <button type="button" className={`bubble ${message.type === 'gallery' ? 'gallery-bubble' : ''} ${mediaBubble ? 'media-bubble' : ''}`} onClick={(event) => { event.stopPropagation(); onAction(); }} onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); onAction(); }}>
        {reply && <span className="reply-preview" onClick={(event) => { event.stopPropagation(); onJump(reply.id); }}><b>{reply.sender === 'me' ? '나' : partnerName}</b>{reply.type !== 'text' ? <><ImageIcon size={12} /> {replyLabel(reply)}</> : replyLabel(reply)}</span>}
        {message.type === 'image' && message.imageUrl && <img className="chat-image" src={message.imageUrl} alt="채팅으로 보낸 사진" onClick={(event) => { event.stopPropagation(); onImage(message.imageUrl!); }} />}
        {message.type === 'gif' && message.imageUrl && <img className="chat-image chat-gif" src={message.imageUrl} alt="채팅으로 보낸 움짤" onClick={(event) => { event.stopPropagation(); onImage(message.imageUrl!); }} />}
        {message.type === 'gallery' && !!message.imageUrls?.length && <span className={`chat-gallery count-${Math.min(message.imageUrls.length, 4)}`}>{message.imageUrls.slice(0, 4).map((url, index) => <span key={`${url.slice(0, 24)}-${index}`} className="chat-gallery-item"><img src={url} alt={`묶음 사진 ${index + 1}`} onClick={(event) => { event.stopPropagation(); onImage(url); }} />{index === 3 && message.imageUrls!.length > 4 && <em>+{message.imageUrls!.length - 4}</em>}</span>)}</span>}
        {message.type === 'text' && <span className="message-text">{message.text}</span>}
      </button>
      <div className="message-meta">{message.saved && <Bookmark className="saved-mark" size={12} fill="currentColor" />}{message.scheduledFor && <span className="scheduled-mark">예약</span>}<time>{messageTime(message.timestamp)}</time>{mine && <span>{message.read ? '읽음' : '전송됨'}</span>}</div>
      {!!message.reactions?.length && <div className="reaction-list">{Object.entries(message.reactions.reduce<Record<string, number>>((counts, reaction) => ({ ...counts, [reaction.emoji]: (counts[reaction.emoji] ?? 0) + 1 }), {})).map(([emoji, count]) => <button key={emoji} onClick={() => onReact(emoji)}>{emoji}{count > 1 && ` ${count}`}</button>)}</div>}
    </div>
  </div>;
}
