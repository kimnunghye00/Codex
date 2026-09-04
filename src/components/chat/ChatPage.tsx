import { Bot, CalendarClock, Gift, Heart, MonitorUp, MoreHorizontal, Phone, Video, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';
import { collection, doc, onSnapshot, orderBy, query, setDoc } from 'firebase/firestore';
import { auth, db } from '../../lib/firebase';
import { AI_TEST_PARTNER_NAME, loadLocalAiPartner } from '../../lib/coupleData';
import type { RealCoupleConnection } from '../../lib/coupleConnection';
import { sendCoupleMessage, subscribeCoupleMessages } from '../../lib/chatRealtime';
import type { Message } from '../../types';
import { messageDateLabel } from '../../utils/dates';
import { ChatBubble } from './ChatBubble';
import { ChatComposer } from './ChatComposer';
import { ChatToolsPanel, loadChatPreferences, saveChatPreferences, type ChatPreferences } from './ChatToolsPanel';

type ChatSchedule = { id: string; title: string; date: string; startTime: string; type: 'personal' | 'couple'; ownerId: string };
type ScheduledDraft = { id: number; text: string; sendAt: string };
type CallMode = 'voice' | 'video' | 'screen';

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

function TypingIndicator({ ai, initial, heart = false }: { ai: boolean; initial: string; heart?: boolean }) {
  return <div className={`typing-row ${heart ? 'heart-typing-row' : ''}`} aria-label="상대방이 입력 중입니다"><div className="avatar tiny">{ai ? <Bot size={14} /> : initial}</div>{heart ? <div className="heart-typing" aria-hidden="true"><Heart fill="currentColor" /></div> : <div className="typing-bubble" aria-hidden="true"><span /><span /><span /></div>}</div>;
}

async function readFile(file: File) {
  return await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(file); });
}

async function prepareImage(file: File, quality: ChatPreferences['mediaQuality']) {
  if (file.type === 'image/gif' || quality === 'original') return readFile(file);
  const max = quality === 'data' ? 1080 : 1800;
  const jpegQuality = quality === 'data' ? 0.68 : 0.86;
  const src = await readFile(file);
  const image = await new Promise<HTMLImageElement>((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = reject; img.src = src; });
  const scale = Math.min(1, max / Math.max(image.width, image.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  canvas.getContext('2d')?.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', jpegQuality);
}

export function ChatPage({ Header, messages, setMessages, connection }: {
  Header: ({ title }: { title?: string }) => React.ReactNode;
  messages: Message[];
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  connection: RealCoupleConnection | null;
}) {
  const currentUid = auth.currentUser?.uid ?? '';
  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState<number>();
  const [active, setActive] = useState<number>();
  const [lightbox, setLightbox] = useState<string>();
  const [highlighted, setHighlighted] = useState<number>();
  const [aiTyping, setAiTyping] = useState(false);
  const [partnerTyping, setPartnerTyping] = useState(false);
  const [syncError, setSyncError] = useState('');
  const [toolsOpen, setToolsOpen] = useState(false);
  const [preferences, setPreferences] = useState(() => loadChatPreferences(currentUid || 'guest'));
  const [schedules, setSchedules] = useState<ChatSchedule[]>([]);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduledDrafts, setScheduledDrafts] = useState<ScheduledDraft[]>(() => { try { return JSON.parse(localStorage.getItem(`route-scheduled-chat:${currentUid}`) || '[]'); } catch { return []; } });
  const [scheduleForm, setScheduleForm] = useState({ text: '', sendAt: '' });
  const [giftOpen, setGiftOpen] = useState(false);
  const [callMode, setCallMode] = useState<CallMode>();
  const [mediaStream, setMediaStream] = useState<MediaStream>();
  const bottomRef = useRef<HTMLDivElement>(null);
  const aiTimerRef = useRef<number | undefined>(undefined);
  const typingTimerRef = useRef<number | undefined>(undefined);
  const videoRef = useRef<HTMLVideoElement>(null);
  const byId = useMemo(() => new Map(messages.map((message) => [message.id, message])), [messages]);
  const aiPartner = currentUid ? loadLocalAiPartner(currentUid) : null;
  const usingAiPartner = Boolean(aiPartner?.connected && !connection);
  const partnerName = connection?.partnerProfile?.nickname?.trim() || connection?.partnerProfile?.name?.trim() || (usingAiPartner ? aiPartner?.displayName || AI_TEST_PARTNER_NAME : '상대방');
  const partnerInitial = partnerName.trim().charAt(0) || '상';
  const nearestSchedule = schedules.find((item) => `${item.date} ${item.startTime}` >= `${new Date().toISOString().slice(0, 10)} 00:00`);

  useEffect(() => { if (currentUid) setPreferences(loadChatPreferences(currentUid)); }, [currentUid]);
  useEffect(() => { if (currentUid) saveChatPreferences(currentUid, preferences); }, [currentUid, preferences]);
  useEffect(() => { localStorage.setItem(`route-scheduled-chat:${currentUid}`, JSON.stringify(scheduledDrafts)); }, [scheduledDrafts, currentUid]);
  useEffect(() => {
    if (!connection || !currentUid) return;
    setSyncError('');
    return subscribeCoupleMessages(connection.coupleId, currentUid, setMessages, (cause) => { console.error('[ROUTE realtime chat]', cause); setSyncError('실시간 대화를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.'); });
  }, [connection?.coupleId, currentUid, setMessages]);
  useEffect(() => {
    if (!connection?.coupleId) { setSchedules([]); return; }
    const q = query(collection(db, 'couples', connection.coupleId, 'schedules'), orderBy('date', 'asc'));
    return onSnapshot(q, (snapshot) => setSchedules(snapshot.docs.map((item) => ({ id: item.id, ...(item.data() as Omit<ChatSchedule, 'id'>) }))));
  }, [connection?.coupleId]);
  useEffect(() => {
    if (!connection?.coupleId || !connection.partnerUid) { setPartnerTyping(false); return; }
    return onSnapshot(doc(db, 'couples', connection.coupleId, 'typing', connection.partnerUid), (snapshot) => {
      const data = snapshot.data() as { typing?: boolean; updatedAt?: number } | undefined;
      setPartnerTyping(Boolean(data?.typing && data.updatedAt && Date.now() - data.updatedAt < 8000));
    });
  }, [connection?.coupleId, connection?.partnerUid]);
  useEffect(() => {
    if (!connection?.coupleId || !currentUid) return;
    const ref = doc(db, 'couples', connection.coupleId, 'typing', currentUid);
    void setDoc(ref, { typing: Boolean(draft.trim()), updatedAt: Date.now() }, { merge: true }).catch(() => undefined);
    if (typingTimerRef.current) window.clearTimeout(typingTimerRef.current);
    typingTimerRef.current = window.setTimeout(() => { void setDoc(ref, { typing: false, updatedAt: Date.now() }, { merge: true }).catch(() => undefined); }, 4500);
  }, [draft, connection?.coupleId, currentUid]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages.length, aiTyping, partnerTyping]);
  useEffect(() => () => { if (aiTimerRef.current) window.clearTimeout(aiTimerRef.current); if (typingTimerRef.current) window.clearTimeout(typingTimerRef.current); mediaStream?.getTracks().forEach((track) => track.stop()); }, [mediaStream]);
  useEffect(() => { if (videoRef.current && mediaStream) videoRef.current.srcObject = mediaStream; }, [mediaStream, callMode]);

  const queueAiReply = (text: string, replyTarget?: number) => {
    if (!usingAiPartner) return;
    setAiTyping(true);
    if (aiTimerRef.current) window.clearTimeout(aiTimerRef.current);
    aiTimerRef.current = window.setTimeout(() => { setMessages((items) => [...items, { id: Date.now() + 1, sender: 'partner', type: 'text', text: aiReplyFor(text), timestamp: new Date().toISOString(), read: true, replyTo: replyTarget }]); setAiTyping(false); }, Math.min(2400, Math.max(900, 700 + text.length * 35)));
  };

  const deliver = (message: Message) => {
    setMessages((items) => [...items, message]);
    if (connection && currentUid) void sendCoupleMessage(connection.coupleId, currentUid, message).catch(() => setSyncError('메시지를 상대방에게 전송하지 못했어요.'));
    else if (message.type === 'text') queueAiReply(message.text || '', message.id);
  };

  const sendText = (text: string, scheduledFor?: string) => {
    if (!text.trim() || !currentUid) return;
    const message: Message = { id: Date.now(), sender: 'me', type: 'text', text: text.trim(), timestamp: new Date().toISOString(), read: usingAiPartner, replyTo, scheduledFor };
    deliver(message); setReplyTo(undefined);
  };

  useEffect(() => {
    const timer = window.setInterval(() => {
      const due = scheduledDrafts.filter((item) => new Date(item.sendAt).getTime() <= Date.now());
      if (!due.length) return;
      due.forEach((item) => sendText(item.text, item.sendAt));
      setScheduledDrafts((items) => items.filter((item) => !due.some((dueItem) => dueItem.id === item.id)));
    }, 3000);
    return () => window.clearInterval(timer);
  });

  const send = () => { const text = draft; setDraft(''); sendText(text); };
  const sendImages = async (files: File[]) => {
    try {
      const urls = await Promise.all(files.slice(0, 10).map((file) => prepareImage(file, preferences.mediaQuality)));
      const message: Message = urls.length === 1
        ? { id: Date.now(), sender: 'me', type: 'image', imageUrl: urls[0], timestamp: new Date().toISOString(), read: usingAiPartner, replyTo }
        : { id: Date.now(), sender: 'me', type: 'gallery', imageUrls: urls, timestamp: new Date().toISOString(), read: usingAiPartner, replyTo };
      const size = urls.reduce((sum, url) => sum + url.length, 0);
      setMessages((items) => [...items, message]); setReplyTo(undefined);
      if (connection && currentUid) {
        if (size < 700_000) void sendCoupleMessage(connection.coupleId, currentUid, message).catch(() => setSyncError('사진 전송에 실패했어요.'));
        else setSyncError('사진 묶음이 현재 Firestore 테스트 전송 한도를 넘었어요. Firebase Storage 연결 후 더 많은 원본 사진을 지원할 수 있어요.');
      }
    } catch { setSyncError('사진을 처리하지 못했어요.'); }
  };
  const sendGif = async (file: File) => {
    try {
      const imageUrl = await readFile(file);
      const message: Message = { id: Date.now(), sender: 'me', type: 'gif', imageUrl, timestamp: new Date().toISOString(), read: usingAiPartner, replyTo };
      setMessages((items) => [...items, message]); setReplyTo(undefined);
      if (connection && currentUid && imageUrl.length < 700_000) void sendCoupleMessage(connection.coupleId, currentUid, message).catch(() => setSyncError('움짤 전송에 실패했어요.'));
      else if (imageUrl.length >= 700_000) setSyncError('움짤 용량이 커서 전송하지 못했어요.');
    } catch { setSyncError('움짤을 처리하지 못했어요.'); }
  };

  const reserveMessage = () => {
    if (!scheduleForm.text.trim() || !scheduleForm.sendAt || new Date(scheduleForm.sendAt).getTime() <= Date.now()) return;
    setScheduledDrafts((items) => [...items, { id: Date.now(), text: scheduleForm.text.trim(), sendAt: scheduleForm.sendAt }]);
    setScheduleForm({ text: '', sendAt: '' }); setScheduleOpen(false);
  };
  const startMedia = async (mode: CallMode) => {
    try {
      mediaStream?.getTracks().forEach((track) => track.stop());
      const stream = mode === 'screen'
        ? await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
        : await navigator.mediaDevices.getUserMedia({ video: mode === 'video', audio: true });
      setMediaStream(stream); setCallMode(mode);
    } catch { setSyncError('마이크/카메라 또는 화면 공유 권한을 확인해 주세요.'); }
  };
  const stopMedia = () => { mediaStream?.getTracks().forEach((track) => track.stop()); setMediaStream(undefined); setCallMode(undefined); };

  const react = (id: number, emoji: string) => setMessages((items) => items.map((message) => message.id !== id ? message : { ...message, reactions: message.reactions?.some((reaction) => reaction.by === 'me' && reaction.emoji === emoji) ? message.reactions.filter((reaction) => !(reaction.by === 'me' && reaction.emoji === emoji)) : [...(message.reactions ?? []).filter((reaction) => reaction.by !== 'me'), { emoji, by: 'me' }] }));
  const jump = (id: number) => { document.getElementById(`message-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }); setHighlighted(id); window.setTimeout(() => setHighlighted(undefined), 1400); };

  return <div className={`page full-page chat-page chat-bg-${preferences.background} chat-font-${preferences.fontSize}`}>
    <Header title="대화" />
    <div className="chat-profile"><div className="avatar large">{usingAiPartner ? <Bot size={22} /> : partnerInitial}</div><div><b>{partnerName}</b><span className={aiTyping || partnerTyping ? 'chat-status typing' : 'chat-status'}><i /> {aiTyping || partnerTyping ? '입력 중...' : connection ? '실시간 연결됨' : usingAiPartner ? 'AI 테스트 파트너 · 연결됨' : '상대방 연결 대기'}</span></div><div className="chat-call-actions"><button aria-label="음성 통화" onClick={() => void startMedia('voice')}><Phone size={17} /></button><button aria-label="영상 통화" onClick={() => void startMedia('video')}><Video size={17} /></button><button aria-label="화면 공유" onClick={() => void startMedia('screen')}><MonitorUp size={17} /></button><button aria-label="대화 메뉴" onClick={() => setToolsOpen(true)}><MoreHorizontal /></button></div></div>
    {nearestSchedule && <div className="chat-next-schedule"><CalendarClock size={16} /><div><small>가장 가까운 일정</small><b>{nearestSchedule.title}</b><span>{nearestSchedule.date.replaceAll('-', '.')} · {nearestSchedule.startTime}</span></div></div>}
    {syncError && <p className="chat-sync-error" role="alert">{syncError}</p>}
    <div className="messages" onClick={() => active && setActive(undefined)}>{messages.map((message, index) => {
      const date = new Date(message.timestamp).toDateString();
      const previousDate = index > 0 ? new Date(messages[index - 1].timestamp).toDateString() : '';
      return <div key={message.id}>{date !== previousDate && <div className="date-chip">{messageDateLabel(message.timestamp)}</div>}<ChatBubble message={message} reply={message.replyTo ? byId.get(message.replyTo) : undefined} partnerName={partnerName} partnerInitial={partnerInitial} active={active === message.id} highlighted={highlighted === message.id} onAction={() => setActive(active === message.id ? undefined : message.id)} onReact={(emoji) => react(message.id, emoji)} onReply={() => { setReplyTo(message.id); setActive(undefined); }} onSave={() => { setMessages((items) => items.map((item) => item.id === message.id ? { ...item, saved: !item.saved } : item)); setActive(undefined); }} onImage={setLightbox} onJump={jump} /></div>;
    })}{aiTyping && <TypingIndicator ai initial={partnerInitial} />}{partnerTyping && !aiTyping && <TypingIndicator ai={false} initial={partnerInitial} heart />}<div ref={bottomRef} /></div>
    {scheduledDrafts.length > 0 && <div className="scheduled-strip"><CalendarClock size={14} /><span>예약 메시지 {scheduledDrafts.length}개</span><small>앱 실행 중 자동 전송</small></div>}
    <ChatComposer draft={draft} reply={replyTo ? byId.get(replyTo) : undefined} partnerName={partnerName} onDraft={setDraft} onSend={send} onImages={sendImages} onGif={sendGif} onQuick={sendText} onSchedule={() => setScheduleOpen(true)} onGift={() => setGiftOpen(true)} onCancelReply={() => setReplyTo(undefined)} />
    {toolsOpen && <ChatToolsPanel messages={messages} partnerName={partnerName} preferences={preferences} onPreferences={setPreferences} onJump={jump} onImage={setLightbox} onImport={(imported) => setMessages(imported)} onSticker={sendText} onClose={() => setToolsOpen(false)} />}
    {lightbox && <div className="lightbox" role="dialog" onClick={() => setLightbox(undefined)}><button aria-label="닫기"><X /></button><img src={lightbox} alt="확대된 채팅 사진" /></div>}

    {scheduleOpen && <div className="chat-extra-backdrop" onMouseDown={() => setScheduleOpen(false)}><section className="chat-extra-modal" onMouseDown={(event) => event.stopPropagation()}><button className="chat-extra-close" onClick={() => setScheduleOpen(false)}><X /></button><CalendarClock className="modal-accent-icon" /><h2>예약 메시지</h2><p>현재 버전에서는 ROUTE가 실행 중일 때 예약 시간이 되면 자동으로 보내요.</p><label>메시지<textarea value={scheduleForm.text} onChange={(event) => setScheduleForm({ ...scheduleForm, text: event.target.value })} placeholder="나중에 전할 말을 적어주세요" /></label><label>보낼 시간<input type="datetime-local" value={scheduleForm.sendAt} onChange={(event) => setScheduleForm({ ...scheduleForm, sendAt: event.target.value })} /></label><button className="primary" disabled={!scheduleForm.text.trim() || !scheduleForm.sendAt} onClick={reserveMessage}>예약하기</button></section></div>}

    {giftOpen && <div className="chat-extra-backdrop" onMouseDown={() => setGiftOpen(false)}><section className="chat-extra-modal gift-modal" onMouseDown={(event) => event.stopPropagation()}><button className="chat-extra-close" onClick={() => setGiftOpen(false)}><X /></button><Gift className="modal-accent-icon" /><h2>선물하기</h2><p>생일이나 기념일에 바로 선물 메시지를 보낼 수 있어요. 결제 연결은 다음 단계에서 추가할 수 있어요.</p><div className="gift-options">{['🎂 생일 선물', '💐 기념일 선물', '☕ 커피 선물', '🍰 달콤한 선물'].map((gift) => <button key={gift} onClick={() => { sendText(`🎁 ${gift}을(를) 보내고 싶어요 ❤️`); setGiftOpen(false); }}>{gift}</button>)}</div><button className="gift-ai" disabled>AI 선물 추천 · 준비 중</button></section></div>}

    {callMode && <div className="chat-extra-backdrop"><section className="chat-call-modal"><div className="call-heart"><Heart fill="currentColor" /></div><h2>{callMode === 'voice' ? '음성 통화' : callMode === 'video' ? '영상 통화' : '화면 공유'}</h2><p>{partnerName}과 연결할 준비를 하고 있어요.</p>{callMode !== 'voice' && <video ref={videoRef} autoPlay muted playsInline />}{callMode === 'voice' && <div className="voice-wave"><span /><span /><span /><span /><span /></div>}<small>현재는 내 기기 미디어 연결까지 동작하며, 상대방과의 실제 WebRTC 연결은 시그널링 서버 연결 단계에서 완성됩니다.</small><button className="call-end" onClick={stopMedia}>종료</button></section></div>}
  </div>;
}
