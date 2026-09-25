import { collection, deleteDoc, doc, limitToLast, onSnapshot, orderBy, query, runTransaction, serverTimestamp, setDoc, updateDoc, where } from 'firebase/firestore';
import { db } from './firebase';
import type { Message, Reaction } from '../types';
import { publishCoupleActivity } from './coupleActivity';
import { mergePagedSnapshot, messageTimeValue } from './messageSnapshot';
import { createUiTaskScope } from '../utils/uiTaskScope';

type CloudReaction = { emoji: string; uid: string };
type MessageStateSink = (value: Message[] | ((current: Message[]) => Message[])) => void;
type UserChatState = {
  chatClearBefore?: Record<string, string>;
};

type CloudMessage = {
  id: number;
  authorUid: string;
  type: 'text' | 'image' | 'gallery' | 'gif' | 'sticker' | 'file' | 'contact' | 'audio' | 'call';
  text?: string;
  imageUrl?: string;
  imageUrls?: string[];
  stickerId?: string;
  attachmentUrl?: string;
  attachmentName?: string;
  attachmentSize?: number;
  attachmentMime?: string;
  audioDuration?: number;
  contactName?: string;
  contactPhone?: string;
  callId?: string;
  callKind?: 'voice' | 'video';
  callStatus?: 'completed' | 'rejected' | 'cancelled' | 'failed';
  callDuration?: number;
  timestamp: string;
  createdAt?: unknown;
  read?: boolean;
  replyTo?: number;
  reactions?: CloudReaction[];
  savedBy?: string[];
  scheduledFor?: string;
  hiddenFor?: string[];
};

const INITIAL_CHAT_PAGE = 40;
const CHAT_PAGE_STEP = 40;
const HISTORY_TRIGGER_PX = 110;
const chatWindowSizeByRoom = new Map<string, number>();
const CHAT_CLEAR_LOCAL_PREFIX = 'route-chat-clear-before:';

function chatClearLocalKey(coupleId: string, currentUid: string) {
  return `${CHAT_CLEAR_LOCAL_PREFIX}${currentUid}:${coupleId}`;
}

function normalizeClearIso(value: unknown) {
  if (typeof value !== 'string') return '';
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : '';
}

function latestClearIso(first: string, second: string) {
  const firstTime = Date.parse(first);
  const secondTime = Date.parse(second);
  if (!Number.isFinite(firstTime)) return Number.isFinite(secondTime) ? second : '';
  if (!Number.isFinite(secondTime)) return first;
  return secondTime > firstTime ? second : first;
}

function messageRef(coupleId: string, id: number) {
  return doc(db, 'couples', coupleId, 'messages', String(id));
}

function toMessage(snapshotDoc: { id: string; data: () => unknown }, currentUid: string): Message | undefined {
  const data = snapshotDoc.data() as CloudMessage;
  if (data.hiddenFor?.includes(currentUid)) return undefined;
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
    stickerId: data.stickerId,
    attachmentUrl: data.attachmentUrl,
    attachmentName: data.attachmentName,
    attachmentSize: data.attachmentSize,
    attachmentMime: data.attachmentMime,
    audioDuration: data.audioDuration,
    contactName: data.contactName,
    contactPhone: data.contactPhone,
    callId: data.callId,
    callKind: data.callKind,
    callStatus: data.callStatus,
    callDuration: data.callDuration,
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
  onMessages: MessageStateSink,
  onError?: (error: unknown) => void,
  pageSize = INITIAL_CHAT_PAGE,
) {
  let disposed = false;
  const roomKey = `${coupleId}:${currentUid}`;
  let requestedCount = Math.max(1, pageSize, chatWindowSizeByRoom.get(roomKey) ?? 0);
  let lastSnapshotCount = 0;
  let snapshotUnsubscribe: (() => void) | undefined;
  let queryGeneration = 0;
  let clearStateReady = false;
  let clearedBeforeIso = '';
  try {
    clearedBeforeIso = normalizeClearIso(localStorage.getItem(chatClearLocalKey(coupleId, currentUid)));
  } catch {
    clearedBeforeIso = '';
  }
  let messageScroller: HTMLElement | null = null;
  let loadingOlder = false;
  let previousHeight = 0;
  let previousTop = 0;
  let attachTimer: number | undefined;
  let restoringScroll = false;
  const scrollTasks = createUiTaskScope();
  const cancelScrollRestoration = () => {
    scrollTasks.clear();
    restoringScroll = false;
  };

  chatWindowSizeByRoom.set(roomKey, requestedCount);

  const restoreScrollPosition = () => {
    if (!messageScroller || !loadingOlder || restoringScroll) return;
    restoringScroll = true;
    const restore = () => {
      if (disposed || !messageScroller || !loadingOlder) return;
      const addedHeight = Math.max(0, messageScroller.scrollHeight - previousHeight);
      messageScroller.scrollTop = previousTop + addedHeight;
    };

    // ChatPage also scrolls to the newest message when its list grows. Re-apply
    // the preserved position after that animation window so loading history does
    // not throw the user back to the bottom.
    scrollTasks.frame(() => scrollTasks.frame(restore));
    scrollTasks.delay(restore, 90);
    scrollTasks.delay(restore, 240);
    scrollTasks.delay(restore, 450);
    scrollTasks.delay(() => {
      restore();
      loadingOlder = false;
      restoringScroll = false;
      messageScroller?.removeAttribute('data-history-loading');
    }, 700);
  };

  const listen = () => {
    if (!clearStateReady || disposed) return;
    const generation = ++queryGeneration;
    snapshotUnsubscribe?.();
    const messageCollection = collection(db, 'couples', coupleId, 'messages');
    const q = clearedBeforeIso
      ? query(
        messageCollection,
        where('timestamp', '>', clearedBeforeIso),
        orderBy('timestamp', 'asc'),
        limitToLast(requestedCount),
      )
      : query(
        messageCollection,
        orderBy('timestamp', 'asc'),
        limitToLast(requestedCount),
      );
    snapshotUnsubscribe = onSnapshot(q, (snapshot) => {
      if (disposed || generation !== queryGeneration) return;
      lastSnapshotCount = snapshot.size;
      const incoming = snapshot.docs
        .map((snapshotDoc) => toMessage(snapshotDoc, currentUid))
        .filter((message): message is Message => Boolean(message));
      onMessages((current) => mergePagedSnapshot(current, incoming, CHAT_PAGE_STEP));
      if (loadingOlder) restoreScrollPosition();
    }, (error) => {
      if (disposed || generation !== queryGeneration) return;
      cancelScrollRestoration();
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
    cancelScrollRestoration();
    messageScroller?.removeEventListener('scroll', handleScroll);
    messageScroller = next;
    messageScroller.addEventListener('scroll', handleScroll, { passive: true });
  };

  const userRef = doc(db, 'users', currentUid);
  const clearStateUnsubscribe = onSnapshot(userRef, (snapshot) => {
    if (disposed) return;
    const data = snapshot.data() as UserChatState | undefined;
    const remoteClear = normalizeClearIso(data?.chatClearBefore?.[coupleId]);
    const nextClear = latestClearIso(clearedBeforeIso, remoteClear);
    const changed = nextClear !== clearedBeforeIso;
    clearedBeforeIso = nextClear;

    if (clearedBeforeIso) {
      try {
        localStorage.setItem(chatClearLocalKey(coupleId, currentUid), clearedBeforeIso);
      } catch {
        // Persistence is best-effort; Firestore remains the cross-device source.
      }
    }

    const firstReady = !clearStateReady;
    clearStateReady = true;
    if (changed) {
      cancelScrollRestoration();
      const cutoff = Date.parse(clearedBeforeIso);
      onMessages((current) => current.filter((message) => messageTimeValue(message) > cutoff));
      requestedCount = Math.max(1, pageSize);
      chatWindowSizeByRoom.set(roomKey, requestedCount);
      loadingOlder = false;
      messageScroller?.removeAttribute('data-history-loading');
    }
    if (firstReady || changed) listen();
  }, (error) => {
    if (disposed) return;
    console.warn('[ROUTE chat clear state]', error);
    if (clearStateReady) return;
    clearStateReady = true;
    listen();
  });

  attachTimer = window.setTimeout(() => attachScroller(), 0);

  return () => {
    disposed = true;
    cancelScrollRestoration();
    snapshotUnsubscribe?.();
    clearStateUnsubscribe?.();
    if (attachTimer) window.clearTimeout(attachTimer);
    messageScroller?.removeEventListener('scroll', handleScroll);
    messageScroller?.removeAttribute('data-history-loading');
    messageScroller = null;
    chatWindowSizeByRoom.delete(roomKey);
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
  if (message.stickerId) payload.stickerId = message.stickerId;
  if (message.attachmentUrl) payload.attachmentUrl = message.attachmentUrl;
  if (message.attachmentName) payload.attachmentName = message.attachmentName;
  if (typeof message.attachmentSize === 'number') payload.attachmentSize = message.attachmentSize;
  if (message.attachmentMime) payload.attachmentMime = message.attachmentMime;
  if (typeof message.audioDuration === 'number') payload.audioDuration = message.audioDuration;
  if (message.contactName) payload.contactName = message.contactName;
  if (message.contactPhone) payload.contactPhone = message.contactPhone;
  if (message.callId) payload.callId = message.callId;
  if (message.callKind) payload.callKind = message.callKind;
  if (message.callStatus) payload.callStatus = message.callStatus;
  if (typeof message.callDuration === 'number') payload.callDuration = message.callDuration;
  if (message.replyTo) payload.replyTo = message.replyTo;
  if (message.scheduledFor) payload.scheduledFor = message.scheduledFor;
  await setDoc(messageRef(coupleId, message.id), payload);
  // A failed activity write must not roll back an already delivered message.
  // Calls and scheduled drafts are not ordinary partner chat notifications.
  if (message.type !== 'call' && !message.scheduledFor) {
    void publishCoupleActivity(coupleId, currentUid, {
      id: 'chat-' + message.id, kind: 'chat', sourceId: String(message.id), revision: 0,
      title: '새 메시지가 왔어요',
      detail: (message.type === 'text' ? message.text || '' : '사진·파일 또는 이모티콘을 보냈어요.').slice(0, 200),
      target: { screen: 'chat', itemId: String(message.id) },
    }).catch((cause) => console.warn('[DANDULI chat activity]', cause));
  }
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
    .slice(0, 1)
    .map((reaction) => ({ emoji: reaction.emoji, uid: currentUid }));
  const ref = messageRef(coupleId, messageId);
  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists()) return;
    const existing = (snapshot.data() as CloudMessage).reactions ?? [];
    transaction.update(ref, { reactions: [...existing.filter((reaction) => reaction.uid !== currentUid), ...cloudReactions] });
  });
}

export async function setCoupleMessageSaved(coupleId: string, messageId: number, currentUid: string, saved: boolean) {
  const ref = messageRef(coupleId, messageId);
  if (!saved) return;
  await updateDoc(ref, { lastSavedBy: currentUid });
}

export async function clearCoupleChatForMe(coupleId: string, currentUid: string) {
  const clearedBefore = new Date().toISOString();
  const userRef = doc(db, 'users', currentUid);

  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(userRef);
    const data = snapshot.exists() ? snapshot.data() as UserChatState : {};
    const existing = data.chatClearBefore ?? {};
    transaction.set(userRef, {
      chatClearBefore: {
        ...existing,
        [coupleId]: clearedBefore,
      },
    }, { merge: true });
  });

  try {
    localStorage.setItem(chatClearLocalKey(coupleId, currentUid), clearedBefore);
  } catch {
    // Firestore already persisted the clear marker.
  }

  return clearedBefore;
}

const DELETE_FOR_EVERYONE_WINDOW_MS = 10 * 60 * 1000;

export async function hideCoupleMessageForMe(coupleId: string, messageId: number, currentUid: string) {
  const ref = messageRef(coupleId, messageId);
  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists()) return;
    const data = snapshot.data() as CloudMessage;
    const hiddenFor = Array.isArray(data.hiddenFor) ? data.hiddenFor : [];
    if (hiddenFor.includes(currentUid)) return;
    transaction.update(ref, { hiddenFor: [...hiddenFor, currentUid] });
  });
}

export async function deleteCoupleMessageForEveryone(
  coupleId: string,
  messageId: number,
  currentUid: string,
) {
  const ref = messageRef(coupleId, messageId);
  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists()) return;
    const data = snapshot.data() as CloudMessage;
    if (data.authorUid !== currentUid) throw new Error('message-not-owned');

    const sentAt = (data.createdAt as { toMillis?: () => number } | undefined)?.toMillis?.() ?? Number.NaN;
    if (!Number.isFinite(sentAt) || Date.now() - sentAt >= DELETE_FOR_EVERYONE_WINDOW_MS) {
      throw new Error('delete-window-expired');
    }
    transaction.delete(ref);
  });
}

// Legacy helper kept for older callers. New UI should use one of the
// ownership-aware helpers above.
export async function deleteCoupleMessage(coupleId: string, messageId: number) {
  await deleteDoc(messageRef(coupleId, messageId));
}
