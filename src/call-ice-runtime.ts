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

if (typeof nativePeerConnection === 'function') {
  const DanduliPeerConnection = function (
    this: RTCPeerConnection,
    configuration?: RTCConfiguration,
  ) {
    const nextConfiguration: RTCConfiguration = {
      ...(configuration ?? {}),
      iceServers: hardenedIceServers(configuration?.iceServers),
    };
    return new nativePeerConnection(nextConfiguration);
  } as unknown as typeof RTCPeerConnection;

  DanduliPeerConnection.prototype = nativePeerConnection.prototype;
  Object.setPrototypeOf(DanduliPeerConnection, nativePeerConnection);
  window.RTCPeerConnection = DanduliPeerConnection;

  const configuredTurn = parseConfiguredIceServers().some((server) => {
    const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
    return urls.some((url) => url.startsWith('turn:') || url.startsWith('turns:'));
  });
  document.documentElement.dataset.danduliTurnReady = configuredTurn ? '1' : '0';
}
