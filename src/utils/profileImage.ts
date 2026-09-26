// Profile pictures are stored in the user's Firestore document, which has a
// 1 MiB size limit. Leave room for both pictures and the remaining profile.
const PROFILE_IMAGE_LIMIT_BYTES = 260 * 1024;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('image-load-failed'));
    image.src = src;
  });
}

function withinLimit(dataUrl: string, maxBytes: number) {
  const encoded = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0;
  return Math.floor(encoded.length * 3 / 4) - padding <= maxBytes;
}

async function encodeWithinLimit(src: string, maxSide: number, maxBytes: number) {
  const image = await loadImage(src);
  const originalSide = Math.max(image.naturalWidth, image.naturalHeight);
  if (!originalSide) throw new Error('image-load-failed');

  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) throw new Error('canvas-unavailable');

  for (const side of [maxSide, Math.round(maxSide * 0.8), Math.round(maxSide * 0.65), 480]) {
    const scale = Math.min(1, side / originalSide);
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.82, 0.68, 0.52]) {
      const encoded = canvas.toDataURL('image/jpeg', quality);
      if (withinLimit(encoded, maxBytes)) return encoded;
    }
  }
  throw new Error('image-too-large-to-sync');
}

export async function prepareProfilePhoto(file: File) {
  if (!file.type.startsWith('image/')) throw new Error('image-only');
  if (file.size > 12 * 1024 * 1024) throw new Error('image-too-large');
  const objectUrl = URL.createObjectURL(file);
  try { return await encodeWithinLimit(objectUrl, 720, PROFILE_IMAGE_LIMIT_BYTES); }
  finally { URL.revokeObjectURL(objectUrl); }
}

export async function constrainCroppedProfileImage(dataUrl: string, kind: 'avatar' | 'background') {
  if (!dataUrl.startsWith('data:image/')) return dataUrl;
  if (withinLimit(dataUrl, PROFILE_IMAGE_LIMIT_BYTES)) return dataUrl;
  return encodeWithinLimit(dataUrl, kind === 'avatar' ? 720 : 1200, PROFILE_IMAGE_LIMIT_BYTES);
}

export async function constrainProfileMedia<T extends { photoDataUrl?: string; backgroundPhotoDataUrl?: string }>(profile: T): Promise<T> {
  const [photoDataUrl, backgroundPhotoDataUrl] = await Promise.all([
    profile.photoDataUrl ? constrainCroppedProfileImage(profile.photoDataUrl, 'avatar') : undefined,
    profile.backgroundPhotoDataUrl ? constrainCroppedProfileImage(profile.backgroundPhotoDataUrl, 'background') : undefined,
  ]);
  return { ...profile, photoDataUrl, backgroundPhotoDataUrl };
}
