import { collection, deleteDoc, doc, onSnapshot, orderBy, query, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
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

function messageRef(coupleId: string, id: number) {
  return doc(db, 'couples', coupleId, 'messages', String(id));
}

export function subscribeCoupleMessages(
  coupleId: string,
  currentUid: string,
  onMessages: (messages: Message[]) => void,
  onError?: (error: unknown) => void,
) {
  const q = query(collection(db, 'couples', coupleId, 'messages'), orderBy('timestamp', 'asc'));
  return onSnapshot(q, (snapshot) => {
    const messages = snapshot.docs.map((snapshotDoc) => {
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
    });
    onMessages(messages);
  }, onError);
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

export async function setCoupleMessageReactions(
  coupleId: string,
  messageId: number,
  currentUid: string,
  reactions: Reaction[] | undefined,
) {
  const cloudReactions: CloudReaction[] = (reactions ?? []).map((reaction) => ({
    emoji: reaction.emoji,
    uid: reaction.by === 'me' ? currentUid : `partner:${currentUid}`,
  }));
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
