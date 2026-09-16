import { Mic, MicOff, PhoneCall, PhoneOff, Video, VideoOff } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { RealCoupleConnection } from '../../lib/coupleConnection';
import { clearIncomingCallNotification, prepareIncomingCallNotifications, showIncomingCallNotification } from '../../lib/callNotifications';
import { isNativePlatform } from '../../lib/native';
import {
  answerCoupleCall,
  answerCoupleCallVideoUpgrade,
  appendCoupleCallCandidates,
  finishCoupleCall,
  refreshCoupleCallDescription,
  requestCoupleCallVideoUpgrade,
  startCoupleCall,
  subscribeCoupleCall,
  type CoupleCallKind,
  type CoupleCallSignal,
  type StoredIceCandidate,
} from '../../lib/coupleCall';
import { createCallTaskQueue } from '../../lib/callTaskQueue';
import { loadTurnIceServers } from '../../lib/turnCredentials';
import './DanduliCallManager.css';

type CallRole = 'caller' | 'callee';
type CallPhase = 'calling' | 'connecting' | 'connected' | 'ended';

type ActiveSession = {
  callId: string;
  kind: CoupleCallKind;
  role: CallRole;
  phase: CallPhase;
};

const CALL_REQUEST_EVENT = 'danduli-call-request';
const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
];
const DISCONNECT_GRACE_MS = 8_000;
const CONNECT_TIMEOUT_MS = 35_000;

function makeCallId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `call-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function callErrorCode(cause: unknown) {
  if (cause && typeof cause === 'object' && 'code' in cause) return String((cause as { code?: unknown }).code ?? '');
  return '';
}

function callErrorName(cause: unknown) {
  if (cause instanceof DOMException) return cause.name;
  if (cause instanceof Error) return cause.name;
  return '';
}

function callErrorMessage(cause: unknown, kind: CoupleCallKind) {
  const code = callErrorCode(cause);
  const name = callErrorName(cause);
  const message = cause instanceof Error ? cause.message : String(cause ?? '');

  if (message === 'call-busy') return '상대방이 이미 통화 중이에요.';
  if (message === 'media-not-supported' || message === 'webrtc-not-supported') {
    return '현재 브라우저 또는 앱 환경에서 실시간 통화를 지원하지 않아요. 앱이나 최신 브라우저에서 다시 시도해 주세요.';
  }
  if (name === 'NotAllowedError' || name === 'SecurityError' || code.includes('permission-denied')) {
    return kind === 'video'
      ? '영상통화를 위해 마이크와 카메라 권한을 허용해 주세요.'
      : '전화를 위해 마이크 권한을 허용해 주세요.';
  }
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return '마이크나 카메라를 다른 앱이 사용 중이에요. 다른 앱의 통화를 종료한 뒤 다시 시도해 주세요.';
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return kind === 'video'
      ? '사용할 수 있는 마이크나 카메라를 찾지 못했어요.'
      : '사용할 수 있는 마이크를 찾지 못했어요.';
  }
  if (name === 'OverconstrainedError' || name === 'ConstraintNotSatisfiedError') {
    return '이 기기의 마이크/카메라 설정으로 통화를 시작하지 못했어요. 기본 장치로 다시 시도해 주세요.';
  }
  if (
    navigator.onLine === false
    || code.includes('unavailable')
    || code.includes('deadline-exceeded')
    || code.includes('network-request-failed')
  ) {
    return '인터넷 연결이 끊겨 통화를 시작하지 못했어요. 연결을 확인한 뒤 다시 시도해 주세요.';
  }
  if (code.includes('failed-precondition')) {
    return '통화 연결 상태를 준비하지 못했어요. 잠시 후 다시 시도해 주세요.';
  }
  return '통화를 시작하지 못했어요. 마이크/카메라 권한과 상대방 연결 상태를 확인해 주세요.';
}

function canFallbackFromMediaError(cause: unknown) {
  const name = callErrorName(cause);
  return name === 'NotFoundError'
    || name === 'DevicesNotFoundError'
    || name === 'OverconstrainedError'
    || name === 'ConstraintNotSatisfiedError';
}

function waitForIceGathering(peer: RTCPeerConnection, timeoutMs = 5000) {
  if (peer.iceGatheringState === 'complete') return Promise.resolve();

  return new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      peer.removeEventListener('icegatheringstatechange', onState);
      window.clearTimeout(timer);
      resolve();
    };
    const onState = () => {
      if (peer.iceGatheringState === 'complete') finish();
    };
    const timer = window.setTimeout(finish, timeoutMs);
    peer.addEventListener('icegatheringstatechange', onState);
  });
}

function formatDuration(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safe / 60);
  const remain = String(safe % 60).padStart(2, '0');
  return `${minutes}:${remain}`;
}

function remoteCandidateList(signal: CoupleCallSignal, role: CallRole) {
  return role === 'caller' ? signal.calleeCandidates : signal.callerCandidates;
}

function endMessage(signal: CoupleCallSignal) {
  if (signal.status === 'rejected') return '상대방이 통화를 거절했어요.';
  if (signal.status === 'failed') return '통화 연결이 끊어졌어요.';
  return '통화가 종료됐어요.';
}

export function DanduliCallManager({
  currentUid,
  connection,
  partnerName,
  onIncomingCall,
}: {
  currentUid: string;
  connection: RealCoupleConnection | null;
  partnerName: string;
  onIncomingCall?: (kind: CoupleCallKind) => void;
}) {
  const [incoming, setIncoming] = useState<CoupleCallSignal | null>(null);
  const [session, setSession] = useState<ActiveSession | null>(null);
  const [message, setMessage] = useState('');
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [switchingToVideo, setSwitchingToVideo] = useState(false);
  const [connectedAt, setConnectedAt] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);

  const signalQueueRef = useRef(createCallTaskQueue());
  const candidateQueueRef = useRef(createCallTaskQueue());
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const activeCallIdRef = useRef('');
  const roleRef = useRef<CallRole | null>(null);
  const signalReadyRef = useRef(false);
  const pendingLocalCandidatesRef = useRef<RTCIceCandidate[]>([]);
  const addedRemoteCandidatesRef = useRef(new Set<string>());
  const disconnectTimerRef = useRef<number | undefined>(undefined);
  const closeTimerRef = useRef<number | undefined>(undefined);
  const latestSignalRef = useRef<CoupleCallSignal | null>(null);
  const notifiedCallIdRef = useRef('');
  const handledUpgradeVersionRef = useRef(0);
  const processingUpgradeVersionRef = useRef(0);

  const stopStreams = useCallback(() => {
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    remoteStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
    remoteStreamRef.current = null;
    setLocalStream(null);
    setRemoteStream(null);
  }, []);

  const resetLocalSession = useCallback((preserveMessage = false) => {
    if (disconnectTimerRef.current) window.clearTimeout(disconnectTimerRef.current);
    if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = undefined;
    disconnectTimerRef.current = undefined;
    signalQueueRef.current = createCallTaskQueue();
    candidateQueueRef.current = createCallTaskQueue();
    peerRef.current?.close();
    peerRef.current = null;
    stopStreams();
    activeCallIdRef.current = '';
    roleRef.current = null;
    signalReadyRef.current = false;
    pendingLocalCandidatesRef.current = [];
    addedRemoteCandidatesRef.current.clear();
    setSession(null);
    setIncoming(null);
    setMuted(false);
    setCameraOff(false);
    setSwitchingToVideo(false);
    handledUpgradeVersionRef.current = 0;
    processingUpgradeVersionRef.current = 0;
    setConnectedAt(null);
    setElapsedSeconds(0);
    if (!preserveMessage) setMessage('');
  }, [stopStreams]);

  const finishAndCloseLater = useCallback((text: string) => {
    setMessage(text);
    setSession((current) => current ? { ...current, phase: 'ended' } : current);
    if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = undefined;
      resetLocalSession();
    }, 1400);
  }, [resetLocalSession]);

  const applyRemoteCandidates = useCallback(async (candidates: StoredIceCandidate[]) => {
    const peer = peerRef.current;
    if (!peer?.remoteDescription) return;
    for (const candidate of candidates) {
      if (!candidate.candidate || addedRemoteCandidatesRef.current.has(candidate.candidate)) continue;
      try {
        await peer.addIceCandidate(candidate);
        addedRemoteCandidatesRef.current.add(candidate.candidate);
      } catch (cause) {
        console.warn('[DANDULI call remote candidate]', cause);
      }
    }
  }, []);

  const flushLocalCandidates = useCallback(async () => {
    const coupleId = connection?.coupleId;
    const callId = activeCallIdRef.current;
    const role = roleRef.current;
    if (!coupleId || !callId || !role || !signalReadyRef.current) return;
    const peer = peerRef.current;
    await candidateQueueRef.current(async () => {
      if (peerRef.current !== peer || activeCallIdRef.current !== callId) return;
      const pending = pendingLocalCandidatesRef.current.splice(0);
      if (!pending.length) return;
      try {
        await appendCoupleCallCandidates(coupleId, callId, role, pending);
      } catch (cause) {
        // Retain failed candidates for the next flush (including gathering completion).
        if (peerRef.current === peer && activeCallIdRef.current === callId) {
          pendingLocalCandidatesRef.current.unshift(...pending);
        }
        console.warn('[DANDULI call local candidates]', cause);
      }
    });
  }, [connection?.coupleId]);

  const createPeer = useCallback((callId: string, role: CallRole, turnIceServers: RTCIceServer[] = []) => {
    peerRef.current?.close();
    if (typeof RTCPeerConnection === 'undefined') throw new Error('webrtc-not-supported');
    const peer = new RTCPeerConnection({
      iceServers: [...turnIceServers, ...ICE_SERVERS],
      iceCandidatePoolSize: 8,
      iceTransportPolicy: 'all',
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require',
    });
    peerRef.current = peer;
    activeCallIdRef.current = callId;
    roleRef.current = role;
    addedRemoteCandidatesRef.current.clear();

    const remote = new MediaStream();
    remoteStreamRef.current = remote;
    setRemoteStream(remote);

    peer.ontrack = (event) => {
      const target = remoteStreamRef.current ?? remote;
      const tracks = event.streams[0]?.getTracks() ?? [event.track];
      tracks.forEach((track) => {
        if (!target.getTracks().some((existing) => existing.id === track.id)) target.addTrack(track);
      });
      remoteStreamRef.current = target;
      setRemoteStream(new MediaStream(target.getTracks()));
    };

    peer.onicecandidate = (event) => {
      if (!event.candidate) return;
      if (peerRef.current !== peer || activeCallIdRef.current !== callId) return;
      pendingLocalCandidatesRef.current.push(event.candidate);
      if (signalReadyRef.current) void flushLocalCandidates();
    };

    peer.onconnectionstatechange = () => {
      if (peerRef.current !== peer || activeCallIdRef.current !== callId) return;
      if (peer.connectionState === 'connected') {
        if (disconnectTimerRef.current) window.clearTimeout(disconnectTimerRef.current);
        disconnectTimerRef.current = undefined;
        setConnectedAt((value) => value ?? Date.now());
        setMessage('');
        setSession((current) => current && current.callId === callId ? { ...current, phase: 'connected' } : current);
        return;
      }

      if (peer.connectionState === 'disconnected') {
        setMessage('연결을 다시 확인하고 있어요…');
        if (disconnectTimerRef.current) window.clearTimeout(disconnectTimerRef.current);
        disconnectTimerRef.current = window.setTimeout(() => {
          const coupleId = connection?.coupleId;
          if (coupleId && activeCallIdRef.current === callId) {
            void finishCoupleCall(coupleId, callId, 'failed', 'webrtc-disconnected');
          }
          finishAndCloseLater('통화 연결이 끊어졌어요.');
        }, DISCONNECT_GRACE_MS);
        return;
      }

      if (peer.connectionState === 'failed') {
        const coupleId = connection?.coupleId;
        if (coupleId && activeCallIdRef.current === callId) {
          void finishCoupleCall(coupleId, callId, 'failed', 'webrtc-failed');
        }
        finishAndCloseLater('상대방과 음성·영상 경로를 만들지 못했어요. 잠시 후 다시 시도해 주세요.');
      }
    };

    return peer;
  }, [connection?.coupleId, finishAndCloseLater, flushLocalCandidates]);

  const acquireMedia = useCallback(async (kind: CoupleCallKind) => {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('media-not-supported');

    localStreamRef.current?.getTracks().forEach((track) => track.stop());

    let stream: MediaStream;
    if (kind === 'voice') {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      } catch (cause) {
        if (!canFallbackFromMediaError(cause)) throw cause;
        // A desktop without a microphone can still receive the partner's audio.
        // Do not misreport that hardware condition as an internet outage.
        stream = new MediaStream();
      }
    } else {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: { facingMode: 'user' },
        });
      } catch (firstCause) {
        if (!canFallbackFromMediaError(firstCause)) throw firstCause;
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        } catch (audioCause) {
          if (!canFallbackFromMediaError(audioCause)) throw audioCause;
          try {
            stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
          } catch (videoCause) {
            if (!canFallbackFromMediaError(videoCause)) throw videoCause;
            stream = new MediaStream();
          }
        }
      }
    }

    localStreamRef.current = stream;
    setLocalStream(stream);
    setMuted(false);
    setCameraOff(kind === 'video' && stream.getVideoTracks().length === 0);
    return stream;
  }, []);

  const ensureLocalVideoTrack = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('media-not-supported');

    const current = localStreamRef.current ?? new MediaStream();
    const existing = current.getVideoTracks().find((track) => track.readyState === 'live');
    if (existing) return existing;

    const cameraStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: 'user' },
    });
    const track = cameraStream.getVideoTracks()[0];
    if (!track) throw new Error('camera-not-found');

    current.addTrack(track);
    localStreamRef.current = current;
    setLocalStream(new MediaStream(current.getTracks()));
    setCameraOff(false);
    return track;
  }, []);

  const attachVideoTrack = useCallback((peer: RTCPeerConnection, track: MediaStreamTrack) => {
    const stream = localStreamRef.current ?? new MediaStream([track]);
    const sender = peer.getSenders().find((item) => item.track?.kind === 'video');
    if (sender) {
      void sender.replaceTrack(track);
      return;
    }
    peer.addTrack(track, stream);
  }, []);

  const startOutgoingCall = useCallback(async (kind: CoupleCallKind) => {
    // This click is a user gesture, so web browsers are allowed to ask for
    // notification permission here. Native permission is prepared on connect.
    void prepareIncomingCallNotifications();

    if (!connection?.coupleId || !connection.partnerUid || !currentUid) {
      setMessage('상대방과 연결된 뒤 통화할 수 있어요.');
      return;
    }
    if (activeCallIdRef.current) return;

    const callId = makeCallId();
    activeCallIdRef.current = callId;
    signalReadyRef.current = false;
    try {
      setMessage('');
      setIncoming(null);
      setSession({ callId, kind, role: 'caller', phase: 'calling' });
      const stream = await acquireMedia(kind);
      if (activeCallIdRef.current !== callId) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const turnIceServers = await loadTurnIceServers(connection.coupleId).catch((cause) => {
        console.warn('[DANDULI TURN credentials]', cause);
        return [];
      });
      const peer = createPeer(callId, 'caller', turnIceServers);
      stream.getTracks().forEach((track) => peer.addTrack(track, stream));
      if (!stream.getAudioTracks().length) peer.addTransceiver('audio', { direction: 'recvonly' });
      if (kind === 'video' && !stream.getVideoTracks().length) peer.addTransceiver('video', { direction: 'recvonly' });

      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);

      await startCoupleCall(connection.coupleId, callId, currentUid, connection.partnerUid, kind, peer.localDescription ?? offer);
      signalReadyRef.current = true;
      void flushLocalCandidates();

      void waitForIceGathering(peer).then(async () => {
        if (activeCallIdRef.current !== callId) return;
        const gatheredOffer = peer.localDescription;
        if (!gatheredOffer) return;
        try {
          await refreshCoupleCallDescription(connection.coupleId, callId, 'caller', gatheredOffer);
          await flushLocalCandidates();
        } catch (cause) {
          console.warn('[DANDULI call offer refresh]', cause);
        }
      });
    } catch (cause) {
      console.error('[DANDULI outgoing call]', cause);
      const text = callErrorMessage(cause, kind);
      resetLocalSession(true);
      setMessage(text);
      window.setTimeout(() => setMessage(''), 2400);
    }
  }, [acquireMedia, connection?.coupleId, connection?.partnerUid, createPeer, currentUid, flushLocalCandidates, resetLocalSession]);

  const acceptIncoming = useCallback(async () => {
    const signal = incoming;
    if (!signal || !connection?.coupleId || signal.calleeUid !== currentUid || activeCallIdRef.current) return;
    activeCallIdRef.current = signal.callId;
    roleRef.current = 'callee';
    signalReadyRef.current = false;

    void clearIncomingCallNotification(signal.callId);
    notifiedCallIdRef.current = '';

    try {
      setMessage('');
      setIncoming(null);
      setSession({ callId: signal.callId, kind: signal.kind, role: 'callee', phase: 'connecting' });
      const stream = await acquireMedia(signal.kind);
      if (activeCallIdRef.current !== signal.callId) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const turnIceServers = await loadTurnIceServers(connection.coupleId).catch((cause) => {
        console.warn('[DANDULI TURN credentials]', cause);
        return [];
      });
      const peer = createPeer(signal.callId, 'callee', turnIceServers);

      // Apply the caller's offer before adding local tracks so the browser can
      // reuse the offer's media sections instead of accidentally creating extra
      // m-lines on devices that are missing a microphone or camera.
      await peer.setRemoteDescription(signal.offer);
      stream.getTracks().forEach((track) => peer.addTrack(track, stream));
      const latest = latestSignalRef.current;
      await applyRemoteCandidates(latest?.callId === signal.callId ? latest.callerCandidates : signal.callerCandidates);
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);

      await answerCoupleCall(connection.coupleId, signal.callId, currentUid, peer.localDescription ?? answer);
      signalReadyRef.current = true;
      void flushLocalCandidates();

      void waitForIceGathering(peer).then(async () => {
        if (activeCallIdRef.current !== signal.callId) return;
        const gatheredAnswer = peer.localDescription;
        if (!gatheredAnswer) return;
        try {
          await refreshCoupleCallDescription(connection.coupleId, signal.callId, 'callee', gatheredAnswer);
          await flushLocalCandidates();
        } catch (cause) {
          console.warn('[DANDULI call answer refresh]', cause);
        }
      });
    } catch (cause) {
      console.error('[DANDULI accept call]', cause);
      void finishCoupleCall(connection.coupleId, signal.callId, 'failed', 'accept-failed');
      resetLocalSession(true);
      setMessage(callErrorMessage(cause, signal.kind));
      window.setTimeout(() => setMessage(''), 2400);
    }
  }, [acquireMedia, applyRemoteCandidates, connection?.coupleId, createPeer, currentUid, flushLocalCandidates, incoming, resetLocalSession]);

  const rejectIncoming = useCallback(() => {
    if (!incoming || !connection?.coupleId) return;
    const callId = incoming.callId;
    setIncoming(null);
    notifiedCallIdRef.current = '';
    void clearIncomingCallNotification(callId);
    void finishCoupleCall(connection.coupleId, callId, 'rejected', 'declined');
  }, [connection?.coupleId, incoming]);

  const hangUp = useCallback(() => {
    const callId = activeCallIdRef.current;
    if (callId && connection?.coupleId) {
      void finishCoupleCall(connection.coupleId, callId, 'ended', 'hangup');
    }
    resetLocalSession();
  }, [connection?.coupleId, resetLocalSession]);

  const toggleMute = useCallback(() => {
    // Keep the visual state update completely separate from the MediaStream.
    // This guarantees the icon swaps immediately even if the audio track is
    // temporarily unavailable while the call is connecting.
    setMuted((currentMuted) => !currentMuted);
  }, []);

  const toggleCamera = useCallback(() => {
    const tracks = localStreamRef.current?.getVideoTracks() ?? [];
    if (!tracks.length) return;
    const nextOff = !cameraOff;
    tracks.forEach((track) => { track.enabled = !nextOff; });
    setCameraOff(nextOff);
  }, [cameraOff]);

  const switchVoiceCallToVideo = useCallback(async () => {
    const currentSession = session;
    const coupleId = connection?.coupleId;
    const peer = peerRef.current;
    const role = roleRef.current;
    if (
      !currentSession
      || currentSession.kind !== 'voice'
      || currentSession.phase !== 'connected'
      || !coupleId
      || !peer
      || !role
      || switchingToVideo
    ) return;

    setSwitchingToVideo(true);
    setMessage('영상통화로 전환하고 있어요…');

    try {
      const track = await ensureLocalVideoTrack();
      attachVideoTrack(peer, track);

      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      await requestCoupleCallVideoUpgrade(
        coupleId,
        currentSession.callId,
        role,
        peer.localDescription ?? offer,
      );

      setSession((current) => current && current.callId === currentSession.callId
        ? { ...current, kind: 'video' }
        : current);
      setMessage('');
    } catch (cause) {
      console.error('[DANDULI call video upgrade]', cause);
      const name = callErrorName(cause);
      setSwitchingToVideo(false);
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        setMessage('영상통화로 전환하려면 카메라 권한을 허용해 주세요.');
      } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
        setMessage('사용할 수 있는 카메라를 찾지 못했어요.');
      } else {
        setMessage('영상통화로 전환하지 못했어요. 잠시 후 다시 시도해 주세요.');
      }
      window.setTimeout(() => setMessage(''), 2200);
    }
  }, [attachVideoTrack, connection?.coupleId, ensureLocalVideoTrack, session, switchingToVideo]);

  useEffect(() => {
    if (session?.phase !== 'connecting') return;
    const callId = session.callId;
    const timer = window.setTimeout(() => {
      if (activeCallIdRef.current !== callId || peerRef.current?.connectionState === 'connected') return;
      if (connection?.coupleId) {
        void finishCoupleCall(connection.coupleId, callId, 'failed', 'connection-timeout')
          .catch((cause) => console.warn('[DANDULI call timeout]', cause));
      }
      finishAndCloseLater('통화 연결 시간이 초과됐어요. 네트워크를 바꾼 뒤 다시 시도해 주세요.');
    }, CONNECT_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [session?.callId, session?.phase, connection?.coupleId, finishAndCloseLater]);

  useEffect(() => {
    if (!connectedAt) {
      setElapsedSeconds(0);
      return;
    }
    const update = () => setElapsedSeconds(Math.floor((Date.now() - connectedAt) / 1000));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [connectedAt]);

  useEffect(() => {
    const tracks = localStream?.getAudioTracks() ?? [];
    tracks.forEach((track) => { track.enabled = !muted; });
  }, [localStream, muted]);

  useEffect(() => {
    if (localVideoRef.current) localVideoRef.current.srcObject = localStream;
  }, [localStream, session?.kind, session?.phase]);

  useEffect(() => {
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = remoteStream;
  }, [remoteStream, session?.kind, session?.phase]);

  useEffect(() => {
    const root = document.documentElement;
    if (connection?.coupleId) {
      root.dataset.routeCallMonitor = '1';
      if (isNativePlatform()) void prepareIncomingCallNotifications();
    } else {
      delete root.dataset.routeCallMonitor;
    }

    return () => {
      delete root.dataset.routeCallMonitor;
    };
  }, [connection?.coupleId]);

  useEffect(() => {
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<{ kind?: CoupleCallKind }>).detail;
      if (detail?.kind !== 'voice' && detail?.kind !== 'video') return;
      void startOutgoingCall(detail.kind);
    };
    window.addEventListener(CALL_REQUEST_EVENT, listener);
    return () => window.removeEventListener(CALL_REQUEST_EVENT, listener);
  }, [startOutgoingCall]);

  useEffect(() => {
    const coupleId = connection?.coupleId;
    if (!coupleId) {
      latestSignalRef.current = null;
      resetLocalSession();
      return;
    }

    return subscribeCoupleCall(coupleId, (signal) => {
      latestSignalRef.current = signal;
      if (!signal) {
        if (!activeCallIdRef.current) setIncoming(null);
        return;
      }

      const activeCallId = activeCallIdRef.current;
      if (!activeCallId) {
        if (signal.status === 'ringing' && signal.calleeUid === currentUid) {
          setIncoming(signal);
          if (notifiedCallIdRef.current !== signal.callId) {
            notifiedCallIdRef.current = signal.callId;
            void showIncomingCallNotification(signal.callId, partnerName, signal.kind);
            onIncomingCall?.(signal.kind);
          }
        } else {
          if (notifiedCallIdRef.current) {
            void clearIncomingCallNotification(notifiedCallIdRef.current);
            notifiedCallIdRef.current = '';
          }
          setIncoming(null);
        }
        return;
      }

      if (signal.callId !== activeCallId) return;
      if (signal.status === 'rejected' || signal.status === 'ended' || signal.status === 'failed') {
        if (notifiedCallIdRef.current === signal.callId) {
          void clearIncomingCallNotification(signal.callId);
          notifiedCallIdRef.current = '';
        }
        finishAndCloseLater(endMessage(signal));
        return;
      }

      const role = roleRef.current;
      const peer = peerRef.current;
      if (!role || !peer) return;

      void signalQueueRef.current(async () => {
        if (peerRef.current !== peer || activeCallIdRef.current !== signal.callId) return;
        if (role === 'caller' && signal.answer?.sdp && !peer.remoteDescription) {
          await peer.setRemoteDescription(signal.answer);
        }

        const upgrade = signal.upgrade;
        const actionableUpgrade = upgrade
          && upgrade.version > handledUpgradeVersionRef.current
          && processingUpgradeVersionRef.current !== upgrade.version
          && (
            (upgrade.requestedBy !== role && !upgrade.answer)
            || (upgrade.requestedBy === role && Boolean(upgrade.answer))
          );

        if (actionableUpgrade && upgrade) {
          processingUpgradeVersionRef.current = upgrade.version;
          try {
            if (upgrade.requestedBy !== role && !upgrade.answer) {
              setSwitchingToVideo(true);
              setMessage('영상통화로 전환하고 있어요…');
              await peer.setRemoteDescription(upgrade.offer);

              try {
                const track = await ensureLocalVideoTrack();
                attachVideoTrack(peer, track);
              } catch (cameraCause) {
                console.warn('[DANDULI call upgrade camera unavailable]', cameraCause);
                setCameraOff(true);
              }

              const answer = await peer.createAnswer();
              await peer.setLocalDescription(answer);
              await answerCoupleCallVideoUpgrade(
                coupleId,
                signal.callId,
                role,
                upgrade.version,
                peer.localDescription ?? answer,
              );

              handledUpgradeVersionRef.current = upgrade.version;
              setSession((current) => current && current.callId === signal.callId
                ? { ...current, kind: 'video' }
                : current);
              setSwitchingToVideo(false);
              setMessage('');
            } else if (upgrade.requestedBy === role && upgrade.answer) {
              await peer.setRemoteDescription(upgrade.answer);
              handledUpgradeVersionRef.current = upgrade.version;
              setSession((current) => current && current.callId === signal.callId
                ? { ...current, kind: 'video' }
                : current);
              setSwitchingToVideo(false);
              setMessage('');
            }
          } finally {
            if (processingUpgradeVersionRef.current === upgrade.version) {
              processingUpgradeVersionRef.current = 0;
            }
          }
        }

        await applyRemoteCandidates(remoteCandidateList(signal, role));
        if (peerRef.current !== peer || activeCallIdRef.current !== signal.callId) return;
        if (signal.status === 'active') {
          setSession((current) => current && current.callId === signal.callId && current.phase !== 'connected' && current.phase !== 'ended'
            ? { ...current, phase: 'connecting' }
            : current);
        }
      }).catch((cause) => {
        processingUpgradeVersionRef.current = 0;
        setSwitchingToVideo(false);
        console.warn('[DANDULI call signal apply]', cause);
      });
    }, (cause) => {
      console.warn('[DANDULI call subscription]', cause);
      setMessage('통화 신호를 불러오지 못했어요.');
    });
  }, [applyRemoteCandidates, attachVideoTrack, connection?.coupleId, currentUid, ensureLocalVideoTrack, finishAndCloseLater, onIncomingCall, partnerName, resetLocalSession]);

  useEffect(() => () => {
    if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
    if (disconnectTimerRef.current) window.clearTimeout(disconnectTimerRef.current);
    if (notifiedCallIdRef.current) void clearIncomingCallNotification(notifiedCallIdRef.current);
    peerRef.current?.close();
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    remoteStreamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  const partnerInitial = partnerName.trim().slice(0, 1) || '상';
  const showVideo = session?.kind === 'video';

  return <>
    {message && !session && !incoming && <div className="danduli-call-toast" role="status">{message}</div>}

    {incoming && <div className="danduli-call-layer incoming" role="dialog" aria-modal="true" aria-label="수신 통화">
      <div className="danduli-call-voice-card">
        <div className="danduli-call-avatar">{partnerInitial}</div>
        <small>{incoming.kind === 'video' ? '영상통화가 왔어요' : '전화가 왔어요'}</small>
        <h2>{partnerName}</h2>
        <p>단둘이 통화</p>
        <div className="danduli-call-incoming-actions">
          <button type="button" className="reject" onClick={rejectIncoming} aria-label="거절"><PhoneOff /></button>
          <button type="button" className="accept" onClick={() => void acceptIncoming()} aria-label="통화 받기">{incoming.kind === 'video' ? <Video /> : <PhoneCall />}</button>
        </div>
        <div className="danduli-call-action-labels"><span>거절</span><span>받기</span></div>
      </div>
    </div>}

    {session && <div className={`danduli-call-layer ${showVideo ? 'video-call' : 'voice-call'}`} role="dialog" aria-modal="true" aria-label={showVideo ? '영상통화' : '음성 통화'}>
      {showVideo && <>
        <video ref={remoteVideoRef} className="danduli-call-remote-video" autoPlay playsInline />
        <video ref={localVideoRef} className={`danduli-call-local-video ${cameraOff ? 'camera-off' : ''}`} autoPlay muted playsInline />
      </>}
      {!showVideo && <video ref={remoteVideoRef} className="danduli-call-audio-sink" autoPlay playsInline />}

      <div className="danduli-call-top">
        <small>{session.phase === 'calling' ? '전화 거는 중…' : session.phase === 'connecting' ? '연결 중…' : session.phase === 'connected' ? formatDuration(elapsedSeconds) : message || '통화 종료'}</small>
        <strong>{partnerName}</strong>
      </div>

      {!showVideo && <div className="danduli-call-voice-center">
        <div className="danduli-call-avatar large">{partnerInitial}</div>
        <h2>{partnerName}</h2>
        <p>{message || (session.phase === 'connected' ? formatDuration(elapsedSeconds) : session.phase === 'calling' ? '응답을 기다리고 있어요' : '연결하고 있어요')}</p>
      </div>}

      {showVideo && (session.phase !== 'connected' || switchingToVideo) && <div className="danduli-call-video-status">{switchingToVideo ? '영상통화로 전환하고 있어요…' : message || (session.phase === 'calling' ? '응답을 기다리고 있어요' : '영상통화를 연결하고 있어요')}</div>}

      <div className="danduli-call-controls">
        {muted ? (
          <button key="muted" type="button" className="muted" onClick={toggleMute} aria-label="음소거 해제" aria-pressed="true">
            <MicOff />
            <span>음소거</span>
          </button>
        ) : (
          <button key="unmuted" type="button" onClick={toggleMute} aria-label="음소거" aria-pressed="false">
            <Mic />
            <span>음소거</span>
          </button>
        )}
        {!showVideo && <button type="button" className="video-upgrade" onClick={() => void switchVoiceCallToVideo()} disabled={session.phase !== 'connected' || switchingToVideo} aria-label="영상통화로 전환"><Video /><span>{switchingToVideo ? '전환 중' : '영상 전환'}</span></button>}
        {showVideo && <button type="button" className={cameraOff ? 'active' : ''} onClick={toggleCamera} aria-label={cameraOff ? '카메라 켜기' : '카메라 끄기'}>{cameraOff ? <VideoOff /> : <Video />}<span>{cameraOff ? '카메라 켜기' : '카메라'}</span></button>}
        <button type="button" className="hangup" onClick={hangUp} aria-label="통화 종료"><PhoneOff /><span>종료</span></button>
      </div>
    </div>}
  </>;
}
