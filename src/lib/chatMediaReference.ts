const ORIGINAL_MARKER = '#route-original=';

export function createChatMediaReference(previewUrl: string, originalUrl: string) {
  if (!originalUrl || originalUrl === previewUrl) return previewUrl;
  return `${previewUrl}${ORIGINAL_MARKER}${encodeURIComponent(originalUrl)}`;
}

export function hasOptimizedChatPreview(reference: string) {
  return reference.includes(ORIGINAL_MARKER);
}

export function chatMediaPreviewUrl(reference: string) {
  const markerIndex = reference.indexOf(ORIGINAL_MARKER);
  return markerIndex >= 0 ? reference.slice(0, markerIndex) : reference;
}

export function chatMediaOriginalUrl(reference: string) {
  const markerIndex = reference.indexOf(ORIGINAL_MARKER);
  if (markerIndex < 0) return reference;
  const encoded = reference.slice(markerIndex + ORIGINAL_MARKER.length);
  try {
    return decodeURIComponent(encoded) || chatMediaPreviewUrl(reference);
  } catch {
    return chatMediaPreviewUrl(reference);
  }
}

function extensionForMime(mime: string) {
  if (mime.includes('png')) return 'png';
  if (mime.includes('webp')) return 'webp';
  if (mime.includes('gif')) return 'gif';
  if (mime.includes('heic') || mime.includes('heif')) return 'heic';
  return 'jpg';
}

export async function downloadOriginalChatMedia(reference: string, index = 1) {
  const url = chatMediaOriginalUrl(reference);
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`download-${response.status}`);
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = `ROUTE-photo-${Date.now()}-${index}.${extensionForMime(blob.type)}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  } catch {
    const link = document.createElement('a');
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    document.body.appendChild(link);
    link.click();
    link.remove();
  }
}
