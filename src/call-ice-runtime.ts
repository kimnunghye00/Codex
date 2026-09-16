type ViteEnvLike = Record<string, string | boolean | undefined>;

const nativePeerConnection = window.RTCPeerConnection;

function normalizeServer(server: RTCIceServer): RTCIceServer | null {
  const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
  const cleanUrls = urls.filter((url): url is string => typeof url === 'string' && url.trim().length > 0);
  if (!cleanUrls.length) return null;

  const isLegacyOpenRelaySample = cleanUrls.some((url) => url.includes('openrelay.metered.ca'))
    && server.username === 'openrelayproject'
    && server.credential === 'openrelayproject';
  if (isLegacyOpenRelaySample) return null;

  return {
    ...server,
    urls: Array.isArray(server.urls) ? cleanUrls : cleanUrls[0],
  };
}

function parseConfiguredIceServers(): RTCIceServer[] {
  const env = import.meta.env as unknown as ViteEnvLike;
  const raw = typeof env.VITE_DANDULI_ICE_SERVERS_JSON === 'string'
    ? env.VITE_DANDULI_ICE_SERVERS_JSON.trim()
    : '';
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is RTCIceServer => Boolean(item) && typeof item === 'object' && 'urls' in item)
      .map(normalizeServer)
      .filter((item): item is RTCIceServer => Boolean(item));
  } catch (error) {
    console.warn('[DANDULI ICE config] invalid VITE_DANDULI_ICE_SERVERS_JSON', error);
    return [];
  }
}

const stableStunServers: RTCIceServer[] = [
  { urls: 'stun:stun.cloudflare.com:3478' },
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
];

function serverKey(server: RTCIceServer) {
  const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
  return `${urls.join('|')}|${server.username ?? ''}`;
}

function hardenedIceServers(existing: RTCIceServer[] | undefined) {
  const configured = parseConfiguredIceServers();
  const cleanedExisting = (existing ?? [])
    .map(normalizeServer)
    .filter((item): item is RTCIceServer => Boolean(item));

  const deduped = new Map<string, RTCIceServer>();
  [...configured, ...cleanedExisting, ...stableStunServers].forEach((server) => {
    deduped.set(serverKey(server), server);
  });
  return [...deduped.values()];
}

function candidateType(candidate: string) {
  const match = candidate.match(/\btyp\s+(host|srflx|prflx|relay)\b/i);
  return match?.[1]?.toLowerCase() ?? 'unknown';
}

function exposePeerState(peer: RTCPeerConnection) {
  const root = document.documentElement;
  const updateState = () => {
    root.dataset.danduliPeerConnection = peer.connectionState;
    root.dataset.danduliIceConnection = peer.iceConnectionState;
    root.dataset.danduliIceGathering = peer.iceGatheringState;
    root.dataset.danduliSignaling = peer.signalingState;
  };

  updateState();
  peer.addEventListener('connectionstatechange', updateState);
  peer.addEventListener('iceconnectionstatechange', updateState);
  peer.addEventListener('icegatheringstatechange', updateState);
  peer.addEventListener('signalingstatechange', updateState);

  peer.addEventListener('icecandidate', (event) => {
    if (!event.candidate?.candidate) return;
    const type = candidateType(event.candidate.candidate);
    root.dataset.danduliLastLocalCandidate = type;
    if (type === 'relay') root.dataset.danduliRelayCandidate = '1';
  });

  peer.addEventListener('icecandidateerror', (event) => {
    const errorEvent = event as RTCPeerConnectionIceErrorEvent;
    root.dataset.danduliIceError = String(errorEvent.errorCode || 'unknown');
    console.warn('[DANDULI ICE candidate error]', {
      code: errorEvent.errorCode,
      text: errorEvent.errorText,
      url: errorEvent.url,
    });
  });

  // Keep a lightweight selected-route diagnostic. It contains no IP address,
  // SDP, credential, or user data and is useful when reproducing LTE/Wi-Fi failures.
  const inspectSelectedRoute = async () => {
    if (peer.connectionState !== 'connected') return;
    try {
      const stats = await peer.getStats();
      stats.forEach((report) => {
        if (report.type !== 'candidate-pair' || report.state !== 'succeeded' || !report.nominated) return;
        const local = stats.get(report.localCandidateId);
        const remote = stats.get(report.remoteCandidateId);
        if (local?.candidateType) root.dataset.danduliSelectedLocalCandidate = String(local.candidateType);
        if (remote?.candidateType) root.dataset.danduliSelectedRemoteCandidate = String(remote.candidateType);
        if (local?.candidateType === 'relay' || remote?.candidateType === 'relay') {
          root.dataset.danduliRelaySelected = '1';
        } else {
          delete root.dataset.danduliRelaySelected;
        }
      });
    } catch (error) {
      console.warn('[DANDULI ICE route stats]', error);
    }
  };

  peer.addEventListener('connectionstatechange', () => {
    if (peer.connectionState === 'connected') void inspectSelectedRoute();
  });
}

if (typeof nativePeerConnection === 'function') {
  const DanduliPeerConnection = function (
    this: RTCPeerConnection,
    configuration?: RTCConfiguration,
  ) {
    const nextConfiguration: RTCConfiguration = {
      ...(configuration ?? {}),
      iceServers: hardenedIceServers(configuration?.iceServers),
      iceCandidatePoolSize: Math.max(configuration?.iceCandidatePoolSize ?? 0, 8),
      iceTransportPolicy: configuration?.iceTransportPolicy ?? 'all',
    };
    const peer = new nativePeerConnection(nextConfiguration);
    exposePeerState(peer);
    return peer;
  } as unknown as typeof RTCPeerConnection;

  DanduliPeerConnection.prototype = nativePeerConnection.prototype;
  Object.setPrototypeOf(DanduliPeerConnection, nativePeerConnection);
  window.RTCPeerConnection = DanduliPeerConnection;

  const configuredTurn = parseConfiguredIceServers().some((server) => {
    const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
    return urls.some((url) => url.startsWith('turn:') || url.startsWith('turns:'));
  });
  document.documentElement.dataset.danduliTurnReady = configuredTurn ? '1' : '0';
  document.documentElement.dataset.danduliIceRuntime = '2';
}
