import { collection, deleteDoc, doc, limitToLast, onSnapshot, orderBy, query, runTransaction, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { db } from './firebase';
import type { Message, Reaction } from '../types';

type CloudReaction = { emoji: string; uid: string };

type CloudMessage = {
  id: number;
  authorUid: string;
  type: 'text' | 'image' | 'gallery' | 'gif';
  text?: string;
  imageUrl?: string;
  imageUrls?: string[];
  timestamp: string;
  createdAt?: unknown;
  read?: boolean;
  replyTo?: number;
  reactions?: CloudReaction[];
  savedBy?: string[];
  scheduledFor?: string;
};

const INITIAL_CHAT_PAGE = 40;
const CHAT_PAGE_STEP = 40;
const HISTORY_TRIGGER_PX = 110;

function messageRef(coupleId: string, id: number) {
  return doc(db, 'couples', coupleId, 'messages', String(id));
}

function toMessage(snapshotDoc: { id: string; data: () => unknown }, currentUid: string): Message {
  const data = snapshotDoc.data() as CloudMessage;
  const sender = data.authorUid === currentUid ? 'me' : 'partner';
  const reactions: Reaction[] | undefined = data.reactions?.map((reaction) => ({
    emoji: reaction.emoji,
    by: reaction.uid === currentUid ? 'me' : 'partner',
  }));
  return {
    id: Number(data.id || snapshotDoc.id),
    sender,
    type: data.type || 'text',
    text: data.text,
    imageUrl: data.imageUrl,
    imageUrls: data.imageUrls,
    timestamp: data.timestamp || new Date().toISOString(),
    read: Boolean(data.read),
    replyTo: data.replyTo,
    reactions,
    saved: Boolean(data.savedBy?.includes(currentUid)),
    scheduledFor: data.scheduledFor,
  } satisfies Message;
}

export function subscribeCoupleMessages(
  coupleId: string,
  currentUid: string,
  onMessages: (messages: Message[]) => void,
  onError?: (error: unknown) => void,
  pageSize = INITIAL_CHAT_PAGE,
) {
  let disposed = false;
  let requestedCount = Math.max(1, pageSize);
  let lastSnapshotCount = 0;
  let snapshotUnsubscribe: (() => void) | undefined;
  let messageScroller: HTMLElement | null = null;
  let loadingOlder = false;
  let previousHeight = 0;
  let previousTop = 0;
  let attachTimer: number | undefined;

  const restoreScrollPosition = () => {
    if (!messageScroller || !loadingOlder) return;
    const restore = () => {
      if (!messageScroller) return;
      const addedHeight = Math.max(0, messageScroller.scrollHeight - previousHeight);
      messageScroller.scrollTop = previousTop + addedHeight;
    };
    requestAnimationFrame(() => requestAnimationFrame(restore));
    window.setTimeout(restore, 90);
    window.setTimeout(() => {
      restore();
      loadingOlder = false;
      messageScroller?.removeAttribute('data-history-loading');
    }, 240);
  };

  const listen = () => {
    snapshotUnsubscribe?.();
    const q = query(
      collection(db, 'couples', coupleId, 'messages'),
      orderBy('timestamp', 'asc'),
      limitToLast(requestedCount),
    );
    snapshotUnsubscribe = onSnapshot(q, (snapshot) => {
      lastSnapshotCount = snapshot.size;
      onMessages(snapshot.docs.map((snapshotDoc) => toMessage(snapshotDoc, currentUid)));
      if (loadingOlder) restoreScrollPosition();
    }, (error) => {
      loadingOlder = false;
      messageScroller?.removeAttribute('data-history-loading');
      onError?.(error);
    });
  };

  const requestOlder = () => {
    if (disposed || loadingOlder || !messageScroller) return;
    if (lastSnapshotCount < requestedCount) return;
    previousHeight = messageScroller.scrollHeight;
    previousTop = messageScroller.scrollTop;
    loadingOlder = true;
    messageScroller.setAttribute('data-history-loading', 'true');
    requestedCount += CHAT_PAGE_STEP;
    listen();
  };

  const handleScroll = () => {
    if (!messageScroller || messageScroller.scrollTop > HISTORY_TRIGGER_PX) return;
    requestOlder();
  };

  const attachScroller = (attempt = 0) => {
    if (disposed) return;
    const next = document.querySelector<HTMLElement>('.route-chat-room-layer .chat-page .messages, .chat-page .messages');
    if (!next) {
      if (attempt < 30) attachTimer = window.setTimeout(() => attachScroller(attempt + 1), 100);
      return;
    }
    if (messageScroller === next) return;
    messageScroller?.removeEventListener('scroll', handleScroll);
    messageScroller = next;
    messageScroller.addEventListener('scroll', handleScroll, { passive: true });
  };

  listen();
  attachTimer = window.setTimeout(() => attachScroller(), 0);

  return () => {
    disposed = true;
    snapshotUnsubscribe?.();
    if (attachTimer) window.clearTimeout(attachTimer);
    messageScroller?.removeEventListener('scroll', handleScroll);
  };
}

export async function sendCoupleMessage(coupleId: string, currentUid: string, message: Message) {
  const payload: CloudMessage = {
    id: message.id,
    authorUid: currentUid,
    type: message.type,
    timestamp: message.timestamp,
    createdAt: serverTimestamp(),
    read: false,
  };
  if (message.text) payload.text = message.text;
  if (message.imageUrl) payload.imageUrl = message.imageUrl;
  if (message.imageUrls?.length) payload.imageUrls = message.imageUrls;
  if (message.replyTo) payload.replyTo = message.replyTo;
  if (message.scheduledFor) payload.scheduledFor = message.scheduledFor;
  await setDoc(messageRef(coupleId, message.id), payload);
}

export async function toggleCoupleMessageReaction(
  coupleId: string,
  messageId: number,
  currentUid: string,
  emoji: string,
) {
  const ref = messageRef(coupleId, messageId);
  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists()) return;
    const data = snapshot.data() as CloudMessage;
    const reactions = data.reactions ?? [];
    const alreadySelected = reactions.some((reaction) => reaction.uid === currentUid && reaction.emoji === emoji);
    const next = reactions.filter((reaction) => reaction.uid !== currentUid);
    if (!alreadySelected) next.push({ emoji, uid: currentUid });
    transaction.update(ref, { reactions: next });
  });
}

export async function setCoupleMessageReactions(
  coupleId: string,
  messageId: number,
  currentUid: string,
  reactions: Reaction[] | undefined,
) {
  const cloudReactions: CloudReaction[] = (reactions ?? [])
    .filter((reaction) => reaction.by === 'me')
    .map((reaction) => ({ emoji: reaction.emoji, uid: currentUid }));
  await updateDoc(messageRef(coupleId, messageId), { reactions: cloudReactions });
}

export async function setCoupleMessageSaved(coupleId: string, messageId: number, currentUid: string, saved: boolean) {
  const ref = messageRef(coupleId, messageId);
  if (!saved) return;
  await updateDoc(ref, { lastSavedBy: currentUid });
}

export async function deleteCoupleMessage(coupleId: string, messageId: number) {
  await deleteDoc(messageRef(coupleId, messageId));
}
