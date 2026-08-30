import { Bot, MoreHorizontal, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';
import { auth } from '../../lib/firebase';
import { AI_TEST_PARTNER_NAME, loadLocalAiPartner } from '../../lib/coupleData';
import type { RealCoupleConnection } from '../../lib/coupleConnection';
import { sendCoupleMessage, subscribeCoupleMessages } from '../../lib/chatRealtime';
import type { Message } from '../../types';
import { messageDateLabel } from '../../utils/dates';
import { ChatBubble } from './ChatBubble';
import { ChatComposer } from './ChatComposer';

function aiReplyFor(text: string) {
  const value = text.trim();
  const lower = value.toLowerCase();
  if (!value) return '응, 듣고 있어.';
  if (/안녕|하이|hello|hi/.test(lower)) return '안녕! 이제 ROUTE 안에서도 대화 테스트를 할 수 있어 😊';
  if (/별명/.test(value)) return '별명 기능도 같이 확인해보자.';
  if (/오류|에러|버그|안돼|안 돼|문제/.test(value)) return '어디에서 문제가 생겼는지 알려줘.';
  if (/테스트/.test(value)) return '좋아. 메시지 전송부터 확인해보자.';
  return `응, 확인했어. “${value.slice(0, 28)}${value.length > 28 ? '…' : ''}”`;
}

function TypingIndicator({ ai }: { ai: boolean }) {
  return <div className="typing-row" aria-label="상대방이 입력 중입니다">
    <div className="avatar tiny">{ai ? <Bot size={14} /> : '상'}</div>
    <div className="typing-bubble" aria-hidden="true"><span /><span /><span /></div>
  </div>;
}

export function ChatPage({ Header, messages, setMessages, connection }: {
  Header: ({ title }: { title?: string }) => React.ReactNode;
  messages: Message[];
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  connection: RealCoupleConnection | null;
}) {
  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState<number>();
  const [active, setActive] = useState<number>();
  const [lightbox, setLightbox] = useState<string>();
  const [highlighted, setHighlighted] = useState<number>();
  const [aiTyping, setAiTyping] = useState(false);
  const [syncError, setSyncError] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const aiTimerRef = useRef<number>();
  const byId = useMemo(() => new Map(messages.map((message) => [message.id, message])), [messages]);
  const currentUid = auth.currentUser?.uid;
  const aiPartner = currentUid ? loadLocalAiPartner(currentUid) : null;
  const usingAiPartner = Boolean(aiPartner?.connected && !connection);
  const partnerName = connection?.partnerProfile?.nickname?.trim()
    || connection?.partnerProfile?.name?.trim()
    || (usingAiPartner ? aiPartner?.displayName || AI_TEST_PARTNER_NAME : '상대방');
  const partnerInitial = partnerName.trim().charAt(0) || '상';

  useEffect(() => {
    if (!connection || !currentUid) return;
    setSyncError('');
    return subscribeCoupleMessages(
      connection.coupleId,
      currentUid,
      setMessages,
      (cause) => {
        console.error('[ROUTE realtime chat]', cause);
        setSyncError('실시간 대화를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.');
      },
    );
  }, [connection?.coupleId, currentUid, setMessages]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages.length, aiTyping]);
  useEffect(() => () => { if (aiTimerRef.current) window.clearTimeout(aiTimerRef.current); }, []);

  const queueAiReply = (text: string, replyTarget?: number) => {
    if (!usingAiPartner) return;
    setAiTyping(true);
    if (aiTimerRef.current) window.clearTimeout(aiTimerRef.current);
    aiTimerRef.current = window.setTimeout(() => {
      setMessages((items) => [...items, { id: Date.now() + 1, sender: 'partner', type: 'text', text: aiReplyFor(text), timestamp: new Date().toISOString(), read: true, replyTo: replyTarget }]);
      setAiTyping(false);
    }, Math.min(2400, Math.max(900, 700 + text.length * 35)));
  };

  const send = () => {
    const text = draft.trim();
    if (!text || !currentUid) return;
    const messageId = Date.now();
    const message: Message = { id: messageId, sender: 'me', type: 'text', text, timestamp: new Date().toISOString(), read: usingAiPartner, replyTo };
    setMessages((items) => [...items, message]);
    setDraft('');
    setReplyTo(undefined);
    if (connection) {
      void sendCoupleMessage(connection.coupleId, currentUid, message).catch((cause) => {
        console.error('[ROUTE send realtime chat]', cause);
        setSyncError('메시지를 상대방에게 전송하지 못했어요. 연결 상태를 확인해 주세요.');
      });
      return;
    }
    queueAiReply(text, messageId);
  };

  const sendImage = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const messageId = Date.now();
      const imageUrl = String(reader.result);
      const message: Message = { id: messageId, sender: 'me', type: 'image', imageUrl, timestamp: new Date().toISOString(), read: usingAiPartner, replyTo };
      setMessages((items) => [...items, message]);
      if (connection && currentUid) {
        if (imageUrl.length < 700_000) void sendCoupleMessage(connection.coupleId, currentUid, message).catch(() => setSyncError('사진 전송에 실패했어요.'));
        else setSyncError('큰 사진은 아직 상대방에게 동기화되지 않아요.');
      } else if (usingAiPartner) queueAiReply('이미지를 보냈어', messageId);
    };
    reader.readAsDataURL(file);
    setReplyTo(undefined);
  };

  const react = (id: number, emoji: string) => setMessages((items) => items.map((message) => message.id !== id ? message : { ...message, reactions: message.reactions?.some((reaction) => reaction.by === 'me' && reaction.emoji === emoji) ? message.reactions.filter((reaction) => !(reaction.by === 'me' && reaction.emoji === emoji)) : [...(message.reactions ?? []).filter((reaction) => reaction.by !== 'me'), { emoji, by: 'me' }] }));
  const jump = (id: number) => { document.getElementById(`message-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }); setHighlighted(id); window.setTimeout(() => setHighlighted(undefined), 1400); };

  return <div className="page full-page chat-page">
    <Header title="대화" />
    <div className="chat-profile">
      <div className="avatar large">{usingAiPartner ? <Bot size={22} /> : partnerInitial}</div>
      <div><b>{partnerName}</b><span className={aiTyping ? 'chat-status typing' : 'chat-status'}><i /> {aiTyping ? '입력 중...' : connection ? '실시간 연결됨' : usingAiPartner ? 'AI 테스트 파트너 · 연결됨' : '상대방 연결 대기'}</span></div>
      <button aria-label="대화 메뉴"><MoreHorizontal /></button>
    </div>
    {syncError && <p className="chat-sync-error" role="alert">{syncError}</p>}
    <div className="messages" onClick={() => active && setActive(undefined)}>
      {messages.map((message, index) => {
        const date = new Date(message.timestamp).toDateString();
        const previousDate = index > 0 ? new Date(messages[index - 1].timestamp).toDateString() : '';
        return <div key={message.id}>{date !== previousDate && <div className="date-chip">{messageDateLabel(message.timestamp)}</div>}<ChatBubble message={message} reply={message.replyTo ? byId.get(message.replyTo) : undefined} active={active === message.id} highlighted={highlighted === message.id} onAction={() => setActive(active === message.id ? undefined : message.id)} onReact={(emoji) => react(message.id, emoji)} onReply={() => { setReplyTo(message.id); setActive(undefined); }} onSave={() => { setMessages((items) => items.map((item) => item.id === message.id ? { ...item, saved: !item.saved } : item)); setActive(undefined); }} onImage={setLightbox} onJump={jump} /></div>;
      })}
      {aiTyping && <TypingIndicator ai={usingAiPartner} />}
      <div ref={bottomRef} />
    </div>
    <ChatComposer draft={draft} reply={replyTo ? byId.get(replyTo) : undefined} onDraft={setDraft} onSend={send} onImage={sendImage} onCancelReply={() => setReplyTo(undefined)} />
    {lightbox && <div className="lightbox" role="dialog" onClick={() => setLightbox(undefined)}><button aria-label="닫기"><X /></button><img src={lightbox} alt="확대된 채팅 사진" /></div>}
  </div>;
}
