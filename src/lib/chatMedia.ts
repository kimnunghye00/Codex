import { deleteObject, getDownloadURL, ref, uploadBytes, uploadString } from 'firebase/storage';
import { storage } from './firebaseStorage';
import { getPendingOriginalChatFile } from './chatMediaOriginalRegistry';
import { createChatMediaReference, hasOptimizedChatPreview } from './chatMediaReference';

export type UploadedChatMedia = {
  urls: string[];
  paths: string[];
};

type UploadChatMediaOptions = {
  startIndex?: number;
  onUploaded?: (completedInBatch: number) => void;
};

const PREVIEW_MAX_EDGE = 640;
const PREVIEW_WEBP_QUALITY = 0.32;
const PREVIEW_JPEG_FALLBACK_QUALITY = 0.36;

function dataUrlMime(dataUrl: string) {
  return /^data:([^;,]+)[;,]/.exec(dataUrl)?.[1] || 'image/jpeg';
}

function extensionForMime(mime: string) {
  if (mime === 'image/gif') return 'gif';
  if (mime === 'image/png') return 'png';
  if (mime === 'image/webp') return 'webp';
  if (mime === 'image/heic' || mime === 'image/heif') return 'heic';
  return 'jpg';
}

function yieldToBrowser() {
  return new Promise<void>((resolve) => window.setTimeout(resolve, 0));
}

async function sourceToBlob(source: string | Blob) {
  if (source instanceof Blob) return source;
  const response = await fetch(source);
  if (!response.ok) throw new Error(`preview-source-${response.status}`);
  return response.blob();
}

async function decodeImage(blob: Blob): Promise<{
  source: CanvasImageSource;
  width: number;
  height: number;
  release: () => void;
}> {
  if ('createImageBitmap' in window) {
    try {
      const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        release: () => bitmap.close(),
      };
    } catch {}
  }

  const objectUrl = URL.createObjectURL(blob);
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = objectUrl;
  }).catch((error) => {
    URL.revokeObjectURL(objectUrl);
    throw error;
  });

  return {
    source: image,
    width: image.naturalWidth || image.width,
    height: image.naturalHeight || image.height,
    release: () => URL.revokeObjectURL(objectUrl),
  };
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
}

async function createCompactPreview(source: string | Blob) {
  const blob = await sourceToBlob(source);
  const decoded = await decodeImage(blob);
  try {
    const scale = Math.min(1, PREVIEW_MAX_EDGE / Math.max(decoded.width, decoded.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(decoded.width * scale));
    canvas.height = Math.max(1, Math.round(decoded.height * scale));
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('preview-canvas-unavailable');
    context.drawImage(decoded.source, 0, 0, canvas.width, canvas.height);

    const webp = await canvasToBlob(canvas, 'image/webp', PREVIEW_WEBP_QUALITY);
    if (webp?.type === 'image/webp') return webp;
    const jpeg = await canvasToBlob(canvas, 'image/jpeg', PREVIEW_JPEG_FALLBACK_QUALITY);
    if (!jpeg) throw new Error('preview-encode-failed');
    return jpeg;
  } finally {
    decoded.release();
  }
}

export async function deleteUploadedChatMedia(paths: string[]) {
  await Promise.allSettled(paths.map((path) => deleteObject(ref(storage, path))));
}

export async function createLegacyChatMediaReference(
  coupleId: string,
  migrationOwnerUid: string,
  messageId: number,
  mediaIndex: number,
  originalUrl: string,
) {
  if (hasOptimizedChatPreview(originalUrl)) return originalUrl;
  if (!originalUrl || originalUrl.startsWith('blob:')) throw new Error('legacy-media-unavailable');

  const response = await fetch(originalUrl, { cache: 'force-cache' });
  if (!response.ok) throw new Error(`legacy-media-${response.status}`);
  const source = await response.blob();
  if (!source.type.startsWith('image/') || source.type === 'image/gif') throw new Error('legacy-media-not-static-image');

  await yieldToBrowser();
  const compactPreview = await createCompactPreview(source);
  const sequence = String(mediaIndex + 1).padStart(3, '0');
  const previewPath = `couples/${coupleId}/chatMedia/${migrationOwnerUid}/${messageId}/legacy-${sequence}.preview.webp`;
  const previewRef = ref(storage, previewPath);
  await uploadBytes(previewRef, compactPreview, {
    contentType: compactPreview.type || 'image/webp',
    cacheControl: 'public,max-age=31536000,immutable',
    customMetadata: {
      coupleId,
      ownerUid: migrationOwnerUid,
      messageId: String(messageId),
      mediaIndex: String(mediaIndex),
      variant: 'legacy-preview',
    },
  });
  const previewUrl = await getDownloadURL(previewRef);
  return createChatMediaReference(previewUrl, originalUrl);
}

export async function uploadChatMedia(
  coupleId: string,
  ownerUid: string,
  messageId: number,
  dataUrls: string[],
  options: UploadChatMediaOptions = {},
): Promise<UploadedChatMedia> {
  const urls: string[] = [];
  const paths: string[] = [];
  const startIndex = Math.max(0, options.startIndex ?? 0);

  try {
    for (let index = 0; index < dataUrls.length; index += 1) {
      const dataUrl = dataUrls[index];
      const mime = dataUrlMime(dataUrl);
      if (!mime.startsWith('image/')) throw new Error('unsupported-chat-media');

      const absoluteIndex = startIndex + index;
      const sequence = String(absoluteIndex + 1).padStart(3, '0');
      const metadataBase = {
        coupleId,
        ownerUid,
        messageId: String(messageId),
        mediaIndex: String(absoluteIndex),
      };

      if (mime === 'image/gif') {
        const path = `couples/${coupleId}/chatMedia/${ownerUid}/${messageId}/${sequence}.gif`;
        const storageRef = ref(storage, path);
        await uploadString(storageRef, dataUrl, 'data_url', {
          contentType: mime,
          cacheControl: 'public,max-age=31536000,immutable',
          customMetadata: { ...metadataBase, variant: 'original' },
        });
        paths.push(path);
        urls.push(await getDownloadURL(storageRef));
        options.onUploaded?.(index + 1);
        await yieldToBrowser();
        continue;
      }

      const originalFile = getPendingOriginalChatFile(absoluteIndex);
      const originalMime = originalFile?.type?.startsWith('image/') ? originalFile.type : mime;
      const originalPath = `couples/${coupleId}/chatMedia/${ownerUid}/${messageId}/${sequence}.original.${extensionForMime(originalMime)}`;
      const previewPath = `couples/${coupleId}/chatMedia/${ownerUid}/${messageId}/${sequence}.preview.webp`;
      const originalRef = ref(storage, originalPath);
      const previewRef = ref(storage, previewPath);

      await yieldToBrowser();
      const compactPreview = await createCompactPreview(dataUrl);
      await uploadBytes(previewRef, compactPreview, {
        contentType: compactPreview.type || 'image/webp',
        cacheControl: 'public,max-age=31536000,immutable',
        customMetadata: { ...metadataBase, variant: 'preview' },
      });
      paths.push(previewPath);

      if (originalFile) {
        await uploadBytes(originalRef, originalFile, {
          contentType: originalMime || 'application/octet-stream',
          cacheControl: 'public,max-age=31536000,immutable',
          customMetadata: { ...metadataBase, variant: 'original', originalName: originalFile.name },
        });
      } else {
        await uploadString(originalRef, dataUrl, 'data_url', {
          contentType: originalMime,
          cacheControl: 'public,max-age=31536000,immutable',
          customMetadata: { ...metadataBase, variant: 'original-fallback' },
        });
      }
      paths.push(originalPath);

      const [previewUrl, originalUrl] = await Promise.all([
        getDownloadURL(previewRef),
        getDownloadURL(originalRef),
      ]);
      urls.push(createChatMediaReference(previewUrl, originalUrl));
      options.onUploaded?.(index + 1);
      await yieldToBrowser();
    }

    return { urls, paths };
  } catch (cause) {
    await deleteUploadedChatMedia(paths);
    throw cause;
  }
}
