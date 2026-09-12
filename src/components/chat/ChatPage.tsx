import { Bot, CalendarClock, Gift, Heart, MonitorUp, MoreHorizontal, Phone, Trash2, Video, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';
import { collection, doc, limit, onSnapshot, orderBy, query, setDoc, where } from 'firebase/firestore';
import { useVirtualizer } from '@tanstack/react-virtual';
import { CALLING_ENABLED } from '../../config/releaseFlags';
import { auth, db } from '../../lib/firebase';
import { AI_TEST_PARTNER_NAME, loadLocalAiPartner } from '../../lib/coupleData';
import type { RealCoupleConnection } from '../../lib/coupleConnection';
import { clearCoupleChatForMe, deleteCoupleMessageForEveryone, hideCoupleMessageForMe, sendCoupleMessage, subscribeCoupleMessages, toggleCoupleMessageReaction } from '../../lib/chatRealtime';
import { deleteUploadedChatMedia, uploadChatMedia } from '../../lib/chatMedia';
import { migrateLoadedLegacyChatMedia, releaseLegacyChatMediaRoom } from '../../lib/chatMediaMigration';
import type { Message } from '../../types';
import { localDateKey, messageDateLabel } from '../../utils/dates';
import { isChatMediaMessage, loadChatMemoryMessageIds, toggleChatMessageMemory } from '../../utils/featureFlow';
import { createMessageId } from '../../utils/messageId';
import { ChatBubble } from './ChatBubble';
import { ChatComposer } from './ChatComposer';
import { ChatToolsPanel, loadChatPreferences, saveChatPreferences, type ChatPreferences } from './ChatToolsPanel';

type ChatSchedule = { id: string; title: string; date: string; startTime: string; type: 'personal' | 'couple'; ownerId: string };
type ScheduledDraft = { id: number; text: string; sendAt: string };
type CallMode = 'voice' | 'video' | 'screen';
type MediaProgress = { completed: number; total: number };
type ChatRow =
  | { kind: 'message'; key: string; message: Message; showDate: boolean }
  | { kind: 'typing-ai'; key: 'typing-ai' }
  | { kind: 'typing-partner'; key: 'typing-partner' };

const MAX_SOURCE_IMAGE_BYTES = 25 * 1024 * 1024;
const MAX_ORIGINAL_IMAGE_BYTES = 9 * 1024 * 1024;
const MAX_GIF_BYTES = 9 * 1024 * 1024;
const MAX_CHAT_PHOTOS = 100;
const CHAT_MEDIA_BATCH_SIZE = 4;
const MAX_SCHEDULE_SLEEP_MS = 60 * 60 * 1000;
const CHAT_BOTTOM_SLOP_PX = 140;
const FINE_POINTER_WHEEL_MULTIPLIER = 2.35;
const DELETE_FOR_EVERYONE_WINDOW_MS = 10 * 60 * 1000;

function formatScheduleDateInput(value: string) {
  const digits = value.replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 4) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 4)}-${digits.slice(4)}`;
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}`;
}

function scheduleDateIsValid(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

function currentScheduleDefaults() {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return {
    date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    time: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
  };
}

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

async function readFile(file: Blob) {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function yieldToUi() {
  return new Promise<void>((resolve) => window.setTimeout(resolve, 0));
}

// Only used as an initial guess before a row is actually measured in the DOM;
// the virtualizer corrects itself once the real element is rendered.
function estimateChatRowHeight(row: ChatRow) {
  if (row.kind !== 'message') return 52;
  const base = row.showDate ? 36 : 0;
  if (row.message.type === 'image' || row.message.type === 'gif') return base + 260;
  if (row.message.type === 'gallery') return base + 300;
  return base + 68;
}

async function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('image-encode-failed')), type, quality);
  });
}

async function prepareImage(file: File, quality: ChatPreferences['mediaQuality']) {
  if (!file.type.startsWith('image/')) throw new Error('unsupported-image');
  if (file.size > MAX_SOURCE_IMAGE_BYTES) throw new Error('source-image-too-large');
  if (file.type === 'image/gif') {
    if (file.size > MAX_GIF_BYTES) throw new Error('gif-too-large');
    return readFile(file);
  }
  if (quality === 'original') {
    if (file.size > MAX_ORIGINAL_IMAGE_BYTES) throw new Error('original-image-too-large');
    return readFile(file);
  }

  const max = quality === 'data' ? 1080 : 1800;
  const jpegQuality = quality === 'data' ? 0.68 : 0.86;
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = objectUrl;
    });
    const scale = Math.min(1, max / Math.max(image.naturalWidth || image.width, image.naturalHeight || image.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round((image.naturalWidth || image.width) * scale));
    canvas.height = Math.max(1, Math.round((image.naturalHeight || image.height) * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('image-canvas-unavailable');

    // Give pending scroll/input work a frame before the only synchronous
    // raster step, then use asynchronous toBlob instead of blocking
    // canvas.toDataURL().
    await yieldToUi();
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const encoded = await canvasToBlob(canvas, 'image/jpeg', jpegQuality);
    return await readFile(encoded);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function mediaErrorMessage(cause: unknown, kind: 'photo' | 'gif') {
  const code = cause instanceof Error ? cause.message : '';
  if (code === 'source-image-too-large') return '사진 한 장의 원본 크기는 25MB 이하만 선택할 수 있어요.';
  if (code === 'original-image-too-large') return '원본 화질 전송은 사진 한 장당 9MB 이하만 지원해요. 고화질 또는 데이터 절약 화질을 선택해 주세요.';
  if (code === 'gif-too-large') return '움짤은 9MB 이하만 전송할 수 있어요.';
  if (code === 'unsupported-image') return '지원하지 않는 이미지 형식이에요.';
  return kind === 'photo' ? '사진을 전송하지 못했어요. 네트워크 연결을 확인한 뒤 다시 시도해 주세요.' : '움짤을 전송하지 못했어요. 네트워크 연결을 확인한 뒤 다시 시도해 주세요.';
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
  const [flowNotice, setFlowNotice] = useState('');
  const [mediaProgress, setMediaProgress] = useState<MediaProgress | null>(null);
  const [deleteSelection, setDeleteSelection] = useState<Set<number> | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [savedMediaIds, setSavedMediaIds] = useState<Set<number>>(() => loadChatMemoryMessageIds());
  const [toolsOpen, setToolsOpen] = useState(false);
  const [preferences, setPreferences] = useState(() => loadChatPreferences(currentUid || 'guest'));
  const [schedules, setSchedules] = useState<ChatSchedule[]>([]);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduledDrafts, setScheduledDrafts] = useState<ScheduledDraft[]>(() => { try { return JSON.parse(localStorage.getItem(`route-scheduled-chat:${currentUid}`) || '[]'); } catch { return []; } });
  const [scheduleForm, setScheduleForm] = useState({ text: '', date: '', time: '' });
  const [scheduleError, setScheduleError] = useState('');
  const [giftOpen, setGiftOpen] = useState(false);
  const [callMode, setCallMode] = useState<CallMode>();
  const [mediaStream, setMediaStream] = useState<MediaStream>();
  const messagesRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const initialScrollRef = useRef(false);
  const nearBottomRef = useRef(true);
  const forceBottomRef = useRef(false);
  const aiTimerRef = useRef<number | undefined>(undefined);
  const typingTimerRef = useRef<number | undefined>(undefined);
  const typingActiveRef = useRef(false);
  const typingLastWriteRef = useRef(0);
  const mediaSendingRef = useRef(false);
  const noticeTimerRef = useRef<number | undefined>(undefined);
  const videoRef = useRef<HTMLVideoElement>(null);
  const byId = useMemo(() => new Map(messages.map((message) => [message.id, message])), [messages]);
  const selectedDeleteMessages = useMemo(
    () => deleteSelection
      ? messages.filter((message) => deleteSelection.has(message.id))
      : [],
    [messages, deleteSelection],
  );
  const recentDeleteCount = selectedDeleteMessages.filter((message) => {
    if (message.sender !== 'me') return false;
    const sentAt = Date.parse(message.timestamp);
    return Number.isFinite(sentAt) && Date.now() - sentAt < DELETE_FOR_EVERYONE_WINDOW_MS;
  }).length;
  const partnerDeleteCount = selectedDeleteMessages.filter((message) => message.sender !== 'me').length;
  const ownLocalOnlyDeleteCount = selectedDeleteMessages.filter((message) => {
    if (message.sender !== 'me') return false;
    const sentAt = Date.parse(message.timestamp);
    return !Number.isFinite(sentAt) || Date.now() - sentAt >= DELETE_FOR_EVERYONE_WINDOW_MS;
  }).length;
  const localOnlyDeleteCount = partnerDeleteCount + ownLocalOnlyDeleteCount;
  const rows = useMemo<ChatRow[]>(() => {
    const result: ChatRow[] = [];
    messages.forEach((message, index) => {
      const date = new Date(message.timestamp).toDateString();
      const previousDate = index > 0 ? new Date(messages[index - 1].timestamp).toDateString() : '';
      result.push({ kind: 'message', key: String(message.id), message, showDate: date !== previousDate });
    });
    if (aiTyping) result.push({ kind: 'typing-ai', key: 'typing-ai' });
    else if (partnerTyping) result.push({ kind: 'typing-partner', key: 'typing-partner' });
    return result;
  }, [messages, aiTyping, partnerTyping]);
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => messagesRef.current,
    estimateSize: (index) => estimateChatRowHeight(rows[index]),
    // Keep a couple of screens' worth of rows mounted on either side so a
    // normal scroll (not a violent fling) rarely has to tear down and
    // rebuild a photo row mid-gesture.
    overscan: 10,
    getItemKey: (index) => rows[index].key,
  });
  const aiPartner = currentUid ? loadLocalAiPartner(currentUid) : null;
  const usingAiPartner = Boolean(aiPartner?.connected && !connection);
  const partnerName = connection?.partnerProfile?.nickname?.trim() || connection?.partnerProfile?.name?.trim() || (usingAiPartner ? aiPartner?.displayName || AI_TEST_PARTNER_NAME : '상대방');
  const partnerInitial = partnerName.trim().charAt(0) || '상';
  const nearestSchedule = schedules.find((item) => `${item.date} ${item.startTime}` >= `${new Date().toISOString().slice(0, 10)} 00:00`);

  const updateNearBottom = () => {
    const element = messagesRef.current;
    if (!element) return;
    const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
    nearBottomRef.current = distance <= CHAT_BOTTOM_SLOP_PX;
    element.dataset.routeUserAwayFromBottom = distance > CHAT_BOTTOM_SLOP_PX ? '1' : '0';
  };

  const finePointerRef = useRef(false);
  useEffect(() => {
    const media = window.matchMedia('(pointer: fine)');
    finePointerRef.current = media.matches;
    const onChange = () => { finePointerRef.current = media.matches; };
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  const handleMessagesWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    if (!event.deltaY || !finePointerRef.current) return;

    if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) {
      event.preventDefault();
      event.currentTarget.scrollTop += event.deltaY * 56;
      updateNearBottom();
      return;
    }

    if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
      event.preventDefault();
      event.currentTarget.scrollTop += event.deltaY * event.currentTarget.clientHeight * 0.82;
      updateNearBottom();
      return;
    }

    // Pixel-mode trackpads keep native momentum; mouse wheels get only the
    // small extra distance that users requested.
    event.currentTarget.scrollTop += event.deltaY * (FINE_POINTER_WHEEL_MULTIPLIER - 1);
    updateNearBottom();
  };

  useEffect(() => { if (currentUid) setPreferences(loadChatPreferences(currentUid)); }, [currentUid]);
  useEffect(() => { if (currentUid) saveChatPreferences(currentUid, preferences); }, [currentUid, preferences]);
  useEffect(() => {
    const syncPreferences = (event: Event) => {
      const next = (event as CustomEvent<ChatPreferences>).detail;
      if (next) setPreferences(next);
    };
    window.addEventListener('route-chat-preferences-change', syncPreferences);
    return () => window.removeEventListener('route-chat-preferences-change', syncPreferences);
  }, []);
  useEffect(() => { localStorage.setItem(`route-scheduled-chat:${currentUid}`, JSON.stringify(scheduledDrafts)); }, [scheduledDrafts, currentUid]);
  useEffect(() => {
    const refreshSavedMedia = () => setSavedMediaIds(loadChatMemoryMessageIds());
    window.addEventListener('route-memories-local-change', refreshSavedMedia);
    window.addEventListener('route-memories-remote-change', refreshSavedMedia);
    return () => {
      window.removeEventListener('route-memories-local-change', refreshSavedMedia);
      window.removeEventListener('route-memories-remote-change', refreshSavedMedia);
    };
  }, []);
  useEffect(() => {
    if (!connection || !currentUid) return;
    setSyncError('');
    return subscribeCoupleMessages(connection.coupleId, currentUid, setMessages, (cause) => { console.error('[ROUTE realtime chat]', cause); setSyncError('실시간 대화를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.'); });
  }, [connection?.coupleId, currentUid, setMessages]);
  useEffect(() => {
    if (!connection?.coupleId || !currentUid) return;
    migrateLoadedLegacyChatMedia(connection.coupleId, currentUid, messages);
  }, [connection?.coupleId, currentUid, messages]);
  useEffect(() => {
    const coupleId = connection?.coupleId;
    if (!coupleId || !currentUid) return;
    return () => releaseLegacyChatMediaRoom(coupleId, currentUid);
  }, [connection?.coupleId, currentUid]);
  useEffect(() => {
    if (!connection?.coupleId) { setSchedules([]); return; }
    const q = query(
      collection(db, 'couples', connection.coupleId, 'schedules'),
      where('date', '>=', localDateKey()),
      orderBy('date', 'asc'),
      limit(24),
    );
    return onSnapshot(q, (snapshot) => {
      const next = snapshot.docs.map((item) => ({ id: item.id, ...(item.data() as Omit<ChatSchedule, 'id'>) }));
      setSchedules((current) => {
        if (current.length === next.length && current.every((item, index) =>
          item.id === next[index]?.id &&
          item.title === next[index]?.title &&
          item.date === next[index]?.date &&
          item.startTime === next[index]?.startTime &&
          item.type === next[index]?.type &&
          item.ownerId === next[index]?.ownerId
        )) return current;
        return next;
      });
    });
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
    const typingRef = doc(db, 'couples', connection.coupleId, 'typing', currentUid);
    const hasText = Boolean(draft.trim());
    const now = Date.now();
    const publishTyping = (typing: boolean) => {
      typingActiveRef.current = typing;
      typingLastWriteRef.current = Date.now();
      void setDoc(typingRef, { typing, updatedAt: Date.now() }, { merge: true }).catch(() => undefined);
    };

    if (typingTimerRef.current) window.clearTimeout(typingTimerRef.current);
    if (!hasText) {
      if (typingActiveRef.current) publishTyping(false);
      return;
    }

    if (!typingActiveRef.current || now - typingLastWriteRef.current >= 6500) publishTyping(true);
    typingTimerRef.current = window.setTimeout(() => publishTyping(false), 4500);
  }, [draft, connection?.coupleId, currentUid]);
  useEffect(() => () => {
    if (!connection?.coupleId || !currentUid || !typingActiveRef.current) return;
    void setDoc(doc(db, 'couples', connection.coupleId, 'typing', currentUid), { typing: false, updatedAt: Date.now() }, { merge: true }).catch(() => undefined);
    typingActiveRef.current = false;
  }, [connection?.coupleId, currentUid]);
  useEffect(() => {
    const element = messagesRef.current;
    if (!element) return;
    const shouldStick = !initialScrollRef.current || nearBottomRef.current || forceBottomRef.current;
    initialScrollRef.current = true;
    if (!shouldStick) return;
    const frame = window.requestAnimationFrame(() => {
      element.scrollTop = element.scrollHeight;
      forceBottomRef.current = false;
      nearBottomRef.current = true;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [messages.length, aiTyping, partnerTyping]);
  useEffect(() => () => {
    if (aiTimerRef.current) window.clearTimeout(aiTimerRef.current);
    if (typingTimerRef.current) window.clearTimeout(typingTimerRef.current);
    if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
    mediaStream?.getTracks().forEach((track) => track.stop());
  }, [mediaStream]);
  useEffect(() => { if (videoRef.current && mediaStream) videoRef.current.srcObject = mediaStream; }, [mediaStream, callMode]);

  const showFlowNotice = (text: string) => {
    setFlowNotice(text);
    if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = window.setTimeout(() => setFlowNotice(''), 2600);
  };

  const appendIfMissing = (message: Message) => {
    setMessages((items) => items.some((item) => item.id === message.id) ? items : [...items, message]);
  };

  const queueAiReply = (text: string, replyTarget?: number) => {
    if (!usingAiPartner) return;
    setAiTyping(true);
    if (aiTimerRef.current) window.clearTimeout(aiTimerRef.current);
    aiTimerRef.current = window.setTimeout(() => { setMessages((items) => [...items, { id: createMessageId(), sender: 'partner', type: 'text', text: aiReplyFor(text), timestamp: new Date().toISOString(), read: true, replyTo: replyTarget }]); setAiTyping(false); }, Math.min(2400, Math.max(900, 700 + text.length * 35)));
  };

  const deliver = (message: Message) => {
    setSyncError('');
    appendIfMissing(message);
    if (connection && currentUid) void sendCoupleMessage(connection.coupleId, currentUid, message).catch(() => {
      setMessages((items) => items.filter((item) => item.id !== message.id));
      if (message.type === 'text') setDraft((current) => current || message.text || '');
      setSyncError('메시지를 상대방에게 전송하지 못했어요. 다시 시도해 주세요.');
    });
    else if (message.type === 'text') queueAiReply(message.text || '', message.id);
  };

  const sendText = (text: string, scheduledFor?: string) => {
    if (!text.trim() || !currentUid) return;
    if (!scheduledFor) forceBottomRef.current = true;
    const message: Message = { id: createMessageId(), sender: 'me', type: 'text', text: text.trim(), timestamp: new Date().toISOString(), read: usingAiPartner, replyTo, scheduledFor };
    deliver(message); setReplyTo(undefined);
  };

  useEffect(() => {
    if (!scheduledDrafts.length) return;
    let timer: number | undefined;
    let cancelled = false;

    const arm = () => {
      if (cancelled) return;
      const nextAt = Math.min(...scheduledDrafts.map((item) => new Date(item.sendAt).getTime()).filter(Number.isFinite));
      if (!Number.isFinite(nextAt)) return;
      const delay = Math.min(MAX_SCHEDULE_SLEEP_MS, Math.max(250, nextAt - Date.now()));
      timer = window.setTimeout(() => {
        timer = undefined;
        const due = scheduledDrafts.filter((item) => new Date(item.sendAt).getTime() <= Date.now());
        if (due.length) {
          due.forEach((item) => sendText(item.text, item.sendAt));
          setScheduledDrafts((items) => items.filter((item) => !due.some((dueItem) => dueItem.id === item.id)));
          return;
        }
        arm();
      }, delay);
    };

    arm();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [scheduledDrafts]);

  const send = () => { const text = draft; setDraft(''); sendText(text); };
  const sendImages = async (files: File[]) => {
    if (!files.length || !currentUid) return;
    if (mediaSendingRef.current) {
      setSyncError('사진 전송이 끝난 뒤 다음 사진을 보내 주세요.');
      return;
    }

    const selected = files.slice(0, MAX_CHAT_PHOTOS);
    const messageId = createMessageId();
    const urls: string[] = [];
    let uploadedPaths: string[] = [];
    mediaSendingRef.current = true;
    setMediaProgress({ completed: 0, total: selected.length });

    try {
      setSyncError('');
      if (files.length > MAX_CHAT_PHOTOS) showFlowNotice(`한 번에 최대 ${MAX_CHAT_PHOTOS}장까지 전송할 수 있어요.`);

      for (const file of selected) {
        if (!file.type.startsWith('image/')) throw new Error('unsupported-image');
        if (file.size > MAX_SOURCE_IMAGE_BYTES) throw new Error('source-image-too-large');
        if (file.type === 'image/gif' && file.size > MAX_GIF_BYTES) throw new Error('gif-too-large');
      }

      for (let offset = 0; offset < selected.length; offset += CHAT_MEDIA_BATCH_SIZE) {
        const batch = selected.slice(offset, offset + CHAT_MEDIA_BATCH_SIZE);

        if (connection) {
          // Pass File objects directly to Storage. This removes the expensive
          // FileReader -> Base64 string -> fetch(data URL) -> Blob round-trip
          // that used to happen for every selected photo.
          const uploaded = await uploadChatMedia(connection.coupleId, currentUid, messageId, batch, {
            startIndex: offset,
            onUploaded: (completedInBatch) => setMediaProgress({ completed: offset + completedInBatch, total: selected.length }),
          });
          urls.push(...uploaded.urls);
          uploadedPaths = [...uploadedPaths, ...uploaded.paths];
        } else {
          for (let index = 0; index < batch.length; index += 1) {
            urls.push(await prepareImage(batch[index], preferences.mediaQuality));
            setMediaProgress({ completed: Math.min(offset + index + 1, selected.length), total: selected.length });
            await yieldToUi();
          }
        }
      }

      const message: Message = urls.length === 1
        ? { id: messageId, sender: 'me', type: 'image', imageUrl: urls[0], timestamp: new Date().toISOString(), read: usingAiPartner, replyTo }
        : { id: messageId, sender: 'me', type: 'gallery', imageUrls: urls, timestamp: new Date().toISOString(), read: usingAiPartner, replyTo };

      if (connection) await sendCoupleMessage(connection.coupleId, currentUid, message);
      forceBottomRef.current = true;
      appendIfMissing(message);
      setReplyTo(undefined);
      showFlowNotice(urls.length === 1 ? '사진을 전송했어요.' : `사진 ${urls.length}장을 전송했어요.`);
    } catch (cause) {
      if (uploadedPaths.length) await deleteUploadedChatMedia(uploadedPaths);
      console.error('[ROUTE chat photo]', cause);
      setSyncError(mediaErrorMessage(cause, 'photo'));
    } finally {
      mediaSendingRef.current = false;
      setMediaProgress(null);
    }
  };
  const sendGif = async (file: File) => {
    if (!currentUid) return;
    let uploadedPaths: string[] = [];
    try {
      setSyncError('');
      if (file.size > MAX_GIF_BYTES) throw new Error('gif-too-large');
      showFlowNotice('움짤을 전송하고 있어요.');
      const preparedUrl = await readFile(file);
      const messageId = createMessageId();
      let imageUrl = preparedUrl;

      if (connection) {
        const uploaded = await uploadChatMedia(connection.coupleId, currentUid, messageId, [preparedUrl]);
        imageUrl = uploaded.urls[0];
        uploadedPaths = uploaded.paths;
      }

      const message: Message = { id: messageId, sender: 'me', type: 'gif', imageUrl, timestamp: new Date().toISOString(), read: usingAiPartner, replyTo };
      if (connection) await sendCoupleMessage(connection.coupleId, currentUid, message);
      forceBottomRef.current = true;
      appendIfMissing(message);
      setReplyTo(undefined);
      showFlowNotice('움짤을 전송했어요.');
    } catch (cause) {
      if (uploadedPaths.length) await deleteUploadedChatMedia(uploadedPaths);
      console.error('[ROUTE chat gif]', cause);
      setSyncError(mediaErrorMessage(cause, 'gif'));
    }
  };

  const openScheduleMessage = () => {
    const defaults = currentScheduleDefaults();
    setScheduleForm((current) => ({
      text: current.text,
      date: defaults.date,
      time: defaults.time,
    }));
    setScheduleError('');
    setScheduleOpen(true);
  };

  const reserveMessage = () => {
    setScheduleError('');
    if (!scheduleForm.text.trim()) return setScheduleError('예약할 메시지를 입력해 주세요.');
    if (!scheduleDateIsValid(scheduleForm.date)) return setScheduleError('날짜를 YYYY-MM-DD 형식으로 정확하게 입력해 주세요.');
    if (!/^\d{2}:\d{2}$/.test(scheduleForm.time)) return setScheduleError('보낼 시간을 입력해 주세요.');

    const sendAt = `${scheduleForm.date}T${scheduleForm.time}`;
    const sendAtMs = new Date(sendAt).getTime();
    if (!Number.isFinite(sendAtMs) || sendAtMs <= Date.now()) return setScheduleError('현재보다 이후 날짜와 시간을 입력해 주세요.');

    setScheduledDrafts((items) => [...items, { id: createMessageId(), text: scheduleForm.text.trim(), sendAt }]);
    setScheduleForm({ text: '', date: '', time: '' });
    setScheduleError('');
    setScheduleOpen(false);
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

  const react = (id: number, emoji: string) => {
    setMessages((items) => items.map((message) => message.id !== id ? message : { ...message, reactions: message.reactions?.some((reaction) => reaction.by === 'me' && reaction.emoji === emoji) ? message.reactions.filter((reaction) => !(reaction.by === 'me' && reaction.emoji === emoji)) : [...(message.reactions ?? []).filter((reaction) => reaction.by !== 'me'), { emoji, by: 'me' }] }));
    if (connection && currentUid) void toggleCoupleMessageReaction(connection.coupleId, id, currentUid, emoji).catch((cause) => {
      console.error('[ROUTE chat reaction]', cause);
      setSyncError('메시지 반응을 동기화하지 못했어요.');
    });
  };
  const jump = (id: number) => {
    // The target row may not be mounted right now (virtualization only keeps
    // near-viewport rows in the DOM), so scroll by index instead of relying
    // on document.getElementById + scrollIntoView.
    const index = rows.findIndex((row) => row.kind === 'message' && row.message.id === id);
    if (index >= 0) rowVirtualizer.scrollToIndex(index, { align: 'center', behavior: 'smooth' });
    setHighlighted(id);
    window.setTimeout(() => setHighlighted(undefined), 1400);
  };
  const beginDeleteSelection = (message: Message) => {
    setActive(undefined);
    setDeleteSelection(new Set([message.id]));
  };

  const toggleDeleteSelection = (message: Message) => {
    setDeleteSelection((current) => {
      if (!current) return new Set([message.id]);
      const next = new Set(current);
      if (next.has(message.id)) next.delete(message.id);
      else next.add(message.id);
      return next;
    });
  };

  const closeDeleteSelection = () => {
    if (deleteBusy) return;
    setDeleteConfirmOpen(false);
    setDeleteSelection(null);
  };

  const confirmDeleteSelection = async () => {
    if (!selectedDeleteMessages.length || deleteBusy) return;
    setDeleteBusy(true);
    setSyncError('');

    const succeeded = new Set<number>();
    let failed = 0;

    if (!connection || !currentUid) {
      selectedDeleteMessages.forEach((message) => succeeded.add(message.id));
    } else {
      const results = await Promise.allSettled(selectedDeleteMessages.map(async (message) => {
        const sentAt = Date.parse(message.timestamp);
        const deleteForEveryone = message.sender === 'me'
          && Number.isFinite(sentAt)
          && Date.now() - sentAt < DELETE_FOR_EVERYONE_WINDOW_MS;
        if (deleteForEveryone) {
          await deleteCoupleMessageForEveryone(connection.coupleId, message.id, currentUid);
        } else {
          await hideCoupleMessageForMe(connection.coupleId, message.id, currentUid);
        }
        return message.id;
      }));
      results.forEach((result) => {
        if (result.status === 'fulfilled') succeeded.add(result.value);
        else failed += 1;
      });
    }

    if (succeeded.size) {
      setMessages((items) => items.filter((message) => !succeeded.has(message.id)));
    }

    setDeleteBusy(false);
    setDeleteConfirmOpen(false);

    if (failed) {
      setDeleteSelection(new Set(
        selectedDeleteMessages
          .filter((message) => !succeeded.has(message.id))
          .map((message) => message.id),
      ));
      setSyncError(`${failed}개 메시지를 삭제하지 못했어요. 다시 시도해 주세요.`);
      return;
    }

    setDeleteSelection(null);
    showFlowNotice(
      localOnlyDeleteCount > 0 && recentDeleteCount > 0
        ? `내 최근 메시지 ${recentDeleteCount}개는 모두에게, 나머지 ${localOnlyDeleteCount}개는 내 화면에서 삭제했어요.`
        : recentDeleteCount > 0
          ? `메시지 ${recentDeleteCount}개를 모두에게 삭제했어요.`
          : `메시지 ${localOnlyDeleteCount}개를 내 화면에서 삭제했어요.`,
    );
  };

  const clearAllChat = async () => {
    if (!currentUid || deleteBusy) return;
    setDeleteBusy(true);
    setSyncError('');
    try {
      if (connection) await clearCoupleChatForMe(connection.coupleId, currentUid);
      window.dispatchEvent(new CustomEvent('route-chat-cleared-all'));
      setMessages([]);
      setActive(undefined);
      setReplyTo(undefined);
      setDeleteSelection(null);
      setDeleteConfirmOpen(false);
      setLightbox(undefined);
      showFlowNotice('모든 대화를 삭제했어요.');
    } catch (cause) {
      console.error('[ROUTE clear chat]', cause);
      setSyncError('모든 대화를 삭제하지 못했어요. 네트워크 연결을 확인한 뒤 다시 시도해 주세요.');
    } finally {
      setDeleteBusy(false);
    }
  };

  const saveMessage = (message: Message) => {
    if (isChatMediaMessage(message)) {
      const result = toggleChatMessageMemory(message, partnerName);
      setSavedMediaIds(loadChatMemoryMessageIds());
      setMessages((items) => items.map((item) => item.id === message.id ? { ...item, saved: result.saved } : item));
      showFlowNotice(result.saved ? '사진을 추억 앨범에 저장했어요.' : '추억 앨범에서 사진을 제거했어요.');
    } else {
      setMessages((items) => items.map((item) => item.id === message.id ? { ...item, saved: !item.saved } : item));
      showFlowNotice(message.saved ? '메시지 저장을 취소했어요.' : '메시지를 저장했어요.');
    }
    setActive(undefined);
  };

  return <div className={`page full-page chat-page chat-bg-${preferences.background} chat-font-${preferences.fontSize} ${deleteSelection ? 'chat-delete-mode' : ''}`}>
    {deleteSelection
      ? <div className="chat-delete-toolbar">
        <button type="button" className="chat-delete-all-button" disabled={deleteBusy || messages.length === 0} onClick={() => void clearAllChat()}>{deleteBusy ? '삭제 중...' : '모든 대화 삭제'}</button>
        <strong>{deleteSelection.size}</strong>
        <span />
        <button type="button" className="chat-delete-toolbar-cancel" aria-label="삭제 선택 취소" disabled={deleteBusy} onClick={closeDeleteSelection}><X size={21} /></button>
        <button type="button" className="chat-delete-toolbar-trash" aria-label="선택 메시지 삭제" disabled={!deleteSelection.size || deleteBusy} onClick={() => setDeleteConfirmOpen(true)}><Trash2 size={21} /></button>
      </div>
      : <Header title="대화" />}
    <div className="chat-profile"><div className="avatar large">{usingAiPartner ? <Bot size={22} /> : partnerInitial}</div><div><b>{partnerName}</b><span className={aiTyping || partnerTyping ? 'chat-status typing' : 'chat-status'}><i /> {aiTyping || partnerTyping ? '입력 중...' : connection ? '실시간 연결됨' : usingAiPartner ? 'AI 테스트 파트너 · 연결됨' : '상대방 연결 대기'}</span></div><div className="chat-call-actions">{CALLING_ENABLED && <><button aria-label="음성 통화" onClick={() => void startMedia('voice')}><Phone size={17} /></button><button aria-label="영상 통화" onClick={() => void startMedia('video')}><Video size={17} /></button><button aria-label="화면 공유" onClick={() => void startMedia('screen')}><MonitorUp size={17} /></button></>}<button aria-label="대화 메뉴" onClick={() => setToolsOpen(true)}><MoreHorizontal /></button></div></div>
    {nearestSchedule && <div className="chat-next-schedule"><CalendarClock size={16} /><div><small>가장 가까운 일정</small><b>{nearestSchedule.title}</b><span>{nearestSchedule.date.replaceAll('-', '.')} · {nearestSchedule.startTime}</span></div></div>}
    {syncError && <p className="chat-sync-error" role="alert">{syncError}</p>}
    {flowNotice && <p className="chat-flow-notice" role="status">{flowNotice}</p>}
    {mediaProgress && <p className="chat-media-progress" role="status" aria-live="polite">사진 {mediaProgress.completed} / {mediaProgress.total}장 전송 중...</p>}
    <div
      ref={messagesRef}
      className="messages !min-h-0 !flex-1 !overflow-y-auto overscroll-contain [scroll-behavior:auto] [touch-action:pan-y] [-webkit-overflow-scrolling:touch]"
      onScroll={updateNearBottom}
      onWheel={handleMessagesWheel}
      onClick={() => active && !deleteSelection && setActive(undefined)}
    ><div style={{ position: 'relative', width: '100%', height: rowVirtualizer.getTotalSize() }}>{rowVirtualizer.getVirtualItems().map((virtualRow) => {
      const row = rows[virtualRow.index];
      return <div
        key={row.key}
        data-index={virtualRow.index}
        ref={rowVirtualizer.measureElement}
        style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${virtualRow.start}px)` }}
      >{row.kind === 'message' ? (() => {
        const message = row.message;
        const displayedMessage = isChatMediaMessage(message) ? { ...message, saved: savedMediaIds.has(message.id) } : message;
        return <>{row.showDate && <div className="date-chip">{messageDateLabel(message.timestamp)}</div>}<ChatBubble message={displayedMessage} reply={message.replyTo ? byId.get(message.replyTo) : undefined} partnerName={partnerName} partnerInitial={partnerInitial} active={active === message.id} highlighted={highlighted === message.id} selectionMode={Boolean(deleteSelection)} selected={Boolean(deleteSelection?.has(message.id))} onAction={() => setActive(active === message.id ? undefined : message.id)} onReact={(emoji) => react(message.id, emoji)} onReply={() => { setReplyTo(message.id); setActive(undefined); }} onSave={() => saveMessage(displayedMessage)} onDelete={() => beginDeleteSelection(displayedMessage)} onToggleSelect={() => toggleDeleteSelection(displayedMessage)} onImage={setLightbox} onJump={jump} /></>;
      })() : row.kind === 'typing-ai' ? <TypingIndicator ai initial={partnerInitial} /> : <TypingIndicator ai={false} initial={partnerInitial} heart />}</div>;
    })}</div><div ref={bottomRef} /></div>
    {scheduledDrafts.length > 0 && !deleteSelection && <div className="scheduled-strip"><CalendarClock size={14} /><span>예약 메시지 {scheduledDrafts.length}개</span><small>앱 실행 중 자동 전송</small></div>}
    {!deleteSelection && <ChatComposer draft={draft} reply={replyTo ? byId.get(replyTo) : undefined} partnerName={partnerName} onDraft={setDraft} onSend={send} onImages={sendImages} onGif={sendGif} onQuick={sendText} onSchedule={openScheduleMessage} onGift={() => setGiftOpen(true)} onCancelReply={() => setReplyTo(undefined)} />}
    {toolsOpen && <ChatToolsPanel messages={messages} partnerName={partnerName} preferences={preferences} onPreferences={setPreferences} onJump={jump} onImage={setLightbox} onImport={(imported) => setMessages(imported)} onSticker={sendText} onClose={() => setToolsOpen(false)} />}
    {lightbox && <div className="lightbox" role="dialog" onClick={() => setLightbox(undefined)}><button aria-label="닫기"><X /></button><img src={lightbox} alt="확대된 채팅 사진" /></div>}

    {deleteConfirmOpen && <div className="chat-delete-backdrop" role="presentation" onMouseDown={() => !deleteBusy && setDeleteConfirmOpen(false)}>
      <section className="chat-delete-sheet" role="dialog" aria-modal="true" aria-label="메시지 삭제 확인" onMouseDown={(event) => event.stopPropagation()}>
        <div className="chat-delete-sheet-handle" />
        <h2>메시지 {selectedDeleteMessages.length}개 삭제</h2>
        {recentDeleteCount > 0 && <p><b>{recentDeleteCount}개</b>는 내가 보낸 지 10분이 지나지 않아 상대방과 나에게 모두 삭제돼요.</p>}
        {ownLocalOnlyDeleteCount > 0 && <p><b>{ownLocalOnlyDeleteCount}개</b>는 내가 보낸 지 10분이 지나 내 화면에서만 삭제돼요.</p>}
        {partnerDeleteCount > 0 && <p><b>{partnerDeleteCount}개</b>는 상대방이 보낸 메시지라 내 화면에서만 삭제돼요.</p>}
        <button type="button" className="chat-delete-confirm" disabled={deleteBusy} onClick={() => void confirmDeleteSelection()}>{deleteBusy ? '삭제 중...' : '삭제하기'}</button>
        <button type="button" className="chat-delete-cancel" disabled={deleteBusy} onClick={() => setDeleteConfirmOpen(false)}>취소</button>
      </section>
    </div>}

    {scheduleOpen && <div className="chat-extra-backdrop" onMouseDown={() => { setScheduleOpen(false); setScheduleError(''); }}><section className="chat-extra-modal" onMouseDown={(event) => event.stopPropagation()}><button className="chat-extra-close" onClick={() => { setScheduleOpen(false); setScheduleError(''); }}><X /></button><CalendarClock className="modal-accent-icon" /><h2>예약 메시지</h2><p>현재 버전에서는 ROUTE가 실행 중일 때 예약 시간이 되면 자동으로 보내요.</p><label>메시지<textarea value={scheduleForm.text} onChange={(event) => { setScheduleForm({ ...scheduleForm, text: event.target.value }); setScheduleError(''); }} placeholder="나중에 전할 말을 적어주세요" /></label><div className="chat-schedule-datetime"><label>보낼 날짜<input type="text" inputMode="numeric" autoComplete="off" maxLength={10} value={scheduleForm.date} onChange={(event) => { setScheduleForm({ ...scheduleForm, date: formatScheduleDateInput(event.target.value) }); setScheduleError(''); }} placeholder="YYYY-MM-DD" aria-label="예약 메시지 보낼 날짜" /></label><label>보낼 시간<input type="time" value={scheduleForm.time} onChange={(event) => { setScheduleForm({ ...scheduleForm, time: event.target.value }); setScheduleError(''); }} aria-label="예약 메시지 보낼 시간" /></label></div>{scheduleError && <p className="chat-schedule-error" role="alert">{scheduleError}</p>}<button className="primary" disabled={!scheduleForm.text.trim() || scheduleForm.date.length !== 10 || !scheduleForm.time} onClick={reserveMessage}>예약하기</button></section></div>}

    {giftOpen && <div className="chat-extra-backdrop" onMouseDown={() => setGiftOpen(false)}><section className="chat-extra-modal gift-modal" onMouseDown={(event) => event.stopPropagation()}><button className="chat-extra-close" onClick={() => setGiftOpen(false)}><X /></button><Gift className="modal-accent-icon" /><h2>선물하기</h2><p>생일이나 기념일에 바로 선물 메시지를 보낼 수 있어요. 결제 연결은 다음 단계에서 추가할 수 있어요.</p><div className="gift-options">{['🎂 생일 선물', '💐 기념일 선물', '☕ 커피 선물', '🍰 달콤한 선물'].map((gift) => <button key={gift} onClick={() => { sendText(`🎁 ${gift}을(를) 보내고 싶어요 ❤️`); setGiftOpen(false); }}>{gift}</button>)}</div><button className="gift-ai" disabled>AI 선물 추천 · 준비 중</button></section></div>}

    {CALLING_ENABLED && callMode && <div className="chat-extra-backdrop"><section className="chat-call-modal"><div className="call-heart"><Heart fill="currentColor" /></div><h2>{callMode === 'voice' ? '음성 통화' : callMode === 'video' ? '영상 통화' : '화면 공유'}</h2><p>{partnerName}과 연결할 준비를 하고 있어요.</p>{callMode !== 'voice' && <video ref={videoRef} autoPlay muted playsInline />}{callMode === 'voice' && <div className="voice-wave"><span /><span /><span /><span /><span /></div>}<small>현재는 내 기기 미디어 연결까지 동작하며, 상대방과의 실제 WebRTC 연결은 시그널링 서버 연결 단계에서 완성됩니다.</small><button className="call-end" onClick={stopMedia}>종료</button></section></div>}
  </div>;
}
