import '../../danduli-stickers.css';

export type DanduliStickerId = string;

export type DanduliStickerItem = {
  id: DanduliStickerId;
  label: string;
  row: number;
  col: number;
  sheet?: string;
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

const makePack = (id: string, name: string, description: string, sheet: string, labels: string[]) => ({
  id,
  name,
  description,
  stickers: labels.map((label, index): DanduliStickerItem => ({
    id: `${id}-${String(index + 1).padStart(2, '0')}`,
    label,
    row: Math.floor(index / 4),
    col: index % 4,
    sheet,
  })),
});

export const DANDULI_NEW_STICKER_PACKS = [
  makePack('military-cat', '군인 고양이', '군 생활과 기다림을 전하는 16가지 마음', '/danduli-military-cat.webp', [
    '충성!', '훈련중', '경계중', '휴가 간다', '복귀중', '전화할게', '편지 고마워', 'PX 왔어',
    '군복 어때', '너 생각중', '보고할게', '작전 성공', '전역하면 보자', '기다려줘', '무사복귀', '곰신 최고',
  ]),
  makePack('military-bunny', '기다리는 토끼', '곰신 토끼의 응원과 약속 16가지', '/danduli-military-bunny.webp', [
    '곰신 모드', '편지 쓰는중', '휴가만 기다려', '면회 갈게', '간식 챙겼어', '군복 멋있어', '얼른 와줘', '무사히 다녀와',
    '사진 보는중', '오늘도 응원해', '전역하면 놀자', '자랑스러워', '꽃신 신자', '손꼽는중', '내 군인', '끝까지 응원',
  ]),
  makePack('daily-bunny', '토끼의 하루', '일상에서 쓰기 좋은 토끼의 16가지 표현', '/danduli-daily-bunny.webp', [
    '뭐해?', '배고파', '조심히가', '데리러와', '심심해', '서운해', '행복해', '히히',
    '같이 먹자', '다녀와', '화이팅', '충전중', '반칙이야', '걱정마', '집가자', '기다릴게',
  ]),
  makePack('daily-cat', '고양이의 하루', '일상에서 쓰기 좋은 고양이의 16가지 표현', '/danduli-daily-cat.webp', [
    '브이', '내가 갈게', '나만 봐', '내가 살게', '집중중', '게임중', '머쓱', '미안해',
    '괜찮아?', '기다려봐', '집에가자', '나이스', '드라이브 가자', '내가 할게', '지켜줄게', '출동!',
  ]),
];

const STICKER_BY_ID = new Map([...DANDULI_STICKERS, ...DANDULI_NEW_STICKER_PACKS.flatMap((pack) => pack.stickers)].map((item) => [item.id, item]));

export function stickerToken(id: DanduliStickerId) {
  return `danduli:${id}`;
}

export function stickerIdFromToken(value: string): DanduliStickerId | undefined {
  if (!value.startsWith('danduli:')) return undefined;
  const id = value.slice('danduli:'.length) as DanduliStickerId;
  return STICKER_BY_ID.has(id) ? id : undefined;
}

export function stickerLabel(id: string) {
  return STICKER_BY_ID.get(id)?.label;
}

export function DanduliSticker({ id, className = '' }: { id?: string; className?: string }) {
  const item = id ? STICKER_BY_ID.get(id as DanduliStickerId) : undefined;
  if (!item) return null;
  const x = item.col * (100 / 3);
  const y = item.row * (100 / 3);
  return (
    <span
      className={`danduli-sticker ${item.sheet ? 'danduli-sticker-portrait' : ''} ${className}`}
      role="img"
      aria-label={item.label}
      title={item.label}
      style={{ backgroundPosition: `${x}% ${y}%`, ...(item.sheet ? { backgroundImage: `url('${item.sheet}')` } : {}) }}
    />
  );
}
