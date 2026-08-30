import { Bot, MoreHorizontal, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';
import { auth } from '../../lib/firebase';
import { AI_TEST_PARTNER_NAME, loadLocalAiPartner } from '../../lib/coupleData';
import { getRealCoupleConnection } from '../../lib/coupleConnection';
import type { Message } from '../../types';
import { messageDateLabel } from '../../utils/dates';
import { ChatBubble } from './ChatBubble';
import { ChatComposer } from './ChatComposer';

function aiReplyFor(text: string) {
  const value = text.trim();
  const lower = value.toLowerCase();

  if (!value) return '응, 듣고 있어.';
  if (/안녕|하이|hello|hi/.test(lower)) return '안녕! 이제 ROUTE 안에서도 대화 테스트를 할 수 있어 😊';
  if (/별명/.test(value)) return '별명 기능도 같이 확인해보자. 내가 지어준 별명이 홈 화면과 설정에 같은 이름으로 보이는지 확인해줘.';
  if (/오류|에러|버그|안돼|안 돼|문제/.test(value)) return '어디에서 문제가 생겼는지 알려줘. 어떤 버튼을 눌렀는지와 화면에 보이는 문구를 같이 확인해보자.';
  if (/테스트/.test(value)) return '좋아. 메시지 전송, 답장, 반응, 이미지 같은 기능을 하나씩 테스트해보자.';
  if (/고마워|감사/.test(value)) return '천만에 😊 계속 같이 테스트해보자.';
  if (value.endsWith('?') || value.endsWith('？')) return `지금은 앱 내부 테스트 응답 모드라 복잡한 답변은 제한돼 있어. 그래도 “${value.slice(0, 22)}${value.length > 22 ? '…' : ''}”에 대한 대화 흐름은 정상적으로 테스트할 수 있어.`;
  return `응, 확인했어. “${value.slice(0, 28)}${value.length > 28 ? '…' : ''}”라고 보냈네. 지금 메시지 왕복은 정상적으로 동작하고 있어.`;
}

function TypingIndicator({ ai }: { ai: boolean }) {
  return <div className="typing-row" aria-label="상대방이 입력 중입니다">
    <div className="avatar tiny">{ai ? <Bot size={14} /> : '상'}</div>
    <div className="typing-bubble" aria-hidden="true"><span /><span /><span /></div>
  </div>;
}

export function ChatPage({ Header, messages, setMessages }: { Header: ({ title }: { title?: string }) => React.ReactNode; messages: Message[]; setMessages: React.Dispatch<React.SetStateAction<Message[]>> }) {
  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState<number>();
  const [active, setActive] = useState<number>();
  const [lightbox, setLightbox] = useState<string>();
  const [highlighted, setHighlighted] = useState<number>();
  const [aiTyping, setAiTyping] = useState(false);
  const [realPartnerName, setRealPartnerName] = useState('상대방');
  const bottomRef = useRef<HTMLDivElement>(null);
  const aiTimerRef = useRef<number>();
  const byId = useMemo(() => new Map(messages.map((message) => [message.id, message])), [messages]);
  const currentUid = auth.currentUser?.uid;
  const aiPartner = currentUid ? loadLocalAiPartner(currentUid) : null;
  const partnerName = aiPartner?.connected ? aiPartner.displayName || AI_TEST_PARTNER_NAME : realPartnerName;
  const partnerInitial = partnerName.trim().charAt(0) || '상';

  useEffect(() => {
    if (!currentUid || aiPartner?.connected) return;
    let cancelled = false;
    void getRealCoupleConnection(currentUid).then((connection) => {
      if (cancelled || !connection) return;
      setRealPartnerName(connection.partnerProfile?.nickname?.trim() || connection.partnerProfile?.name?.trim() || '상대방');
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [currentUid, aiPartner?.connected]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages.length, aiTyping]);
  useEffect(() => () => { if (aiTimerRef.current) window.clearTimeout(aiTimerRef.current); }, []);

  const queueAiReply = (text: string, replyTarget?: number) => {
    if (!aiPartner?.connected) return;
    setAiTyping(true);
    if (aiTimerRef.current) window.clearTimeout(aiTimerRef.current);
    const typingMs = Math.min(2400, Math.max(900, 700 + text.length * 35));
    aiTimerRef.current = window.setTimeout(() => {
      setMessages((items) => [...items, {
        id: Date.now() + 1,
        sender: 'partner',
        type: 'text',
        text: aiReplyFor(text),
        timestamp: new Date().toISOString(),
        read: true,
        replyTo: replyTarget,
      }]);
      setAiTyping(false);
    }, typingMs);
  };

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    const messageId = Date.now();
    const currentReplyTo = replyTo;
    setMessages((items) => [...items, { id: messageId, sender: 'me', type: 'text', text, timestamp: new Date().toISOString(), read: Boolean(aiPartner?.connected), replyTo: currentReplyTo }]);
    setDraft('');
    setReplyTo(undefined);
    queueAiReply(text, messageId);
  };

  const sendImage = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const messageId = Date.now();
      setMessages((items) => [...items, { id: messageId, sender: 'me', type: 'image', imageUrl: String(reader.result), timestamp: new Date().toISOString(), read: Boolean(aiPartner?.connected), replyTo }]);
      if (aiPartner?.connected) queueAiReply('이미지를 보냈어', messageId);
    };
    reader.readAsDataURL(file);
    setReplyTo(undefined);
  };

  const react = (id: number, emoji: string) => setMessages((items) => items.map((message) => message.id !== id ? message : { ...message, reactions: message.reactions?.some((reaction) => reaction.by === 'me' && reaction.emoji === emoji) ? message.reactions.filter((reaction) => !(reaction.by === 'me' && reaction.emoji === emoji)) : [...(message.reactions ?? []).filter((reaction) => reaction.by !== 'me'), { emoji, by: 'me' }] }));
  const jump = (id: number) => { document.getElementById(`message-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }); setHighlighted(id); window.setTimeout(() => setHighlighted(undefined), 1400); };

  return <div className="page full-page chat-page">
    <Header title="대화" />
    <div className="chat-profile">
      <div className="avatar large">{aiPartner?.connected ? <Bot size={22} /> : partnerInitial}</div>
      <div>
        <b>{partnerName}</b>
        <span className={aiTyping ? 'chat-status typing' : 'chat-status'}><i /> {aiTyping ? '입력 중...' : aiPartner?.connected ? 'AI 테스트 파트너 · 연결됨' : '연결된 상대방'}</span>
      </div>
      <button aria-label="대화 메뉴"><MoreHorizontal /></button>
    </div>
    <div className="messages" onClick={() => active && setActive(undefined)}>
      {messages.map((message, index) => {
        const date = new Date(message.timestamp).toDateString();
        const previousDate = index > 0 ? new Date(messages[index - 1].timestamp).toDateString() : '';
        const divider = date !== previousDate;
        return <div key={message.id}>{divider && <div className="date-chip">{messageDateLabel(message.timestamp)}</div>}<ChatBubble message={message} reply={message.replyTo ? byId.get(message.replyTo) : undefined} active={active === message.id} highlighted={highlighted === message.id} onAction={() => setActive(active === message.id ? undefined : message.id)} onReact={(emoji) => react(message.id, emoji)} onReply={() => { setReplyTo(message.id); setActive(undefined); }} onSave={() => { setMessages((items) => items.map((item) => item.id === message.id ? { ...item, saved: !item.saved } : item)); setActive(undefined); }} onImage={setLightbox} onJump={jump} /></div>;
      })}
      {aiTyping && <TypingIndicator ai={Boolean(aiPartner?.connected)} />}
      <div ref={bottomRef} />
    </div>
    <ChatComposer draft={draft} reply={replyTo ? byId.get(replyTo) : undefined} onDraft={setDraft} onSend={send} onImage={sendImage} onCancelReply={() => setReplyTo(undefined)} />
    {lightbox && <div className="lightbox" role="dialog" onClick={() => setLightbox(undefined)}><button aria-label="닫기"><X /></button><img src={lightbox} alt="확대된 채팅 사진" /></div>}
  </div>;
}
