import { Capacitor, registerPlugin } from '@capacitor/core';

const ORIGINAL_MARKER = '#route-original=';

type RouteMediaSaverPlugin = {
  saveImage(options: { url: string; fileName: string }): Promise<{ saved: boolean; uri?: string }>;
};

const RouteMediaSaver = registerPlugin<RouteMediaSaverPlugin>('RouteMediaSaver');

export function createChatMediaReference(previewUrl: string, originalUrl: string) {
  if (!originalUrl || originalUrl === previewUrl) return previewUrl;
  return `${previewUrl}${ORIGINAL_MARKER}${encodeURIComponent(originalUrl)}`;
}

export function hasOptimizedChatPreview(reference: string) {
  // Old ROUTE messages already point at durable Firebase/HTTPS image URLs.
  // Treat those as directly renderable instead of blocking the UI behind a
  // background preview migration that can fail in Android WebView because of
  // CORS/cache restrictions. New messages still use the explicit preview marker.
  return reference.includes(ORIGINAL_MARKER) || /^https?:\/\//i.test(reference);
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

function fileNameFor(index: number, extension = 'jpg') {
  return `ROUTE-photo-${Date.now()}-${index}.${extension}`;
}

export async function downloadOriginalChatMedia(reference: string, index = 1) {
  const url = chatMediaOriginalUrl(reference);

  if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android') {
    await RouteMediaSaver.saveImage({ url, fileName: fileNameFor(index) });
    return;
  }

  const response = await fetch(url);
  if (!response.ok) throw new Error(`download-${response.status}`);
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = fileNameFor(index, extensionForMime(blob.type));
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}
