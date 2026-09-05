import { deleteObject, getDownloadURL, ref, uploadString } from 'firebase/storage';
import { storage } from './firebase';

export type UploadedChatMedia = {
  urls: string[];
  paths: string[];
};

type UploadChatMediaOptions = {
  startIndex?: number;
  onUploaded?: (completedInBatch: number) => void;
};

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
  const uploaded: Array<{ path: string; url: string }> = [];
  const startIndex = Math.max(0, options.startIndex ?? 0);

  try {
    for (let index = 0; index < dataUrls.length; index += 1) {
      const dataUrl = dataUrls[index];
      const mime = dataUrlMime(dataUrl);
      if (!mime.startsWith('image/')) throw new Error('unsupported-chat-media');

      const absoluteIndex = startIndex + index;
      const fileName = `${String(absoluteIndex + 1).padStart(3, '0')}.${extensionForMime(mime)}`;
      const path = `couples/${coupleId}/chatMedia/${ownerUid}/${messageId}/${fileName}`;
      const storageRef = ref(storage, path);

      await uploadString(storageRef, dataUrl, 'data_url', {
        contentType: mime,
        customMetadata: {
          coupleId,
          ownerUid,
          messageId: String(messageId),
          mediaIndex: String(absoluteIndex),
        },
      });

      const url = await getDownloadURL(storageRef);
      uploaded.push({ path, url });
      options.onUploaded?.(index + 1);
    }

    return {
      urls: uploaded.map((item) => item.url),
      paths: uploaded.map((item) => item.path),
    };
  } catch (cause) {
    await deleteUploadedChatMedia(uploaded.map((item) => item.path));
    throw cause;
  }
}
