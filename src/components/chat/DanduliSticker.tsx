import '../../danduli-stickers.css';

export type DanduliStickerId =
  | 'love' | 'miss' | 'kiss' | 'hug'
  | 'sleep' | 'pat' | 'heart' | 'sulk'
  | 'thanks' | 'my-side' | 'date' | 'yay'
  | 'squeeze' | 'why' | 'best' | 'cuddle';

export type DanduliStickerItem = {
  id: DanduliStickerId;
  label: string;
  row: number;
  col: number;
};

export const DANDULI_STICKERS: DanduliStickerItem[] = [
  { id: 'love', label: '사랑해', row: 0, col: 0 },
  { id: 'miss', label: '보고싶어', row: 0, col: 1 },
  { id: 'kiss', label: '뽀뽀', row: 0, col: 2 },
  { id: 'hug', label: '안아줘', row: 0, col: 3 },
  { id: 'sleep', label: '잘 자', row: 1, col: 0 },
  { id: 'pat', label: '토닥토닥', row: 1, col: 1 },
  { id: 'heart', label: '심쿵', row: 1, col: 2 },
  { id: 'sulk', label: '삐짐', row: 1, col: 3 },
  { id: 'thanks', label: '고마워', row: 2, col: 0 },
  { id: 'my-side', label: '내 편', row: 2, col: 1 },
  { id: 'date', label: '데이트 가자', row: 2, col: 2 },
  { id: 'yay', label: '좋아좋아', row: 2, col: 3 },
  { id: 'squeeze', label: '쭉', row: 3, col: 0 },
  { id: 'why', label: '왜애', row: 3, col: 1 },
  { id: 'best', label: '최고야', row: 3, col: 2 },
  { id: 'cuddle', label: '꼬옥', row: 3, col: 3 },
];

const STICKER_BY_ID = new Map(DANDULI_STICKERS.map((item) => [item.id, item]));

export function stickerToken(id: DanduliStickerId) {
  return `danduli:${id}`;
}

export function stickerIdFromToken(value: string): DanduliStickerId | undefined {
  if (!value.startsWith('danduli:')) return undefined;
  const id = value.slice('danduli:'.length) as DanduliStickerId;
  return STICKER_BY_ID.has(id) ? id : undefined;
}

export function DanduliSticker({ id, className = '' }: { id?: string; className?: string }) {
  const item = id ? STICKER_BY_ID.get(id as DanduliStickerId) : undefined;
  if (!item) return null;
  const x = item.col * (100 / 3);
  const y = item.row * (100 / 3);
  return (
    <span
      className={`danduli-sticker ${className}`}
      role="img"
      aria-label={item.label}
      title={item.label}
      style={{ backgroundPosition: `${x}% ${y}%` }}
    />
  );
}
