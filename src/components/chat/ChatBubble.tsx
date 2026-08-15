import { Bookmark, CornerUpLeft, Image as ImageIcon } from 'lucide-react';
import type { Message } from '../../types';
import { messageTime } from '../../utils/dates';
import { ReactionPicker } from './ReactionPicker';

export function ChatBubble({ message, reply, active, highlighted, onAction, onReact, onReply, onSave, onImage, onJump }: {
  message: Message; reply?: Message; active: boolean; highlighted: boolean;
  onAction: () => void; onReact: (emoji: string) => void; onReply: () => void;
  onSave: () => void; onImage: (url: string) => void; onJump: (id: number) => void;
}) {
  const mine = message.sender === 'me';
  return <div id={`message-${message.id}`} className={`bubble-row ${mine ? 'mine' : ''} ${highlighted ? 'highlighted' : ''}`}>
    {!mine && <div className="avatar tiny">서</div>}
    <div className="message-wrap">
      {active && <><ReactionPicker onSelect={onReact} /><div className="message-actions"><button onClick={onReply}><CornerUpLeft size={14} />답장</button><button onClick={onSave}>{message.saved ? <Bookmark size={14} fill="currentColor" /> : <Bookmark size={14} />} {message.saved ? '저장 취소' : '추억으로 저장'}</button></div></>}
      <button type="button" className="bubble" onClick={(event) => { event.stopPropagation(); onAction(); }} onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); onAction(); }}>
        {reply && <span className="reply-preview" onClick={(event) => { event.stopPropagation(); onJump(reply.id); }}><b>{reply.sender === 'me' ? '나' : '서연'}</b>{reply.type === 'image' ? <><ImageIcon size={12} /> 사진</> : reply.text?.slice(0, 45)}</span>}
        {message.type === 'image' && message.imageUrl ? <img className="chat-image" src={message.imageUrl} alt="채팅으로 보낸 사진" onClick={(event) => { event.stopPropagation(); onImage(message.imageUrl!); }} /> : <span className="message-text">{message.text}</span>}
      </button>
      <div className="message-meta">{message.saved && <Bookmark className="saved-mark" size={12} fill="currentColor" />}<time>{messageTime(message.timestamp)}</time>{mine && <span>{message.read ? '읽음' : '전송됨'}</span>}</div>
      {!!message.reactions?.length && <div className="reaction-list">{Object.entries(message.reactions.reduce<Record<string, number>>((counts, reaction) => ({ ...counts, [reaction.emoji]: (counts[reaction.emoji] ?? 0) + 1 }), {})).map(([emoji, count]) => <button key={emoji} onClick={() => onReact(emoji)}>{emoji}{count > 1 && ` ${count}`}</button>)}</div>}
    </div>
  </div>;
}
