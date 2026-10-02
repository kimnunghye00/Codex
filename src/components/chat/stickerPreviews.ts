export const PREVIEW_PACKS = ['danduli-couple', 'military-cat', 'military-bunny', 'daily-bunny', 'daily-cat'];
const PREVIEW_URLS = PREVIEW_PACKS.map((pack) => `/stickers/previews/${pack}-v1.webp`);
let previewPreload: Promise<void> | undefined;

export function preloadStickerPreviews() {
  if (typeof Image === 'undefined') return Promise.resolve();
  if (!previewPreload) {
    previewPreload = Promise.all(PREVIEW_URLS.map((src) => new Promise<void>((resolve, reject) => {
      const image = new Image();
      image.decoding = 'async';
      image.onload = () => { void image.decode().catch(() => {}).then(resolve); };
      image.onerror = reject;
      image.src = src;
    }))).then(() => {}, () => { previewPreload = undefined; });
  }
  return previewPreload;
}

