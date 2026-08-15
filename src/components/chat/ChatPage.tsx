import { MoreHorizontal, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';
import type { Message } from '../../types';
import { messageDateLabel } from '../../utils/dates';
import { ChatBubble } from './ChatBubble';
import { ChatComposer } from './ChatComposer';

export function ChatPage({ Header, messages, setMessages }: { Header: ({ title }: { title?: string }) => React.ReactNode; messages: Message[]; setMessages: React.Dispatch<React.SetStateAction<Message[]>> }) {
  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState<number>();
  const [active, setActive] = useState<number>();
  const [lightbox, setLightbox] = useState<string>();
  const [highlighted, setHighlighted] = useState<number>();
  const bottomRef = useRef<HTMLDivElement>(null);
  const byId = useMemo(() => new Map(messages.map((message) => [message.id, message])), [messages]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages.length]);
  const send = () => {
    if (!draft.trim()) return;
    setMessages((items) => [...items, { id: Date.now(), sender: 'me', type: 'text', text: draft.trim(), timestamp: new Date().toISOString(), read: false, replyTo }]);
    setDraft(''); setReplyTo(undefined);
  };
  const sendImage = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => setMessages((items) => [...items, { id: Date.now(), sender: 'me', type: 'image', imageUrl: String(reader.result), timestamp: new Date().toISOString(), read: false, replyTo }]);
    reader.readAsDataURL(file); setReplyTo(undefined);
  };
  const react = (id: number, emoji: string) => setMessages((items) => items.map((message) => message.id !== id ? message : { ...message, reactions: message.reactions?.some((reaction) => reaction.by === 'me' && reaction.emoji === emoji) ? message.reactions.filter((reaction) => !(reaction.by === 'me' && reaction.emoji === emoji)) : [...(message.reactions ?? []).filter((reaction) => reaction.by !== 'me'), { emoji, by: 'me' }] }));
  const jump = (id: number) => { document.getElementById(`message-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }); setHighlighted(id); window.setTimeout(() => setHighlighted(undefined), 1400); };

  return <div className="page full-page chat-page"><Header title="대화" /><div className="chat-profile"><div className="avatar large">서</div><div><b>서연</b><span><i /> 지금 함께 있어요</span></div><button aria-label="대화 메뉴"><MoreHorizontal /></button></div><div className="messages" onClick={() => active && setActive(undefined)}>{messages.map((message, index) => { const date = new Date(message.timestamp).toDateString(); const previousDate = index > 0 ? new Date(messages[index - 1].timestamp).toDateString() : ''; const divider = date !== previousDate; return <div key={message.id}>{divider && <div className="date-chip">{messageDateLabel(message.timestamp)}</div>}<ChatBubble message={message} reply={message.replyTo ? byId.get(message.replyTo) : undefined} active={active === message.id} highlighted={highlighted === message.id} onAction={() => setActive(active === message.id ? undefined : message.id)} onReact={(emoji) => react(message.id, emoji)} onReply={() => { setReplyTo(message.id); setActive(undefined); }} onSave={() => { setMessages((items) => items.map((item) => item.id === message.id ? { ...item, saved: !item.saved } : item)); setActive(undefined); }} onImage={setLightbox} onJump={jump} /></div>; })}<div ref={bottomRef} /></div><ChatComposer draft={draft} reply={replyTo ? byId.get(replyTo) : undefined} onDraft={setDraft} onSend={send} onImage={sendImage} onCancelReply={() => setReplyTo(undefined)} />{lightbox && <div className="lightbox" role="dialog" onClick={() => setLightbox(undefined)}><button aria-label="닫기"><X /></button><img src={lightbox} alt="확대된 채팅 사진" /></div>}</div>;
}
