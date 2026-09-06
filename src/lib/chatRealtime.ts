import { collection, deleteDoc, doc, limitToLast, onSnapshot, orderBy, query, runTransaction, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { db } from './firebase';
import type { Message, Reaction } from '../types';
import { startLegacyChatMediaMigration } from './chatMediaMigration';

type CloudReaction = { emoji: string; uid: string };
type MessageStateSink = (value: Message[] | ((current: Message[]) => Message[])) => void;

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
const chatWindowSizeByRoom = new Map<string, number>();

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

function messageTimeValue(message: Message) {
  const parsed = Date.parse(message.timestamp);
  return Number.isFinite(parsed) ? parsed : 0;
}

function mergePagedSnapshot(current: Message[], incoming: Message[]) {
  if (!incoming.length) return [];
  const incomingIds = new Set(incoming.map((message) => message.id));
  const earliestIncoming = messageTimeValue(incoming[0]);

  // The live query owns its visible time range. Preserve only a small page of
  // messages older than that range so cached/previously paged history does not
  // disappear merely because the latest-window boundary moved forward.
  const preservedOlder = current
    .filter((message) => !incomingIds.has(message.id) && messageTimeValue(message) < earliestIncoming)
    .slice(-CHAT_PAGE_STEP);

  const deduped = new Map<number, Message>();
  [...preservedOlder, ...incoming].forEach((message) => deduped.set(message.id, message));
  return [...deduped.values()].sort((a, b) => messageTimeValue(a) - messageTimeValue(b));
}

export function subscribeCoupleMessages(
  coupleId: string,
  currentUid: string,
  onMessages: MessageStateSink,
  onError?: (error: unknown) => void,
  pageSize = INITIAL_CHAT_PAGE,
) {
  let disposed = false;
  const roomKey = `${coupleId}:${currentUid}`;
  let requestedCount = Math.max(1, pageSize, chatWindowSizeByRoom.get(roomKey) ?? 0);
  let lastSnapshotCount = 0;
  let snapshotUnsubscribe: (() => void) | undefined;
  let messageScroller: HTMLElement | null = null;
  let loadingOlder = false;
  let previousHeight = 0;
  let previousTop = 0;
  let attachTimer: number | undefined;
  let migrationTimer: number | undefined;

  chatWindowSizeByRoom.set(roomKey, requestedCount);

  const restoreScrollPosition = () => {
    if (!messageScroller || !loadingOlder) return;
    const restore = () => {
      if (!messageScroller) return;
      const addedHeight = Math.max(0, messageScroller.scrollHeight - previousHeight);
      messageScroller.scrollTop = previousTop + addedHeight;
    };

    // ChatPage also scrolls to the newest message when its list grows. Re-apply
    // the preserved position after that animation window so loading history does
    // not throw the user back to the bottom.
    requestAnimationFrame(() => requestAnimationFrame(restore));
    window.setTimeout(restore, 90);
    window.setTimeout(restore, 240);
    window.setTimeout(restore, 450);
    window.setTimeout(() => {
      restore();
      loadingOlder = false;
      messageScroller?.removeAttribute('data-history-loading');
    }, 700);
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
      const incoming = snapshot.docs.map((snapshotDoc) => toMessage(snapshotDoc, currentUid));
      onMessages((current) => mergePagedSnapshot(current, incoming));
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
    chatWindowSizeByRoom.set(roomKey, requestedCount);
    listen();
  };

  const handleScroll = () => {
    if (!messageScroller || messageScroller.scrollTop > HISTORY_TRIGGER_PX) return;
    requestOlder();
  };

  const attachScroller = (attempt = 0) => {
    if (disposed) return;
    const next = document.querySelector<HTMLElement>('.chat-room-layer .chat-page .messages, .chat-page .messages');
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

  // Give the room its first paint and live-message snapshot before the one-time
  // historical conversion begins. Migration runs sequentially in the background:
  // originals are read once, tiny previews are uploaded, and Firestore updates
  // cause this same listener to replace placeholders with compressed photos.
  migrationTimer = window.setTimeout(() => {
    void startLegacyChatMediaMigration(coupleId, currentUid).catch((error) => {
      console.warn('[ROUTE chat media migration]', error);
    });
  }, 900);

  return () => {
    disposed = true;
    snapshotUnsubscribe?.();
    if (attachTimer) window.clearTimeout(attachTimer);
    if (migrationTimer) window.clearTimeout(migrationTimer);
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
