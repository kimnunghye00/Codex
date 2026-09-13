import { Mic, MicOff, PhoneCall, PhoneOff, Video, VideoOff } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { RealCoupleConnection } from '../../lib/coupleConnection';
import { clearIncomingCallNotification, prepareIncomingCallNotifications, showIncomingCallNotification } from '../../lib/callNotifications';
import { isNativePlatform } from '../../lib/native';
import {
  answerCoupleCall,
  appendCoupleCallCandidate,
  finishCoupleCall,
  startCoupleCall,
  subscribeCoupleCall,
  type CoupleCallKind,
  type CoupleCallSignal,
  type StoredIceCandidate,
} from '../../lib/coupleCall';
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
  // Shared OpenRelay fallback for development/testing. Production should move
  // to a dedicated TURN credential, but this gives mobile/LTE and strict NAT
  // networks a relay path instead of relying on STUN-only direct connectivity.
  { urls: 'stun:openrelay.metered.ca:80' },
  { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
];
const DISCONNECT_GRACE_MS = 8_000;

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
  const [connectedAt, setConnectedAt] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);

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
    disconnectTimerRef.current = undefined;
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
    const pending = pendingLocalCandidatesRef.current.splice(0);
    for (const candidate of pending) {
      try {
        await appendCoupleCallCandidate(coupleId, callId, role, candidate);
      } catch (cause) {
        console.warn('[DANDULI call local candidate]', cause);
      }
    }
  }, [connection?.coupleId]);

  const createPeer = useCallback((callId: string, role: CallRole) => {
    peerRef.current?.close();
    if (typeof RTCPeerConnection === 'undefined') throw new Error('webrtc-not-supported');
    const peer = new RTCPeerConnection({
      iceServers: ICE_SERVERS,
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
      if (!signalReadyRef.current) {
        pendingLocalCandidatesRef.current.push(event.candidate);
        return;
      }
      const coupleId = connection?.coupleId;
      if (!coupleId) return;
      void appendCoupleCallCandidate(coupleId, callId, role, event.candidate).catch((cause) => {
        console.warn('[DANDULI call ICE publish]', cause);
      });
    };

    peer.onconnectionstatechange = () => {
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
  }, [connection?.coupleId, finishAndCloseLater]);

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
    try {
      setMessage('');
      setIncoming(null);
      setSession({ callId, kind, role: 'caller', phase: 'calling' });
      const stream = await acquireMedia(kind);
      const peer = createPeer(callId, 'caller');
      stream.getTracks().forEach((track) => peer.addTrack(track, stream));
      if (!stream.getAudioTracks().length) peer.addTransceiver('audio', { direction: 'recvonly' });
      if (kind === 'video' && !stream.getVideoTracks().length) peer.addTransceiver('video', { direction: 'recvonly' });

      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);

      // Do not publish the offer until ICE gathering has had a chance to put
      // host/STUN/TURN candidates directly into the SDP. The previous version
      // published immediately and depended entirely on many Firestore candidate
      // writes; if even a few of those raced or were delayed, both phones could
      // ring successfully but the actual media path still failed.
      await waitForIceGathering(peer);
      const gatheredOffer = peer.localDescription ?? offer;
      await startCoupleCall(connection.coupleId, callId, currentUid, connection.partnerUid, kind, gatheredOffer);
      signalReadyRef.current = true;
      await flushLocalCandidates();
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
    if (!signal || !connection?.coupleId || signal.calleeUid !== currentUid) return;

    void clearIncomingCallNotification(signal.callId);
    notifiedCallIdRef.current = '';

    try {
      setMessage('');
      setIncoming(null);
      setSession({ callId: signal.callId, kind: signal.kind, role: 'callee', phase: 'connecting' });
      const stream = await acquireMedia(signal.kind);
      const peer = createPeer(signal.callId, 'callee');
      signalReadyRef.current = true;

      // Apply the caller's offer before adding local tracks so the browser can
      // reuse the offer's media sections instead of accidentally creating extra
      // m-lines on devices that are missing a microphone or camera.
      await peer.setRemoteDescription(signal.offer);
      stream.getTracks().forEach((track) => peer.addTrack(track, stream));
      await applyRemoteCandidates(signal.callerCandidates);
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);

      // As with the caller, wait briefly so the answer SDP already contains
      // usable ICE candidates. This makes call setup deterministic even when
      // trickle-candidate writes are delayed on mobile networks.
      await waitForIceGathering(peer);
      const gatheredAnswer = peer.localDescription ?? answer;
      await answerCoupleCall(connection.coupleId, signal.callId, currentUid, gatheredAnswer);
      await flushLocalCandidates();
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
    const tracks = localStreamRef.current?.getAudioTracks() ?? [];
    if (!tracks.length) return;
    const nextMuted = !muted;
    tracks.forEach((track) => { track.enabled = !nextMuted; });
    setMuted(nextMuted);
  }, [muted]);

  const toggleCamera = useCallback(() => {
    const tracks = localStreamRef.current?.getVideoTracks() ?? [];
    if (!tracks.length) return;
    const nextOff = !cameraOff;
    tracks.forEach((track) => { track.enabled = !nextOff; });
    setCameraOff(nextOff);
  }, [cameraOff]);

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

      void (async () => {
        if (role === 'caller' && signal.answer?.sdp && !peer.remoteDescription) {
          await peer.setRemoteDescription(signal.answer);
        }
        await applyRemoteCandidates(remoteCandidateList(signal, role));
        if (signal.status === 'active') {
          setSession((current) => current && current.callId === signal.callId && current.phase !== 'connected'
            ? { ...current, phase: 'connecting' }
            : current);
        }
      })().catch((cause) => {
        console.warn('[DANDULI call signal apply]', cause);
      });
    }, (cause) => {
      console.warn('[DANDULI call subscription]', cause);
      setMessage('통화 신호를 불러오지 못했어요.');
    });
  }, [applyRemoteCandidates, connection?.coupleId, currentUid, finishAndCloseLater, onIncomingCall, partnerName, resetLocalSession]);

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

      {showVideo && session.phase !== 'connected' && <div className="danduli-call-video-status">{message || (session.phase === 'calling' ? '응답을 기다리고 있어요' : '영상통화를 연결하고 있어요')}</div>}

      <div className="danduli-call-controls">
        <button type="button" className={muted ? 'active' : ''} onClick={toggleMute} aria-label={muted ? '마이크 켜기' : '마이크 끄기'}>{muted ? <MicOff /> : <Mic />}<span>{muted ? '음소거 해제' : '음소거'}</span></button>
        {showVideo && <button type="button" className={cameraOff ? 'active' : ''} onClick={toggleCamera} aria-label={cameraOff ? '카메라 켜기' : '카메라 끄기'}>{cameraOff ? <VideoOff /> : <Video />}<span>{cameraOff ? '카메라 켜기' : '카메라'}</span></button>}
        <button type="button" className="hangup" onClick={hangUp} aria-label="통화 종료"><PhoneOff /><span>종료</span></button>
      </div>
    </div>}
  </>;
}
