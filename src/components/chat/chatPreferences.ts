import { DANDULI_NEW_STICKER_PACKS, DANDULI_STICKERS, stickerToken } from './stickerCatalog';

export type ChatBackground = 'route' | 'cream' | 'rose' | 'sage' | 'midnight';
export type ChatFontSize = 'small' | 'medium' | 'large' | 'xlarge';
export type MediaQuality = 'data' | 'high' | 'original';

export type ChatPreferences = {
  background: ChatBackground;
  fontSize: ChatFontSize;
  mediaQuality: MediaQuality;
  stickerPackOrder: string[];
  ownedStickerPacks: string[];
};

export type StickerPack = { id: string; name: string; description: string; stickers: string[]; priceLabel: string };

export const STICKER_PACKS: StickerPack[] = [
  { id: 'danduli-couple', name: '나너 커플', description: '고양이와 토끼 커플의 16가지 마음 표현', stickers: DANDULI_STICKERS.map((sticker) => stickerToken(sticker.id)), priceLabel: '기본' },
  ...DANDULI_NEW_STICKER_PACKS.map((pack) => ({ id: pack.id, name: pack.name, description: pack.description, stickers: pack.stickers.map((sticker) => stickerToken(sticker.id)), priceLabel: '기본' })),
  { id: 'daily-mood', name: '오늘의 기분', description: '매일 쓰기 좋은 표정 모음', stickers: ['🥰', '😊', '🥹', '😴', '😤', '🤭'], priceLabel: '무료' },
  { id: 'tiny-love', name: '쪼꼬미 러브', description: '짧게 마음을 전하는 팩', stickers: ['🐰💗', '🐻🫶', '🐶💕', '🐱💖', '🐹❤️', '🐥💘'], priceLabel: '무료' },
];

const PREF_KEY_PREFIX = 'route-chat-preferences:';
export const fallbackPackIds = ['danduli-couple', ...DANDULI_NEW_STICKER_PACKS.map((pack) => pack.id)];
const availableStickerPackIds = new Set(STICKER_PACKS.map((pack) => pack.id));

export function defaultChatPreferences(): ChatPreferences {
  return {
    background: 'route',
    fontSize: 'medium',
    mediaQuality: 'high',
    stickerPackOrder: STICKER_PACKS.map((pack) => pack.id),
    ownedStickerPacks: fallbackPackIds,
  };
}

export function loadChatPreferences(uid: string): ChatPreferences {
  const fallback = defaultChatPreferences();
  try {
    const raw = localStorage.getItem(`${PREF_KEY_PREFIX}${uid}`);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<ChatPreferences>;
    return {
      ...fallback,
      ...parsed,
      stickerPackOrder: Array.isArray(parsed.stickerPackOrder)
        ? Array.from(new Set([...parsed.stickerPackOrder, ...fallback.stickerPackOrder])).filter((id) => availableStickerPackIds.has(id))
        : fallback.stickerPackOrder,
      ownedStickerPacks: Array.isArray(parsed.ownedStickerPacks)
        ? Array.from(new Set([...fallback.ownedStickerPacks, ...parsed.ownedStickerPacks])).filter((id) => availableStickerPackIds.has(id))
        : fallback.ownedStickerPacks,
    };
  } catch {
    return fallback;
  }
}

export function saveChatPreferences(uid: string, preferences: ChatPreferences) {
  localStorage.setItem(`${PREF_KEY_PREFIX}${uid}`, JSON.stringify(preferences));
}

