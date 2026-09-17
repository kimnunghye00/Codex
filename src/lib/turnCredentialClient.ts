type TurnUser = { uid: string; getIdToken: () => Promise<string> };
type TurnClientOptions = {
  getUser: () => TurnUser | null;
  fetcher?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
};

// Keep only valid WebRTC fields so a malformed entry cannot break the peer.
export function validTurnIceServers(value: unknown): RTCIceServer[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 16).flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const urls: unknown[] = Array.isArray(entry.urls) ? entry.urls : [entry.urls];
    if (!urls.length || urls.length > 8 || !urls.every((url) =>
      typeof url === 'string' && /^(stun|stuns|turn|turns):[^\s]+$/.test(url))) return [];
    const hasTurn = urls.some((url) => /^turns?:/.test(String(url)));
    if (hasTurn && (typeof entry.username !== 'string' || !entry.username
      || typeof entry.credential !== 'string' || !entry.credential)) return [];
    return [{ urls: urls as string[], ...(hasTurn
      ? { username: entry.username as string, credential: entry.credential as string }
      : {}) }];
  });
}

export function createTurnCredentialClient({ getUser, fetcher = fetch, now = Date.now, timeoutMs = 12_000 }: TurnClientOptions) {
  let cached: { key: string; iceServers: RTCIceServer[]; expiresAt: number } | null = null;
  let inflight: { key: string; controller: AbortController; promise: Promise<RTCIceServer[]> } | null = null;

  function clear() {
    cached = null;
    inflight?.controller.abort();
    inflight = null;
  }

  function load(coupleId: string, endpoint: string): Promise<RTCIceServer[]> {
    const user = getUser();
    // Never request the SPA index as JSON when no backend has been configured.
    if (!user || !coupleId || !endpoint) {
      clear();
      return Promise.resolve([]);
    }
    const key = JSON.stringify([user.uid, coupleId, endpoint]);
    if (cached?.key === key && cached.expiresAt > now() + 300_000) return Promise.resolve(cached.iceServers);
    if (inflight?.key === key) return inflight.promise;
    clear();

    const controller = new AbortController();
    const startedAt = now();
    let timer: ReturnType<typeof setTimeout>;
    let rejectOnAbort: () => void;
    const aborted = new Promise<never>((_, reject) => {
      rejectOnAbort = () => reject(new Error('turn-credentials-cancelled'));
      controller.signal.addEventListener('abort', rejectOnAbort, { once: true });
      timer = setTimeout(() => {
        reject(new Error('turn-credentials-timeout'));
        controller.abort();
      }, timeoutMs);
    });
    const ensureCurrent = () => {
      if (controller.signal.aborted || getUser()?.uid !== user.uid) throw new Error('turn-credentials-cancelled');
    };
    const request = (async () => {
      const token = await user.getIdToken();
      ensureCurrent();
      const response = await fetcher(endpoint, {
        method: 'POST', credentials: 'omit', cache: 'no-store', redirect: 'error',
        signal: controller.signal,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ coupleId }),
      });
      if (!response.ok) throw new Error(`turn-credentials-${response.status}`);
      const payload = await response.json() as { iceServers?: unknown; expiresIn?: unknown };
      ensureCurrent();
      const iceServers = validTurnIceServers(payload?.iceServers);
      if (!iceServers.some((server) => (server.urls as string[]).some((url) => /^turns?:/.test(url)))) {
        throw new Error('turn-credentials-invalid');
      }
      const ttl = payload?.expiresIn;
      if (typeof ttl !== 'number' || !Number.isFinite(ttl) || ttl <= 0) throw new Error('turn-credentials-invalid-ttl');
      // Count from request start and never extend the provider's lifetime.
      const expiresAt = startedAt + Math.min(3600, ttl) * 1000;
      if (expiresAt <= now()) throw new Error('turn-credentials-expired');
      cached = { key, iceServers, expiresAt };
      return iceServers;
    })();
    const promise = Promise.race([request, aborted]).finally(() => {
      clearTimeout(timer!);
      controller.signal.removeEventListener('abort', rejectOnAbort!);
      if (inflight?.controller === controller) inflight = null;
    });
    inflight = { key, controller, promise };
    return promise;
  }

  return { load, clear };
}
