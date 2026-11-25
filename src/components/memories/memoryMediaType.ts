export function isMemoryVideo(src?: string) {
  if (!src) return false;
  if (src.startsWith('data:video/')) return true;
  let normalized = src.split('#')[0];
  try { normalized = decodeURIComponent(normalized); } catch { /* Use the original URL when percent encoding is invalid. */ }
  return /\.(mp4|webm|mov)(\?|$)/i.test(normalized);
}

