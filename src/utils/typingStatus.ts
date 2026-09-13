const TYPING_TTL_MS = 8_000;

export function typingTimeRemaining(data: { typing?: unknown; updatedAt?: unknown } | undefined, now = Date.now()) {
  if (data?.typing !== true || typeof data.updatedAt !== 'number' || !Number.isFinite(data.updatedAt)) return 0;
  // Bound clock skew too: a future timestamp must not leave the indicator on indefinitely.
  return Math.max(0, Math.min(TYPING_TTL_MS, data.updatedAt + TYPING_TTL_MS - now));
}
