/** Native lifecycle retries must be bounded to avoid a tight loop when
 * Firestore or a WebView plugin temporarily fails. */
export function nativeNetworkRetryDelay(failures: number): number | null {
  return Number.isInteger(failures) && failures >= 1 && failures <= 3
    ? 1000 * 2 ** (failures - 1)
    : null;
}

/** Some Samsung/Android IMEs report keyCode 229 during composition even
 * when the browser's isComposing flag has already changed. */
export function shouldSendChatOnEnter(input: {
  key: string;
  shiftKey: boolean;
  composing: boolean;
  isComposing: boolean;
  keyCode: number;
}): boolean {
  return input.key === 'Enter' && !input.shiftKey && !input.composing
    && !input.isComposing && input.keyCode !== 229;
}
