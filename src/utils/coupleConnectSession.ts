export type CoupleConnectSession = {
  mode: 'invite' | 'waiting';
  code: string;
  savedAt: number;
};

const SESSION_TTL = 7 * 24 * 60 * 60 * 1000;
const CODE_PATTERN = /^ROUTE-[A-Z2-9]{6}$/;

export function coupleConnectSessionKey(uid: string) {
  return `route.coupleConnect.pending:${uid}`;
}

export function serializeCoupleConnectSession(session: CoupleConnectSession) {
  return JSON.stringify(session);
}

export function parseCoupleConnectSession(raw: string | null, now = Date.now()): CoupleConnectSession | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<CoupleConnectSession>;
    if (parsed.mode !== 'invite' && parsed.mode !== 'waiting') return null;
    const code = String(parsed.code ?? '').trim().toUpperCase();
    const savedAt = Number(parsed.savedAt ?? 0);
    if (!CODE_PATTERN.test(code) || !Number.isFinite(savedAt) || savedAt <= 0) return null;
    if (now - savedAt > SESSION_TTL) return null;
    return { mode: parsed.mode, code, savedAt };
  } catch {
    return null;
  }
}
