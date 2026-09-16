import { auth } from './firebaseAuth';

let cached: { iceServers: RTCIceServer[]; expiresAt: number } | null = null;
let inflight: Promise<RTCIceServer[]> | null = null;

function validIceServers(value: unknown): RTCIceServer[] {
  if (!Array.isArray(value)) return [];
  return value.filter((server): server is RTCIceServer => {
    if (!server || typeof server !== 'object' || !('urls' in server)) return false;
    const rawUrls = (server as { urls?: unknown }).urls;
    const urls: unknown[] = Array.isArray(rawUrls) ? rawUrls : [rawUrls];
    return urls.length > 0 && urls.every((url) => typeof url === 'string' && /^(stun|turn|turns):/.test(url));
  });
}

export async function loadTurnIceServers(coupleId: string): Promise<RTCIceServer[]> {
  if (cached && cached.expiresAt > Date.now() + 5 * 60_000) return cached.iceServers;
  if (inflight) return inflight;

  inflight = (async () => {
    const user = auth.currentUser;
    if (!user || !coupleId) return [];
    const token = await user.getIdToken();
    const response = await fetch('/api/turn-credentials', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ coupleId }),
    });
    if (!response.ok) throw new Error(`turn-credentials-${response.status}`);
    const payload = await response.json() as { iceServers?: unknown; expiresIn?: unknown };
    const iceServers = validIceServers(payload.iceServers);
    if (!iceServers.some((server) => {
      const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
      return urls.some((url) => url.startsWith('turn:') || url.startsWith('turns:'));
    })) throw new Error('turn-credentials-invalid');

    const expiresIn = Math.max(600, Math.min(3600, Number(payload.expiresIn) || 3600));
    cached = { iceServers, expiresAt: Date.now() + expiresIn * 1000 };
    document.documentElement.dataset.danduliTurnReady = '1';
    return iceServers;
  })().finally(() => { inflight = null; });

  return inflight;
}
