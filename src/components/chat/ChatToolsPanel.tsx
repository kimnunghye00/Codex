import { ArrowDown, ArrowUp, Check, Download, Image as ImageIcon, PackageOpen, Palette, RotateCcw, Search, Settings2, ShoppingBag, SlidersHorizontal, Type, Upload, X } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import type { Message } from '../../types';

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

type StickerPack = { id: string; name: string; description: string; stickers: string[]; priceLabel: string };

export const STICKER_PACKS: StickerPack[] = [
  { id: 'route-hearts', name: '단둘이 하트', description: '커플 대화에 잘 어울리는 기본 팩', stickers: ['🫶', '❤️', '💕', '💗', '💖', '💘'], priceLabel: '기본' },
  { id: 'daily-mood', name: '오늘의 기분', description: '매일 쓰기 좋은 표정 모음', stickers: ['🥰', '😊', '🥹', '😴', '😤', '🤭'], priceLabel: '무료' },
  { id: 'tiny-love', name: '쪼꼬미 러브', description: '짧게 마음을 전하는 팩', stickers: ['🐰💗', '🐻🫶', '🐶💕', '🐱💖', '🐹❤️', '🐥💘'], priceLabel: '무료' },
];

const PREF_KEY_PREFIX = 'route-chat-preferences:';

export function defaultChatPreferences(): ChatPreferences {
  return {
    background: 'route',
    fontSize: 'medium',
    mediaQuality: 'high',
    stickerPackOrder: STICKER_PACKS.map((pack) => pack.id),
    ownedStickerPacks: ['route-hearts'],
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
      stickerPackOrder: Array.isArray(parsed.stickerPackOrder) ? parsed.stickerPackOrder : fallback.stickerPackOrder,
      ownedStickerPacks: Array.isArray(parsed.ownedStickerPacks) ? parsed.ownedStickerPacks : fallback.ownedStickerPacks,
    };
  } catch {
    return fallback;
  }
}

export function saveChatPreferences(uid: string, preferences: ChatPreferences) {
  localStorage.setItem(`${PREF_KEY_PREFIX}${uid}`, JSON.stringify(preferences));
}

function exportMessages(messages: Message[], partnerName: string) {
  const payload = {
    format: 'ROUTE_CHAT_BACKUP',
    version: 1,
    exportedAt: new Date().toISOString(),
    partnerName,
    messages,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `DANDULI-chat-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

export function ChatToolsPanel({
  messages,
  partnerName,
  preferences,
  onPreferences,
  onJump,
  onImage,
  onImport,
  onSticker,
  onClose,
}: {
  messages: Message[];
  partnerName: string;
  preferences: ChatPreferences;
  onPreferences: (next: ChatPreferences) => void;
  onJump: (id: number) => void;
  onImage: (url: string) => void;
  onImport: (messages: Message[]) => void;
  onSticker: (sticker: string) => void;
  onClose: () => void;
}) {
  const [section, setSection] = useState<'menu' | 'search' | 'media' | 'store' | 'settings' | 'stickers'>('menu');
  const [query, setQuery] = useState('');
  const [feedback, setFeedback] = useState('');
  const importRef = useRef<HTMLInputElement>(null);
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return messages.filter((message) => message.type === 'text' && message.text?.toLowerCase().includes(q));
  }, [messages, query]);
  const media = useMemo(() => messages.filter((message) => message.type === 'image' && message.imageUrl), [messages]);
  const orderedPacks = preferences.stickerPackOrder.map((id) => STICKER_PACKS.find((pack) => pack.id === id)).filter(Boolean) as StickerPack[];

  const update = (patch: Partial<ChatPreferences>) => onPreferences({ ...preferences, ...patch });
  const ownPack = (id: string) => {
    if (preferences.ownedStickerPacks.includes(id)) return;
    update({ ownedStickerPacks: [...preferences.ownedStickerPacks, id] });
    setFeedback('이모티콘 팩을 추가했어요.');
  };
  const movePack = (id: string, direction: -1 | 1) => {
    const order = [...preferences.stickerPackOrder];
    const index = order.indexOf(id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target], order[index]];
    update({ stickerPackOrder: order });
  };
  const restorePacks = () => {
    const restored = Array.from(new Set([...preferences.ownedStickerPacks, 'route-hearts']));
    update({ ownedStickerPacks: restored });
    setFeedback('이 기기에 저장된 이모티콘 이용 정보를 복원했어요.');
  };

  const importBackup = (file?: File) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result ?? '')) as { format?: string; messages?: Message[] };
        if (data.format !== 'ROUTE_CHAT_BACKUP' || !Array.isArray(data.messages)) throw new Error('invalid');
        const valid = data.messages.filter((message) => typeof message.id === 'number' && (message.sender === 'me' || message.sender === 'partner') && (message.type === 'text' || message.type === 'image'));
        onImport(valid);
        setFeedback(`${valid.length}개의 대화를 불러왔어요.`);
      } catch {
        setFeedback('단둘이에서 내보낸 올바른 대화 백업 파일이 아니에요.');
      }
    };
    reader.readAsText(file);
  };

  return <div className="chat-tools-backdrop" role="dialog" aria-modal="true" aria-label="채팅 메뉴" onClick={onClose}>
    <section className="chat-tools-sheet" onClick={(event) => event.stopPropagation()}>
      <header className="chat-tools-header">
        <div><small>CHAT OPTIONS</small><h2>{section === 'menu' ? '채팅 메뉴' : section === 'search' ? '대화 검색' : section === 'media' ? '사진 모아보기' : section === 'store' ? '이모티콘 스토어' : section === 'stickers' ? '이모티콘 설정' : '채팅 설정'}</h2></div>
        <button className="chat-tools-close" type="button" onClick={onClose} aria-label="닫기"><X /></button>
      </header>

      {section !== 'menu' && <button className="chat-tools-back" type="button" onClick={() => { setSection('menu'); setFeedback(''); }}>← 채팅 메뉴</button>}

      {section === 'menu' && <div className="chat-tools-menu">
        <button type="button" onClick={() => setSection('search')}><span><Search /></span><div><b>대화 검색</b><small>메시지 내용에서 원하는 기록 찾기</small></div></button>
        <button type="button" onClick={() => setSection('media')}><span><ImageIcon /></span><div><b>사진 모아보기</b><small>주고받은 사진을 한곳에서 보기</small></div></button>
        <button type="button" onClick={() => setSection('store')}><span><ShoppingBag /></span><div><b>이모티콘 스토어</b><small>새로운 이모티콘 팩 둘러보기</small></div></button>
        <button type="button" onClick={() => setSection('settings')}><span><Settings2 /></span><div><b>기능 / 옵션</b><small>배경, 글꼴, 백업, 화질 설정</small></div></button>
      </div>}

      {section === 'search' && <div className="chat-tool-section">
        <label className="chat-search-box"><Search size={18} /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="검색어를 입력하세요" /></label>
        <p className="chat-tool-caption">{query ? `${results.length}개의 결과` : '대화 내용을 검색할 수 있어요.'}</p>
        <div className="chat-search-results">{results.map((message) => <button type="button" key={message.id} onClick={() => { onJump(message.id); onClose(); }}><b>{message.sender === 'me' ? '나' : partnerName}</b><span>{message.text}</span><time>{new Date(message.timestamp).toLocaleString('ko-KR')}</time></button>)}{query && !results.length && <div className="chat-tool-empty">일치하는 대화가 없어요.</div>}</div>
      </div>}

      {section === 'media' && <div className="chat-tool-section"><p className="chat-tool-caption">총 {media.length}장의 사진</p><div className="chat-media-grid">{media.map((message) => <button key={message.id} type="button" onClick={() => message.imageUrl && onImage(message.imageUrl)}><img src={message.imageUrl} alt="채팅 사진" /><span>{message.sender === 'me' ? '나' : partnerName}</span></button>)}{!media.length && <div className="chat-tool-empty wide">아직 주고받은 사진이 없어요.</div>}</div></div>}

      {section === 'store' && <div className="chat-tool-section"><div className="sticker-store-list">{STICKER_PACKS.map((pack) => {
        const owned = preferences.ownedStickerPacks.includes(pack.id);
        return <article key={pack.id}><div className="sticker-pack-preview">{pack.stickers.slice(0, 4).map((sticker) => <span key={sticker}>{sticker}</span>)}</div><div className="sticker-pack-copy"><b>{pack.name}</b><small>{pack.description}</small></div><button type="button" disabled={owned} onClick={() => ownPack(pack.id)}>{owned ? <><Check size={14} />사용 중</> : pack.priceLabel === '무료' ? '받기' : pack.priceLabel}</button></article>;
      })}</div><p className="chat-store-note">현재 웹 테스트 버전에서는 무료 팩과 기본 팩을 사용할 수 있어요. 실제 유료 결제·스토어 구매 복원은 모바일 앱 결제 연동 단계에서 연결됩니다.</p></div>}

      {section === 'settings' && <div className="chat-tool-section settings-stack">
        <div className="chat-setting-card"><div className="chat-setting-title"><Palette /><span><b>배경</b><small>대화방 분위기를 바꿔요.</small></span></div><div className="chat-background-options">{(['route','cream','rose','sage','midnight'] as ChatBackground[]).map((value) => <button key={value} type="button" className={`${value} ${preferences.background === value ? 'active' : ''}`} onClick={() => update({ background: value })} aria-label={`배경 ${value}`}><i />{preferences.background === value && <Check size={14} />}</button>)}</div></div>
        <div className="chat-setting-card"><div className="chat-setting-title"><Type /><span><b>글꼴 크기</b><small>메시지 글자 크기를 조절해요.</small></span></div><div className="chat-segmented">{([['small','작게'],['medium','보통'],['large','크게'],['xlarge','아주 크게']] as const).map(([value,label]) => <button type="button" key={value} className={preferences.fontSize === value ? 'active' : ''} onClick={() => update({ fontSize: value })}>{label}</button>)}</div></div>
        <div className="chat-setting-card"><div className="chat-setting-title"><SlidersHorizontal /><span><b>사진 및 영상 전송 퀄리티</b><small>사진 전송 용량과 화질을 선택해요.</small></span></div><div className="chat-quality-list">{([['data','데이터 절약','사진을 작게 압축'],['high','고화질','화질과 용량의 균형'],['original','원본','가능하면 원본 유지']] as const).map(([value,label,description]) => <button type="button" key={value} className={preferences.mediaQuality === value ? 'active' : ''} onClick={() => update({ mediaQuality: value })}><span><b>{label}</b><small>{description}</small></span>{preferences.mediaQuality === value && <Check size={16} />}</button>)}</div></div>
        <div className="chat-setting-card"><div className="chat-setting-title"><PackageOpen /><span><b>대화내용 백업</b><small>대화를 파일로 보관하거나 다시 불러와요.</small></span></div><div className="chat-backup-actions"><button type="button" onClick={() => exportMessages(messages, partnerName)}><Download size={16} />대화내용 내보내기</button><button type="button" onClick={() => importRef.current?.click()}><Upload size={16} />대화내용 불러오기</button><input ref={importRef} hidden type="file" accept="application/json,.json" onChange={(event) => { importBackup(event.target.files?.[0]); event.target.value = ''; }} /></div></div>
        <button className="chat-setting-link" type="button" onClick={() => setSection('stickers')}><span><ShoppingBag size={18} /><b>이모티콘 설정</b></span><span>순서 변경 · 구매 복원 ›</span></button>
      </div>}

      {section === 'stickers' && <div className="chat-tool-section"><div className="sticker-manage-list">{orderedPacks.map((pack, index) => <article key={pack.id}><div><b>{pack.name}</b><small>{preferences.ownedStickerPacks.includes(pack.id) ? '사용 가능' : '스토어에서 받기 필요'}</small></div><div><button type="button" disabled={index === 0} onClick={() => movePack(pack.id, -1)} aria-label="위로"><ArrowUp /></button><button type="button" disabled={index === orderedPacks.length - 1} onClick={() => movePack(pack.id, 1)} aria-label="아래로"><ArrowDown /></button></div></article>)}</div><button className="restore-stickers" type="button" onClick={restorePacks}><RotateCcw size={16} />이모티콘 구매 복원</button><div className="owned-sticker-preview">{orderedPacks.filter((pack) => preferences.ownedStickerPacks.includes(pack.id)).flatMap((pack) => pack.stickers).map((sticker, index) => <button type="button" key={`${sticker}-${index}`} onClick={() => { onSticker(sticker); onClose(); }}>{sticker}</button>)}</div></div>}

      {feedback && <p className="chat-tools-feedback">{feedback}</p>}
    </section>
  </div>;
}
