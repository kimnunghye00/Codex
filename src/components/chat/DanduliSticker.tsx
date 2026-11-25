import { PREVIEW_PACKS } from './stickerPreviews';
import '../../danduli-stickers.css';

import { STICKER_BY_ID, type DanduliStickerId } from './stickerCatalog';

export function DanduliSticker({ id, className = '', preview = false }: { id?: string; className?: string; preview?: boolean }) {
  const item = id ? STICKER_BY_ID.get(id as DanduliStickerId) : undefined;
  if (!item) return null;
  const previewPack = item.image ? PREVIEW_PACKS.find((pack) => item.id.startsWith(`${pack}-`)) : 'danduli-couple';
  const previewImage = preview && previewPack ? `/stickers/previews/${previewPack}-v1.webp` : undefined;
  const x = item.col * (100 / 3);
  const y = item.row * (100 / 3);

  return (
    <span
      className={`danduli-sticker ${previewImage ? 'danduli-sticker-preview' : item.image ? 'danduli-sticker-asset' : ''} ${className}`}
      role="img"
      aria-label={item.label}
      title={item.label}
      style={previewImage ? { backgroundImage: `url('${previewImage}')`, backgroundPosition: `${x}% ${y}%` } : item.image ? undefined : { backgroundPosition: `${x}% ${y}%` }}
    >
      {item.image && !previewImage && <img
        className="danduli-sticker-asset-image"
        src={item.image}
        alt=""
        aria-hidden="true"
        draggable={false}
        decoding="async"
      />}
    </span>
  );
}
