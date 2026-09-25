import { collection, doc, getDocFromServer, limit, onSnapshot, orderBy, query, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from './firebase';

export type ActivityRoute = { screen: 'chat' | 'album' | 'date-plan'; itemId: string };
export type CoupleActivity = {
  id: string;
  authorUid: string;
  recipientUid: string;
  kind: 'chat' | 'memory' | 'date-plan';
  title: string;
  detail: string;
  target: ActivityRoute;
  sourceId: string;
  revision: number;
  createdAt?: unknown;
};

const coupleRef = (coupleId: string) => doc(db, 'couples', coupleId);
export const activityRef = (coupleId: string, id: string) => doc(db, 'couples', coupleId, 'activity', id);

const partnerCache = new Map<string, { uid: string; other: string }>();
export async function partnerForActivity(coupleId: string, currentUid: string): Promise<string> {
  const cached = partnerCache.get(coupleId);
  if (cached?.uid === currentUid) return cached.other;
  if (cached?.other === currentUid) return cached.uid;
  const snapshot = await getDocFromServer(coupleRef(coupleId));
  const members = snapshot.data()?.memberUids as string[] | undefined;
  if (members?.length !== 2 || !members.includes(currentUid)) throw new Error('couple-membership-required');
  const partner = members.find((uid) => uid !== currentUid)!;
  partnerCache.set(coupleId, { uid: currentUid, other: partner });
  return partner;
}

/** Use a deterministic activity ID for messages, so retries never duplicate notifications. */
export async function publishCoupleActivity(
  coupleId: string, currentUid: string, event: Omit<CoupleActivity, 'id' | 'authorUid' | 'recipientUid' | 'createdAt'> & { id: string },
) {
  const partner = await partnerForActivity(coupleId, currentUid);
  await setDoc(activityRef(coupleId, event.id), {
    ...event, authorUid: currentUid, recipientUid: partner, createdAt: serverTimestamp(),
  });
}

export function subscribeCoupleActivities(coupleId: string, recipientUid: string,
  onChange: (items: CoupleActivity[]) => void, onError: (error: unknown) => void,
) {
  // Query only recent items, including both sides. Rules allow access only to
  // the authenticated pair; client selects its own recipient in the callback.
  const events = query(collection(db, 'couples', coupleId, 'activity'), orderBy('createdAt', 'desc'), limit(200));
  return onSnapshot(events, (snapshot) => onChange(snapshot.docs
    .map((item) => ({ ...item.data(), id: item.id } as CoupleActivity))
    .filter((item) => item.recipientUid === recipientUid)), onError);
}
