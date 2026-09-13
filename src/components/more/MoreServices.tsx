import { MessageCircle, Palette, ShoppingBag, Smartphone, Sparkles, Sticker, UserRound, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { auth } from '../../lib/firebaseAuth';
import { normalizeRouteAppIcon, updateRouteFavicon, type RouteAppIconId } from '../../utils/appIcon';
import { applyRouteProfileStyle, normalizeRouteProfileStyle, type RouteProfileStyle } from '../../utils/profileStyle';
import {
  loadChatPreferences,
  saveChatPreferences,
  type ChatBackground,
  type ChatFontSize,
  type ChatPreferences,
} from '../chat/ChatToolsPanel';
import type { HubTabId } from '../memories/MemoriesPage';
import type { LocationTabId } from '../location/LocationPage';

type AppIconId = RouteAppIconId;
type ThemeId = 'default' | 'lavender' | 'dark';
type MoreSheet = 'theme' | 'app-icon' | 'emoticon' | 'chat-style' | 'profile-style' | 'store';

export type MoreNavigationTarget =
  | { area: 'chat' }
  | { area: 'memories'; tab: HubTabId }
  | { area: 'location'; tab: LocationTabId };

type AppIconOption = {
  id: AppIconId;
  label: string;
  className: string;
};

const APP_ICONS: AppIconOption[] = [
  { id: 'route', label: '하트 톡', className: 'danduli-image-icon' },
  { id: 'heart-chat', label: '둘이 톡', className: 'danduli-image-icon' },
];

const EMOTICON_PACKS = [
  { id: 'daily', name: '우리의 하루', preview: ['🥰', '😴', '🍚', '❤️'], price: '무료' },
  { id: 'mood', name: '오늘의 기분', preview: ['😆', '🥺', '😤', '🤭'], price: '1,500원' },
  { id: 'love', name: '사랑 가득', preview: ['💕', '💌', '😘', '🫶'], price: '1,500원' },
  { id: 'date', name: '데이트 가자', preview: ['🍿', '☕', '🚗', '🌙'], price: '2,000원' },
];

const CHAT_BACKGROUNDS: Array<{ id: ChatBackground; label: string }> = [
  { id: 'route', label: '단둘이' },
  { id: 'cream', label: '크림' },
  { id: 'rose', label: '로즈' },
  { id: 'sage', label: '세이지' },
  { id: 'midnight', label: '미드나잇' },
];

const CHAT_FONT_SIZES: Array<{ id: ChatFontSize; label: string }> = [
  { id: 'small', label: '작게' },
  { id: 'medium', label: '보통' },
  { id: 'large', label: '크게' },
  { id: 'xlarge', label: '아주 크게' },
];

const PROFILE_STYLES: Array<{ id: RouteProfileStyle; label: string; description: string }> = [
  { id: 'clean', label: '클린', description: '깔끔하고 기본적인 프로필' },
  { id: 'soft', label: '소프트', description: '부드러운 링과 은은한 그림자' },
  { id: 'heart', label: '하트', description: '커플 느낌을 강조한 프로필' },
];

function AppIconGlyph({ id }: { id: AppIconId }) {
  const src = id === 'heart-chat' ? '/danduli-icon-chat.webp' : '/danduli-icon-heart.webp';
  return <img src={src} alt="" className="danduli-app-icon-image" draggable={false} />;
}

function HeaderBar({ title, onClose }: { title: string; onClose: () => void }) {
  return <div className="more-sheet-head"><strong>{title}</strong><button type="button" onClick={onClose} aria-label="닫기"><X size={19} /></button></div>;
}

export function MoreServices({
  onOpenSettings: _onOpenSettings,
  onOpenNotifications: _onOpenNotifications,
  onNavigate: _onNavigate,
}: {
  onOpenSettings: () => void;
  onOpenNotifications: () => void;
  onNavigate: (target: MoreNavigationTarget) => void;
}) {
  const [sheet, setSheet] = useState<MoreSheet | null>(null);
  const [theme, setTheme] = useState<ThemeId>(() => {
    const saved = localStorage.getItem('meluni-theme');
    return saved === 'lavender' || saved === 'dark' ? saved : 'default';
  });
  const [appIcon, setAppIcon] = useState<AppIconId>(() => normalizeRouteAppIcon(localStorage.getItem('route-app-icon')));
  const [owned, setOwned] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('route-owned-emoticons') || '["daily"]') as string[]; } catch { return ['daily']; }
  });
  const [profileStyle, setProfileStyle] = useState<RouteProfileStyle>(() => normalizeRouteProfileStyle(localStorage.getItem('route-profile-style')));
  const chatUid = auth.currentUser?.uid ?? 'guest';
  const [chatPreferences, setChatPreferences] = useState<ChatPreferences>(() => loadChatPreferences(chatUid));
  const [notice, setNotice] = useState('');

  const activeIcon = useMemo(() => APP_ICONS.find((item) => item.id === appIcon) ?? APP_ICONS[0], [appIcon]);

  useEffect(() => {
    setChatPreferences(loadChatPreferences(auth.currentUser?.uid ?? 'guest'));
  }, []);

  const openSheet = (next: MoreSheet) => {
    setNotice('');
    setSheet(next);
  };

  const chooseTheme = (next: ThemeId) => {
    setTheme(next);
    localStorage.setItem('meluni-theme', next);
    document.documentElement.dataset.meluniTheme = next;
    setNotice('테마를 바로 적용했어요.');
  };

  const chooseIcon = (next: AppIconId) => {
    setAppIcon(next);
    localStorage.setItem('route-app-icon', next);
    updateRouteFavicon(next);
    setNotice('앱 아이콘 미리보기와 브라우저 아이콘에 적용했어요.');
  };

  const addPack = (id: string, price: string) => {
    if (owned.includes(id)) return;
    const next = [...owned, id];
    setOwned(next);
    localStorage.setItem('route-owned-emoticons', JSON.stringify(next));
    setNotice(price === '무료' ? '이모티콘을 보관함에 추가했어요.' : '현재 테스트 버전이라 실제 결제 없이 보관함에 추가했어요.');
  };

  const updateChatStyle = (patch: Partial<ChatPreferences>) => {
    const next = { ...chatPreferences, ...patch };
    const uid = auth.currentUser?.uid ?? 'guest';
    setChatPreferences(next);
    saveChatPreferences(uid, next);
    window.dispatchEvent(new CustomEvent<ChatPreferences>('route-chat-preferences-change', { detail: next }));
    setNotice('채팅 꾸미기를 저장했어요.');
  };

  const chooseProfileStyle = (next: RouteProfileStyle) => {
    setProfileStyle(next);
    localStorage.setItem('route-profile-style', next);
    applyRouteProfileStyle(next);
    setNotice('프로필 스타일을 적용했어요.');
  };

  return <div className="route-more-services">
    <section className="more-service-intro">
      <div><small>단둘이 CUSTOM</small><h1>더보기</h1><p>단둘이를 우리 취향에 맞게 꾸미고 확장해요.</p></div>
      <span className={`more-app-icon-preview ${appIcon} ${activeIcon.className} !grid place-items-center`} aria-label={`현재 앱 아이콘 ${activeIcon.label}`}><AppIconGlyph id={appIcon} /></span>
    </section>

    <section className="more-feature-section more-customize-section" aria-labelledby="route-more-customize-title">
      <div className="more-section-title"><small>CUSTOMIZE</small><h2 id="route-more-customize-title">단둘이 꾸미기</h2><p>다른 탭과 겹치지 않는 꾸미기 기능만 모았어요.</p></div>
      <div className="more-customize-grid" aria-label="단둘이 꾸미기">
        <button type="button" onClick={() => openSheet('theme')}><span className="more-customize-icon theme"><Palette /></span><b>테마</b><small>앱 전체 색상</small></button>
        <button type="button" onClick={() => openSheet('app-icon')}><span className="more-customize-icon icon"><Smartphone /></span><b>앱 아이콘</b><small>2가지 아이콘</small></button>
        <button type="button" onClick={() => openSheet('emoticon')}><span className="more-customize-icon emoticon"><Sticker /></span><b>이모티콘</b><small>보관함 · 팩</small></button>
        <button type="button" onClick={() => openSheet('chat-style')}><span className="more-customize-icon chat"><MessageCircle /></span><b>채팅 꾸미기</b><small>배경 · 글자 크기</small></button>
        <button type="button" onClick={() => openSheet('profile-style')}><span className="more-customize-icon profile"><UserRound /></span><b>프로필 꾸미기</b><small>아바타 스타일</small></button>
        <button type="button" onClick={() => openSheet('store')}><span className="more-customize-icon store"><ShoppingBag /></span><b>단둘이 스토어</b><small>꾸미기 모아보기</small></button>
      </div>
    </section>

    <section className="more-couple-strip"><span>♥</span><div><b>우리 둘만의 단둘이</b><small>둘만의 취향으로 단둘이를 완성해보세요.</small></div></section>

    {sheet && <div className="more-sheet-backdrop" role="dialog" aria-modal="true" onMouseDown={(event) => { if (event.target === event.currentTarget) setSheet(null); }}>
      <section className="more-sheet">
        {sheet === 'theme' && <><HeaderBar title="테마" onClose={() => setSheet(null)} /><p className="more-sheet-description">앱 전체 분위기를 바로 바꿔요.</p><div className="more-theme-picker">
          {(['default','lavender','dark'] as ThemeId[]).map((item) => <button type="button" key={item} className={theme === item ? 'active' : ''} onClick={() => chooseTheme(item)}><i className={item} /><span><b>{item === 'default' ? '기본' : item === 'lavender' ? '라벤더' : '다크'}</b><small>{item === 'default' ? '네이비 + 코랄' : item === 'lavender' ? '부드러운 보라' : '어두운 화면'}</small></span></button>)}
        </div></>}

        {sheet === 'app-icon' && <><HeaderBar title="앱 아이콘" onClose={() => setSheet(null)} /><p className="more-sheet-description">2가지 단둘이 아이콘 중 원하는 스타일을 선택해요.</p><div className="app-icon-picker !grid !grid-cols-2 !gap-2.5 sm:!grid-cols-2">
          {APP_ICONS.map((item) => <button data-icon-id={item.id} type="button" key={item.id} className={`${appIcon === item.id ? 'active' : ''} !min-w-0`} onClick={() => chooseIcon(item.id)}><span className={`more-app-icon-preview ${item.id} ${item.className} !grid place-items-center`}><AppIconGlyph id={item.id} /></span><b className="!w-full !truncate !text-center">{item.label}</b>{appIcon === item.id && <small>사용 중</small>}</button>)}
        </div></>}

        {sheet === 'emoticon' && <><HeaderBar title="이모티콘" onClose={() => setSheet(null)} /><p className="more-sheet-description">대화에서 사용할 단둘이 이모티콘을 모아보세요.</p><div className="emoticon-store">
          {EMOTICON_PACKS.map((pack) => <article key={pack.id}><div className="emoticon-preview">{pack.preview.map((emoji) => <span key={emoji}>{emoji}</span>)}</div><div className="emoticon-copy"><b>{pack.name}</b><small>{pack.price}</small></div><button type="button" disabled={owned.includes(pack.id)} onClick={() => addPack(pack.id, pack.price)}>{owned.includes(pack.id) ? '보유 중' : pack.price === '무료' ? '받기' : '구매하기'}</button></article>)}
        </div></>}

        {sheet === 'chat-style' && <><HeaderBar title="채팅 꾸미기" onClose={() => setSheet(null)} /><p className="more-sheet-description">대화방의 배경과 메시지 글자 크기를 여기서 바로 바꿔요.</p>
          <div className="more-chat-style-block"><strong>대화방 배경</strong><div className="more-chat-backgrounds">{CHAT_BACKGROUNDS.map((item) => <button type="button" key={item.id} className={`${item.id} ${chatPreferences.background === item.id ? 'active' : ''}`} onClick={() => updateChatStyle({ background: item.id })}><i /><span>{item.label}</span></button>)}</div></div>
          <div className="more-chat-style-block"><strong>메시지 글자 크기</strong><div className="more-chat-fonts">{CHAT_FONT_SIZES.map((item) => <button type="button" key={item.id} className={chatPreferences.fontSize === item.id ? 'active' : ''} onClick={() => updateChatStyle({ fontSize: item.id })}>{item.label}</button>)}</div></div>
        </>}

        {sheet === 'profile-style' && <><HeaderBar title="프로필 꾸미기" onClose={() => setSheet(null)} /><p className="more-sheet-description">프로필 사진과 아바타의 테두리 분위기를 선택해요.</p><div className="more-profile-style-picker">
          {PROFILE_STYLES.map((item) => <button type="button" key={item.id} className={profileStyle === item.id ? 'active' : ''} onClick={() => chooseProfileStyle(item.id)}><span className={`more-profile-style-preview ${item.id}`}><UserRound /></span><span><b>{item.label}</b><small>{item.description}</small></span></button>)}
        </div></>}

        {sheet === 'store' && <><HeaderBar title="단둘이 스토어" onClose={() => setSheet(null)} /><p className="more-sheet-description">단둘이의 꾸미기 콘텐츠를 한곳에서 둘러봐요.</p><div className="more-store-hub">
          <button type="button" onClick={() => openSheet('emoticon')}><Sticker /><span><b>이모티콘 팩</b><small>대화에서 쓰는 감정 표현</small></span><em>보기</em></button>
          <button type="button" onClick={() => openSheet('app-icon')}><Smartphone /><span><b>앱 아이콘</b><small>홈 화면을 우리 스타일로</small></span><em>보기</em></button>
          <button type="button" onClick={() => openSheet('theme')}><Sparkles /><span><b>테마 컬렉션</b><small>앱 전체 분위기 바꾸기</small></span><em>보기</em></button>
        </div><p className="more-store-coming">추가 유료 테마와 캐릭터 꾸미기는 모바일 스토어 연동 단계에서 확장할 수 있어요.</p></>}

        {notice && <p className="more-sheet-notice">{notice}</p>}
      </section>
    </div>}
  </div>;
}

export function applySavedRouteAppIcon() {
  updateRouteFavicon(normalizeRouteAppIcon(localStorage.getItem('route-app-icon')));
}
