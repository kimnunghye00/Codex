const MAX_UINT32 = 0x1_0000_0000;
const MAX_HIGH_21_BITS = 0x1f_ffff;
let fallbackSequence = 0;

export function messageIdFromRandomWords(highWord: number, lowWord: number) {
  const high = (highWord >>> 0) & MAX_HIGH_21_BITS;
  const low = lowWord >>> 0;
  const value = high * MAX_UINT32 + low;
  return value === 0 ? 1 : value;
}

export function createMessageId() {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.getRandomValues) {
    const words = new Uint32Array(2);
    cryptoApi.getRandomValues(words);
    return messageIdFromRandomWords(words[0], words[1]);
  }

  // Modern browsers and Capacitor WebViews provide crypto.getRandomValues.
  // This fallback preserves safe-integer semantics for unusual test/webview
  // environments while avoiding duplicate ids within one running process.
  fallbackSequence = (fallbackSequence + 1) % 1000;
  return (Date.now() % 8_000_000_000_000) * 1000 + fallbackSequence;
}
