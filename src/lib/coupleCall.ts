import { doc, onSnapshot, runTransaction, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';

export type CoupleCallKind = 'voice' | 'video';
export type CoupleCallStatus = 'ringing' | 'active' | 'rejected' | 'ended' | 'failed';

export type StoredIceCandidate = {
  candidate: string;
  sdpMid: string | null;
  sdpMLineIndex: number | null;
  usernameFragment: string | null;
};

export type StoredSessionDescription = {
  type: 'offer' | 'answer';
  sdp: string;
};

export type CoupleCallUpgradeSignal = {
  version: number;
  requestedBy: 'caller' | 'callee';
  offer: StoredSessionDescription;
  answer?: StoredSessionDescription;
};

export type CoupleCallSignal = {
  callId: string;
  kind: CoupleCallKind;
  status: CoupleCallStatus;
  callerUid: string;
  calleeUid: string;
  offer: StoredSessionDescription;
  answer?: StoredSessionDescription;
  upgrade?: CoupleCallUpgradeSignal;
  callerCandidates: StoredIceCandidate[];
  calleeCandidates: StoredIceCandidate[];
  createdAtMs: number;
  acceptedAtMs?: number;
  endedAtMs?: number;
  endReason?: string;
  callLogMessageId?: number;
};

const STALE_CALL_MS = 2 * 60 * 1000;

function coupleRef(coupleId: string) {
  return doc(db, 'couples', coupleId);
}

function cleanDescription(description: RTCSessionDescriptionInit): StoredSessionDescription {
  if (!description.sdp || (description.type !== 'offer' && description.type !== 'answer')) {
    throw new Error('invalid-session-description');
  }
  return { type: description.type, sdp: description.sdp };
}

export function serializeIceCandidate(candidate: RTCIceCandidate | RTCIceCandidateInit): StoredIceCandidate {
  const json = 'toJSON' in candidate && typeof candidate.toJSON === 'function'
    ? candidate.toJSON()
    : candidate;
  return {
    candidate: String(json.candidate ?? ''),
    sdpMid: json.sdpMid ?? null,
    sdpMLineIndex: json.sdpMLineIndex ?? null,
    usernameFragment: json.usernameFragment ?? null,
  };
}

function normalizeSignal(value: unknown): CoupleCallSignal | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as Partial<CoupleCallSignal>;
  if (!data.callId || !data.callerUid || !data.calleeUid || !data.kind || !data.status || !data.offer?.sdp) return null;
  return {
    callId: String(data.callId),
    kind: data.kind === 'video' ? 'video' : 'voice',
    status: data.status,
    callerUid: String(data.callerUid),
    calleeUid: String(data.calleeUid),
    offer: { type: 'offer', sdp: String(data.offer.sdp) },
    answer: data.answer?.sdp ? { type: 'answer', sdp: String(data.answer.sdp) } : undefined,
    upgrade: (() => {
      const raw = data.upgrade as Partial<CoupleCallUpgradeSignal> | undefined;
      if (!raw?.offer?.sdp || (raw.requestedBy !== 'caller' && raw.requestedBy !== 'callee')) return undefined;
      const version = Number(raw.version ?? 0);
      if (!Number.isFinite(version) || version <= 0) return undefined;
      return {
        version,
        requestedBy: raw.requestedBy,
        offer: { type: 'offer', sdp: String(raw.offer.sdp) },
        answer: raw.answer?.sdp ? { type: 'answer', sdp: String(raw.answer.sdp) } : undefined,
      } satisfies CoupleCallUpgradeSignal;
    })(),
    callerCandidates: Array.isArray(data.callerCandidates) ? data.callerCandidates : [],
    calleeCandidates: Array.isArray(data.calleeCandidates) ? data.calleeCandidates : [],
    createdAtMs: Number(data.createdAtMs ?? 0),
    acceptedAtMs: data.acceptedAtMs ? Number(data.acceptedAtMs) : undefined,
    endedAtMs: data.endedAtMs ? Number(data.endedAtMs) : undefined,
    endReason: data.endReason ? String(data.endReason) : undefined,
    callLogMessageId: Number.isSafeInteger(data.callLogMessageId) ? Number(data.callLogMessageId) : undefined,
  };
}

export function subscribeCoupleCall(
  coupleId: string,
  onChange: (signal: CoupleCallSignal | null) => void,
  onError: (error: unknown) => void = () => undefined,
) {
  return onSnapshot(coupleRef(coupleId), (snapshot) => {
    const signal = normalizeSignal(snapshot.data()?.activeCall);
    onChange(signal);
  }, onError);
}

export async function startCoupleCall(
  coupleId: string,
  callId: string,
  callerUid: string,
  calleeUid: string,
  kind: CoupleCallKind,
  offer: RTCSessionDescriptionInit,
) {
  const ref = coupleRef(coupleId);
  const cleanOffer = cleanDescription(offer);
  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists()) throw new Error('couple-not-found');

    const existing = normalizeSignal(snapshot.data()?.activeCall);
    const existingBusy = existing
      && (existing.status === 'ringing' || existing.status === 'active')
      && Date.now() - existing.createdAtMs < STALE_CALL_MS;
    if (existingBusy) throw new Error('call-busy');

    const next: CoupleCallSignal = {
      callId,
      kind,
      status: 'ringing',
      callerUid,
      calleeUid,
      offer: cleanOffer,
      callerCandidates: [],
      calleeCandidates: [],
      createdAtMs: Date.now(),
    };
    transaction.update(ref, { activeCall: next });
  });
}

export async function answerCoupleCall(
  coupleId: string,
  callId: string,
  calleeUid: string,
  answer: RTCSessionDescriptionInit,
) {
  const ref = coupleRef(coupleId);
  const cleanAnswer = cleanDescription(answer);
  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists()) throw new Error('couple-not-found');
    const current = normalizeSignal(snapshot.data()?.activeCall);
    if (!current || current.callId !== callId || current.calleeUid !== calleeUid) throw new Error('call-expired');
    if (current.status !== 'ringing' && current.status !== 'active') throw new Error('call-not-ringing');

    transaction.update(ref, {
      activeCall: {
        ...current,
        status: 'active',
        answer: cleanAnswer,
        acceptedAtMs: Date.now(),
      } satisfies CoupleCallSignal,
    });
  });
}

export async function refreshCoupleCallDescription(
  coupleId: string,
  callId: string,
  side: 'caller' | 'callee',
  description: RTCSessionDescriptionInit,
) {
  const ref = coupleRef(coupleId);
  const clean = cleanDescription(description);
  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists()) return;
    const current = normalizeSignal(snapshot.data()?.activeCall);
    if (!current || current.callId !== callId) return;
    if (current.status !== 'ringing' && current.status !== 'active') return;

    if (side === 'caller' && clean.type === 'offer') {
      transaction.update(ref, { activeCall: { ...current, offer: clean } satisfies CoupleCallSignal });
      return;
    }
    if (side === 'callee' && clean.type === 'answer') {
      transaction.update(ref, { activeCall: { ...current, answer: clean } satisfies CoupleCallSignal });
    }
  });
}

export async function requestCoupleCallVideoUpgrade(
  coupleId: string,
  callId: string,
  side: 'caller' | 'callee',
  offer: RTCSessionDescriptionInit,
) {
  const ref = coupleRef(coupleId);
  const cleanOffer = cleanDescription(offer);
  if (cleanOffer.type !== 'offer') throw new Error('invalid-upgrade-offer');

  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists()) throw new Error('couple-not-found');
    const current = normalizeSignal(snapshot.data()?.activeCall);
    if (!current || current.callId !== callId || current.status !== 'active') throw new Error('call-expired');

    if (current.upgrade && !current.upgrade.answer) throw new Error('upgrade-busy');
    const version = (current.upgrade?.version ?? 0) + 1;

    transaction.update(ref, {
      activeCall: {
        ...current,
        kind: 'video',
        upgrade: {
          version,
          requestedBy: side,
          offer: cleanOffer,
        },
      } satisfies CoupleCallSignal,
    });
  });
}

export async function answerCoupleCallVideoUpgrade(
  coupleId: string,
  callId: string,
  side: 'caller' | 'callee',
  version: number,
  answer: RTCSessionDescriptionInit,
) {
  const ref = coupleRef(coupleId);
  const cleanAnswer = cleanDescription(answer);
  if (cleanAnswer.type !== 'answer') throw new Error('invalid-upgrade-answer');

  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists()) throw new Error('couple-not-found');
    const current = normalizeSignal(snapshot.data()?.activeCall);
    if (!current || current.callId !== callId || current.status !== 'active') throw new Error('call-expired');

    const upgrade = current.upgrade;
    if (!upgrade || upgrade.version !== version || upgrade.requestedBy === side) throw new Error('upgrade-expired');

    transaction.update(ref, {
      activeCall: {
        ...current,
        kind: 'video',
        upgrade: {
          ...upgrade,
          answer: cleanAnswer,
        },
      } satisfies CoupleCallSignal,
    });
  });
}

export async function appendCoupleCallCandidate(
  coupleId: string,
  callId: string,
  side: 'caller' | 'callee',
  candidate: RTCIceCandidate | RTCIceCandidateInit,
) {
  const serialized = serializeIceCandidate(candidate);
  if (!serialized.candidate) return;

  const ref = coupleRef(coupleId);
  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists()) return;
    const current = normalizeSignal(snapshot.data()?.activeCall);
    if (!current || current.callId !== callId) return;
    if (current.status !== 'ringing' && current.status !== 'active') return;

    const key = side === 'caller' ? 'callerCandidates' : 'calleeCandidates';
    const existing = current[key];
    if (existing.some((item) => item.candidate === serialized.candidate)) return;

    transaction.update(ref, {
      activeCall: {
        ...current,
        [key]: [...existing, serialized],
      },
    });
  });
}

function callLogId(callId: string, endedAtMs: number) {
  let hash = 23;
  for (let index = 0; index < callId.length; index += 1) hash = ((hash * 33) + callId.charCodeAt(index)) >>> 0;
  return Math.min(Number.MAX_SAFE_INTEGER, endedAtMs * 1000 + (hash % 1000));
}

function callRecordStatus(
  status: Extract<CoupleCallStatus, 'rejected' | 'ended' | 'failed'>,
  acceptedAtMs?: number,
): 'completed' | 'rejected' | 'cancelled' | 'failed' {
  if (status === 'rejected') return 'rejected';
  if (status === 'failed') return 'failed';
  return acceptedAtMs ? 'completed' : 'cancelled';
}

export async function finishCoupleCall(
  coupleId: string,
  callId: string,
  status: Extract<CoupleCallStatus, 'rejected' | 'ended' | 'failed'>,
  reason: string,
) {
  const ref = coupleRef(coupleId);
  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists()) return;
    const current = normalizeSignal(snapshot.data()?.activeCall);
    if (!current || current.callId !== callId) return;

    // A terminal update may race from both phones. The first transaction owns
    // the call-log record; later attempts see callLogMessageId and leave it alone.
    if (current.callLogMessageId) return;

    const endedAtMs = Date.now();
    const messageId = callLogId(callId, endedAtMs);
    const recordStatus = callRecordStatus(status, current.acceptedAtMs);
    const duration = current.acceptedAtMs
      ? Math.max(0, Math.round((endedAtMs - current.acceptedAtMs) / 1000))
      : 0;

    transaction.update(ref, {
      activeCall: {
        ...current,
        status,
        endedAtMs,
        endReason: reason,
        callLogMessageId: messageId,
      } satisfies CoupleCallSignal,
    });

    transaction.set(doc(db, 'couples', coupleId, 'messages', String(messageId)), {
      id: messageId,
      authorUid: current.callerUid,
      type: 'call',
      callId,
      callKind: current.kind,
      callStatus: recordStatus,
      callDuration: duration,
      timestamp: new Date(endedAtMs).toISOString(),
      createdAt: serverTimestamp(),
      read: false,
    });
  });
}
