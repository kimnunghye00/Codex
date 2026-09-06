import { deleteObject, getDownloadURL, ref, uploadBytes, uploadString } from 'firebase/storage';
import { storage } from './firebase';
import { getPendingOriginalChatFile } from './chatMediaOriginalRegistry';
import { createChatMediaReference } from './chatMediaReference';

export type UploadedChatMedia = {
  urls: string[];
  paths: string[];
};

type UploadChatMediaOptions = {
  startIndex?: number;
  onUploaded?: (completedInBatch: number) => void;
};

const PREVIEW_MAX_EDGE = 720;
const PREVIEW_WEBP_QUALITY = 0.5;

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

async function createCompactPreview(dataUrl: string) {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = dataUrl;
  });
  const scale = Math.min(1, PREVIEW_MAX_EDGE / Math.max(image.width, image.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('preview-canvas-unavailable');
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/webp', PREVIEW_WEBP_QUALITY);
}

export async function deleteUploadedChatMedia(paths: string[]) {
  await Promise.allSettled(paths.map((path) => deleteObject(ref(storage, path))));
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

      // GIFs stay as one original asset so animation is preserved.
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
        continue;
      }

      const originalFile = getPendingOriginalChatFile(absoluteIndex);
      const originalMime = originalFile?.type?.startsWith('image/') ? originalFile.type : mime;
      const originalPath = `couples/${coupleId}/chatMedia/${ownerUid}/${messageId}/${sequence}.original.${extensionForMime(originalMime)}`;
      const previewPath = `couples/${coupleId}/chatMedia/${ownerUid}/${messageId}/${sequence}.preview.webp`;
      const originalRef = ref(storage, originalPath);
      const previewRef = ref(storage, previewPath);

      const compactPreview = await createCompactPreview(dataUrl).catch(() => dataUrl);
      const previewMime = dataUrlMime(compactPreview);

      await uploadString(previewRef, compactPreview, 'data_url', {
        contentType: previewMime,
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
    }

    return { urls, paths };
  } catch (cause) {
    await deleteUploadedChatMedia(paths);
    throw cause;
  }
}
