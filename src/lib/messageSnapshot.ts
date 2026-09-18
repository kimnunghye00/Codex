import type { Message } from '../types';

type ScalarField = Exclude<keyof Message, 'imageUrls' | 'reactions'>;
// This must cover every scalar field: a new message feature cannot silently be
// left out of equality checks. Match the old rendering defaults exactly.
const defaults: Record<ScalarField, string | number | boolean | null> = {
  id: null, sender: null, type: null, text: '', imageUrl: '', stickerId: '',
  attachmentUrl: '', attachmentName: '', attachmentSize: 0, attachmentMime: '',
  audioDuration: 0, contactName: '', contactPhone: '', callId: '', callKind: '',
  callStatus: '', callDuration: 0, timestamp: '', read: false, replyTo: null,
  saved: false, scheduledFor: '',
};
const scalarFields = Object.keys(defaults) as ScalarField[];

export function sameMessage(first: Message, second: Message): boolean {
  if (first === second) return true;
  for (const key of scalarFields) {
    if ((first[key] ?? defaults[key]) !== (second[key] ?? defaults[key])) return false;
  }
  const images = first.imageUrls;
  const nextImages = second.imageUrls;
  if ((images?.length ?? 0) !== (nextImages?.length ?? 0)) return false;
  if (images?.some((url, index) => url !== nextImages?.[index])) return false;
  const reactions = first.reactions;
  const nextReactions = second.reactions;
  if ((reactions?.length ?? 0) !== (nextReactions?.length ?? 0)) return false;
  return !reactions?.some((reaction, index) => reaction.emoji !== nextReactions?.[index]?.emoji
    || reaction.by !== nextReactions?.[index]?.by);
}

export function messageTimeValue(message: Message) {
  const parsed = Date.parse(message.timestamp);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function mergePagedSnapshot(current: Message[], incoming: Message[], preservedPageSize = 40): Message[] {
  if (!incoming.length) return current.length ? [] : current;
  const currentById = new Map(current.map((message) => [message.id, message]));
  const incomingIds = new Set(incoming.map((message) => message.id));
  const earliestIncoming = messageTimeValue(incoming[0]);
  const preservedOlder: Message[] = [];
  // Stop once the previous page is retained instead of filtering all history.
  for (let index = current.length - 1; index >= 0 && preservedOlder.length < preservedPageSize; index -= 1) {
    const message = current[index];
    if (!incomingIds.has(message.id) && messageTimeValue(message) < earliestIncoming) preservedOlder.push(message);
  }
  preservedOlder.reverse();
  const deduped = new Map(preservedOlder.map((message) => [message.id, message]));
  for (const message of incoming) {
    const previous = currentById.get(message.id);
    deduped.set(message.id, previous && sameMessage(previous, message) ? previous : message);
  }
  const next = [...deduped.values()];
  // Firestore already orders live snapshots. Sort only legacy/unordered input.
  let previousTime = -Infinity;
  for (const message of next) {
    const time = messageTimeValue(message);
    if (time < previousTime) {
      next.sort((a, b) => messageTimeValue(a) - messageTimeValue(b));
      break;
    }
    previousTime = time;
  }
  return current.length === next.length && next.every((message, index) => message === current[index]) ? current : next;
}
