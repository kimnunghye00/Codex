import { Bell, Cake, ChevronLeft, ChevronRight, CircleHelp, DatabaseBackup, Heart, Images, Info, KeyRound, LockKeyhole, MapPinned, MessageCircle, MessageSquareText, Moon, Palette, ShoppingBag, Smartphone, Sparkles, Sticker, UserRound, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useExpandedMobile, useTabletWorkspace } from '../../utils/useExpandedMobile';
import { auth } from '../../lib/firebaseAuth';
import type { UserProfile } from '../../utils/profile';
import { SYSTEM_DARK_KEY, isSystemDarkEnabled, setSystemDarkEnabled } from '../../system-dark';
import { normalizeRouteAppIcon, updateRouteFavicon, type RouteAppIconId } from '../../utils/appIcon';
import { getNativeRouteAppIcon, setNativeRouteAppIcon, supportsNativeRouteAppIcon } from '../../app-icon-native';
import {
  loadChatPreferences,
  saveChatPreferences,
  STICKER_PACKS,
  type ChatBackground,
  type ChatFontSize,
  type ChatPreferences,
} from '../chat/ChatToolsPanel';
import { DanduliSticker, stickerIdFromToken } from '../chat/DanduliSticker';
import type { HubTabId } from '../memories/MemoriesPage';

type AppIconId = RouteAppIconId;
type MoreSheet = 'theme' | 'app-icon' | 'emoticon' | 'chat-style' | 'store' | 'layout';

export type MoreNavigationTarget =
  | { area: 'home'; profileEditor?: boolean }
  | { area: 'chat'; toolsSection?: 'settings' | 'stickers' | 'store' }
  | { area: 'memories'; tab: HubTabId }
  | { area: 'location'; tab: 'map' | 'footprints' };

type AppIconOption = {
  id: AppIconId;
  label: string;
  className: string;
};

const APP_ICONS: AppIconOption[] = [
  { id: 'route', label: '나너 기본', className: 'danduli-image-icon' },
  { id: 'heart-chat', label: '둘이 톡', className: 'danduli-image-icon' },
  { id: 'couple-love', label: '꼬옥 커플', className: 'danduli-image-icon' },
  { id: 'couple-date', label: '데이트 커플', className: 'danduli-image-icon' },
];

const CHAT_BACKGROUNDS: Array<{ id: ChatBackground; label: string }> = [
  { id: 'route', label: '나너' },
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

function loadBooleanSetting(key: string, defaultValue: boolean) {
  const saved = localStorage.getItem(key);
  return saved == null ? defaultValue : saved === '1';
}

function AppIconGlyph({ id }: { id: AppIconId }) {
  if (id === 'couple-love' || id === 'couple-date') {
    return <span className={`danduli-app-icon-character ${id}`} aria-hidden="true" />;
  }
  const src = id === 'heart-chat' ? '/danduli-icon-chat.webp' : '/danduli-icon-heart.webp';
  return <img src={src} alt="" className="danduli-app-icon-image" draggable={false} />;
}

function HeaderBar({ title, onClose }: { title: string; onClose: () => void }) {
  return <div className="more-sheet-head"><strong>{title}</strong><button type="button" onClick={onClose} aria-label="닫기"><X size={19} /></button></div>;
}

export function MoreServices({
  profile,
  connected,
  onOpenSettings,
  onOpenPageSettings,
  settingsOpen = false,
  onCloseSettings = () => {},
  onOpenNotifications,
  onNavigate,
}: {
  profile: UserProfile;
  connected: boolean;
  onOpenSettings: () => void;
  onOpenPageSettings: () => void;
  settingsOpen?: boolean;
  onCloseSettings?: () => void;
  onOpenNotifications: () => void;
  onNavigate: (target: MoreNavigationTarget) => void;
}) {
  const expanded = useExpandedMobile();
  const tablet = useTabletWorkspace();
  const [sheet, setSheet] = useState<MoreSheet | null>(() => expanded ? 'theme' : null);
  const [appIcon, setAppIcon] = useState<AppIconId>(() => normalizeRouteAppIcon(localStorage.getItem('route-app-icon')));
  const nativeAppIconSupported = supportsNativeRouteAppIcon();
  const [appIconStateLoading, setAppIconStateLoading] = useState(nativeAppIconSupported);
  const [appIconChanging, setAppIconChanging] = useState(false);
  const chatUid = auth.currentUser?.uid ?? 'guest';
  const [chatPreferences, setChatPreferences] = useState<ChatPreferences>(() => loadChatPreferences(chatUid));
  const [notice, setNotice] = useState('');
  const [anniversaryAlerts, setAnniversaryAlerts] = useState(() => loadBooleanSetting('route-setting-anniversary-alerts', true));
  const [chatAlerts, setChatAlerts] = useState(() => loadBooleanSetting('route-setting-chat-alerts', true));
  const [appLock, setAppLock] = useState(() => loadBooleanSetting('route-setting-app-lock', false));
  const [systemDark, setSystemDark] = useState(() => isSystemDarkEnabled());

  const activeIcon = useMemo(() => APP_ICONS.find((item) => item.id === appIcon) ?? APP_ICONS[0], [appIcon]);

  useEffect(() => {
    const handleIconChange = (event: Event) => {
      const next = normalizeRouteAppIcon(String((event as CustomEvent<string>).detail ?? ''));
      setAppIcon(next);
      updateRouteFavicon(next);
      setAppIconStateLoading(false);
    };
    window.addEventListener('route-app-icon-changed', handleIconChange);
    if (nativeAppIconSupported) {
      void getNativeRouteAppIcon()
        .then((icon) => { if (icon) setAppIcon(icon); })
        .catch((cause) => {
          console.warn('[DANDULI current launcher icon]', cause);
          setNotice('현재 홈 화면 아이콘을 확인하지 못했어요. 다시 열어 확인해 주세요.');
        })
        .finally(() => setAppIconStateLoading(false));
    }
    return () => window.removeEventListener('route-app-icon-changed', handleIconChange);
  }, [nativeAppIconSupported]);

  useEffect(() => {
    if (sheet !== 'app-icon' || !nativeAppIconSupported) return;
    void getNativeRouteAppIcon()
      .then((icon) => { if (icon) setAppIcon(icon); })
      .catch((cause) => console.warn('[DANDULI current launcher icon refresh]', cause))
      .finally(() => setAppIconStateLoading(false));
  }, [sheet, nativeAppIconSupported]);

  const openSheet = (next: MoreSheet) => {
    setNotice('');
    if (next === 'app-icon' && nativeAppIconSupported) setAppIconStateLoading(true);
    setSheet(next);
  };


  const chooseIcon = async (next: AppIconId) => {
    if (appIconChanging) return;
    const option = APP_ICONS.find((item) => item.id === next) ?? APP_ICONS[0];
    setAppIconChanging(true);
    setNotice(nativeAppIconSupported ? '휴대폰 앱 아이콘을 적용하고 확인하고 있어요…' : '웹에서는 미리보기 아이콘만 변경돼요.');
    try {
      if (nativeAppIconSupported) {
        const applied = await setNativeRouteAppIcon(next);
        setAppIcon(applied);
        localStorage.setItem('route-app-icon', applied);
        updateRouteFavicon(applied);
        setNotice(`“${option.label}” 아이콘을 적용했어요. 앱 서랍에서 확인해 주세요. 예전에 홈 화면에 고정한 아이콘이 그대로라면 그 바로가기를 지우고 앱 서랍에서 다시 꺼내세요.`);
      } else {
        setAppIcon(next);
        localStorage.setItem('route-app-icon', next);
        updateRouteFavicon(next);
        setNotice('웹 미리보기에 적용했어요. 실제 휴대폰 홈 화면 아이콘 변경은 Android 앱에서 사용할 수 있어요.');
      }
    } catch (cause) {
      console.error('[DANDULI app icon change]', cause);
      setNotice('홈 화면 앱 아이콘 변경에 실패했어요. 실제 사용 중인 아이콘을 다시 확인했어요.');
      try {
        const actual = await getNativeRouteAppIcon();
        if (actual) setAppIcon(actual);
      } catch (syncCause) {
        console.warn('[DANDULI app icon resync]', syncCause);
      }
    } finally {
      setAppIconChanging(false);
      setAppIconStateLoading(false);
    }
  };

  const addPack = (id: string) => {
    if (chatPreferences.ownedStickerPacks.includes(id)) return;
    updateChatStyle({ ownedStickerPacks: [...chatPreferences.ownedStickerPacks, id] });
    setNotice('이모티콘을 대화 보관함에 추가했어요.');
  };

  const updateChatStyle = (patch: Partial<ChatPreferences>) => {
    const next = { ...chatPreferences, ...patch };
    const uid = auth.currentUser?.uid ?? 'guest';
    setChatPreferences(next);
    saveChatPreferences(uid, next);
    window.dispatchEvent(new CustomEvent<ChatPreferences>('route-chat-preferences-change', { detail: next }));
    setNotice('채팅 꾸미기를 저장했어요.');
  };

  useEffect(() => {
    if (!settingsOpen) return;
    const handleBack = (event: Event) => {
      if (event.defaultPrevented || document.querySelector('.naner-room-open')) return;
      event.preventDefault();
      onCloseSettings();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onCloseSettings();
    };
    window.addEventListener('route-native-back', handleBack, true);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('route-native-back', handleBack, true);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [settingsOpen, onCloseSettings]);

  const openMoreSettingSheet = (next: MoreSheet) => {
    onCloseSettings();
    openSheet(next);
  };

  const updateBooleanSetting = (key: string, next: boolean, apply: (value: boolean) => void) => {
    localStorage.setItem(key, next ? '1' : '0');
    apply(next);
  };

  const openPasswordSettings = () => {
    onCloseSettings();
    void import('../../settings-hub')
      .then((module) => module.openPasswordChange())
      .catch(() => window.alert('비밀번호 변경 화면을 불러오지 못했어요. 다시 시도해 주세요.'));
  };

  const openChatDataSettings = () => {
    onCloseSettings();
    onNavigate({ area: 'chat', toolsSection: 'settings' });
  };

  const openStickerSettings = () => {
    onCloseSettings();
    onNavigate({ area: 'chat', toolsSection: 'stickers' });
  };

  const openFootprintSettings = () => {
    onCloseSettings();
    onNavigate({ area: 'location', tab: 'footprints' });
  };

  const openProfileEditor = () => {
    setSheet(null);
    onCloseSettings();
    onNavigate({ area: 'home', profileEditor: true });
  };

  const themeLabel = 'Modern Violet';

  if (settingsOpen) return <div className="more-settings-route" role="region" aria-label="설정">
    <header className="more-settings-screen-header">
      <button type="button" onClick={onCloseSettings} aria-label="더보기로 돌아가기"><ChevronLeft size={27} /></button>
      <strong>설정</strong>
      <span aria-hidden="true" />
    </header>
    <div className="more-settings-screen-body">
      <section className="more-settings-section" aria-labelledby="more-settings-account">
        <h2 id="more-settings-account">계정</h2>
        <div className="more-settings-group">
          <button type="button" onClick={() => { onCloseSettings(); onOpenSettings(); }}>
            <UserRound /><span><b>내 프로필</b><small>이름 · 생년월일 · 사진 · 별명 수정</small></span><ChevronRight />
          </button>
          <button type="button" onClick={() => { onCloseSettings(); onOpenSettings(); }}>
            <Heart /><span><b>상대방 프로필 및 연결</b><small>연결 상태 · 상대방 프로필 · 별명 관리</small></span><ChevronRight />
          </button>
          <button type="button" onClick={openPasswordSettings}>
            <KeyRound /><span><b>비밀번호 변경</b><small>현재 비밀번호 확인 후 새 비밀번호 설정</small></span><ChevronRight />
          </button>
        </div>
      </section>

      <section className="more-settings-section" aria-labelledby="more-settings-alerts">
        <h2 id="more-settings-alerts">알림</h2>
        <div className="more-settings-group">
          <button type="button" onClick={() => { onCloseSettings(); onOpenNotifications(); }}>
            <Bell /><span><b>알림 및 최근 활동</b><small>나너 알림 확인과 읽음 관리</small></span><ChevronRight />
          </button>
          <div className="more-settings-toggle-row">
            <Cake /><span><b>기념일 알림</b><small>다가오는 기념일과 약속 알림 받기</small></span>
            <button type="button" className={anniversaryAlerts ? 'more-settings-switch on' : 'more-settings-switch'} role="switch" aria-checked={anniversaryAlerts} aria-label="기념일 알림" onClick={() => updateBooleanSetting('route-setting-anniversary-alerts', !anniversaryAlerts, setAnniversaryAlerts)}><i /></button>
          </div>
          <div className="more-settings-toggle-row">
            <MessageSquareText /><span><b>채팅 알림</b><small>새 메시지 알림 받기</small></span>
            <button type="button" className={chatAlerts ? 'more-settings-switch on' : 'more-settings-switch'} role="switch" aria-checked={chatAlerts} aria-label="채팅 알림" onClick={() => updateBooleanSetting('route-setting-chat-alerts', !chatAlerts, setChatAlerts)}><i /></button>
          </div>
        </div>
      </section>

      <section className="more-settings-section" aria-labelledby="more-settings-chat-data">
        <h2 id="more-settings-chat-data">채팅 및 데이터</h2>
        <div className="more-settings-group">
          <button type="button" onClick={openChatDataSettings}>
            <DatabaseBackup /><span><b>대화내용 백업</b><small>대화내용 내보내기 및 불러오기</small></span><ChevronRight />
          </button>
          <button type="button" onClick={openChatDataSettings}>
            <Images /><span><b>사진 및 영상 화질</b><small>전송 화질과 데이터 사용량 설정</small></span><ChevronRight />
          </button>
          <button type="button" onClick={openStickerSettings}>
            <Sticker /><span><b>이모티콘</b><small>보유 이모티콘과 순서 관리</small></span><ChevronRight />
          </button>
        </div>
      </section>

      <section className="more-settings-section" aria-labelledby="more-settings-display">
        <h2 id="more-settings-display">화면 및 꾸미기</h2>
        <div className="more-settings-group">
          <button type="button" onClick={() => openMoreSettingSheet('theme')}>
            <Palette /><span><b>테마</b><small>{themeLabel} · 앱 전체 색상 변경</small></span><ChevronRight />
          </button>
          <button type="button" onClick={() => openMoreSettingSheet('app-icon')}>
            <Smartphone /><span><b>앱 아이콘</b><small>{activeIcon.label}</small></span><ChevronRight />
          </button>
          <div className="more-settings-toggle-row">
            <Moon /><span><b>시스템 다크 모드 연동</b><small>기기의 다크 · 라이트 모드에 자동으로 맞춤</small></span>
            <button type="button" className={systemDark ? 'more-settings-switch on' : 'more-settings-switch'} role="switch" aria-checked={systemDark} aria-label="시스템 다크 모드 연동" onClick={() => {
              const next = !systemDark;
              setSystemDark(next);
              setSystemDarkEnabled(next);
              localStorage.setItem(SYSTEM_DARK_KEY, next ? '1' : '0');
            }}><i /></button>
          </div>
        </div>
      </section>

      <section className="more-settings-section" aria-labelledby="more-settings-security">
        <h2 id="more-settings-security">개인 / 보안</h2>
        <div className="more-settings-group">
          <div className="more-settings-toggle-row">
            <LockKeyhole /><span><b>앱 잠금</b><small>나너 실행 시 잠금 사용</small></span>
            <button type="button" className={appLock ? 'more-settings-switch on' : 'more-settings-switch'} role="switch" aria-checked={appLock} aria-label="앱 잠금" onClick={() => updateBooleanSetting('route-setting-app-lock', !appLock, setAppLock)}><i /></button>
          </div>
          <button type="button" onClick={openFootprintSettings}>
            <MapPinned /><span><b>위치 및 발자취</b><small>위치 공유와 발자취 설정 확인</small></span><ChevronRight />
          </button>
        </div>
      </section>

      <section className="more-settings-section" aria-labelledby="more-settings-info">
        <h2 id="more-settings-info">앱 정보</h2>
        <div className="more-settings-group">
          <button type="button" onClick={() => window.alert('나너 멀티플랫폼 테스트 버전\nAndroid는 APK, iOS는 iOS 빌드, Windows는 EXE 설치 파일로 업데이트할 수 있어요.')}>
            <Info /><span><b>나너 정보</b><small>지원 플랫폼과 앱 정보 확인</small></span><ChevronRight />
          </button>
          <button type="button" onClick={() => window.alert('문제가 생기면 오류 화면과 함께 알려주세요. 나너 기능별로 확인할 수 있어요.')}>
            <CircleHelp /><span><b>도움말</b><small>자주 묻는 질문과 문제 해결</small></span><ChevronRight />
          </button>
        </div>
      </section>
    </div>
  </div>;

  return <div className={`route-more-services${expanded ? ' naner-more-workspace' : ''}`}><div className={expanded ? 'naner-more-list' : 'naner-compact-contents'}>
    <button type="button" className="naner-more-profile" onClick={openProfileEditor}><span className="naner-more-avatar">{profile.photoDataUrl ? <img src={profile.photoDataUrl} alt="" /> : (profile.name?.trim().slice(0, 1) || '나')}</span><span className="naner-more-profile-copy"><b>{profile.name || '내 프로필'}</b><small>{connected ? '커플 연결됨' : '커플 연결 전'}</small></span><ChevronRight size={18} /></button>
    <section className="more-feature-section more-customize-section" aria-labelledby="route-more-customize-title">
      <div className="more-section-title"><h2 id="route-more-customize-title">나/너 꾸미기</h2></div>
      <div className="more-customize-grid" aria-label="나너 꾸미기">
        <button type="button" aria-pressed={sheet === 'theme'} onClick={() => openSheet('theme')}><span className="more-customize-icon theme"><Palette /></span><b>테마</b><small>Modern Violet</small><ChevronRight className="naner-more-chevron" /></button>
        <button type="button" aria-pressed={sheet === 'app-icon'} onClick={() => openSheet('app-icon')}><span className="more-customize-icon icon"><Smartphone /></span><b>앱 아이콘</b><small>4가지 아이콘</small><ChevronRight className="naner-more-chevron" /></button>
        <button type="button" aria-pressed={sheet === 'emoticon'} onClick={() => openSheet('emoticon')}><span className="more-customize-icon emoticon"><Sticker /></span><b>이모티콘</b><small>보관함 · 팩</small><ChevronRight className="naner-more-chevron" /></button>
        <button type="button" aria-pressed={sheet === 'chat-style'} onClick={() => openSheet('chat-style')}><span className="more-customize-icon chat"><MessageCircle /></span><b>채팅 꾸미기</b><small>배경 · 글자 크기</small><ChevronRight className="naner-more-chevron" /></button>
        <button type="button" onClick={openProfileEditor}><span className="more-customize-icon profile"><UserRound /></span><b>프로필 · 배경</b><small>사진 · 배경 편집</small><ChevronRight className="naner-more-chevron" /></button>
        <button type="button" aria-pressed={sheet === 'store'} onClick={() => openSheet('store')}><span className="more-customize-icon store"><ShoppingBag /></span><b>나너 스토어</b><small>꾸미기 모아보기</small><ChevronRight className="naner-more-chevron" /></button>
      </div>
    </section>

    <section className="more-feature-section"><div className="more-section-title"><h2>서비스 관리</h2></div><div className="more-customize-grid">{tablet && <button type="button" aria-pressed={sheet === 'layout'} onClick={() => openSheet('layout')}><span className="more-customize-icon"><Smartphone /></span><b>화면 구성</b><small>자동 최적화</small><ChevronRight className="naner-more-chevron" /></button>}<button type="button" onClick={onOpenPageSettings}><span className="more-customize-icon"><KeyRound /></span><b>전체 설정</b><small>서비스 설정</small><ChevronRight className="naner-more-chevron" /></button><button type="button" onClick={onOpenSettings}><span className="more-customize-icon"><UserRound /></span><b>계정 및 보안</b><small>계정 관리</small><ChevronRight className="naner-more-chevron" /></button><button type="button" onClick={onOpenNotifications}><span className="more-customize-icon"><Bell /></span><b>알림</b><small>최근 활동</small><ChevronRight className="naner-more-chevron" /></button><button type="button" onClick={() => window.alert('나너 2.0 · 서비스 정보')}><span className="more-customize-icon"><Info /></span><b>앱 정보</b><small>나너 2.0</small><ChevronRight className="naner-more-chevron" /></button></div></section>

    </div>
    {(expanded || sheet) && <div className={expanded ? "naner-more-detail" : "more-sheet-backdrop"} role={expanded ? "region" : "dialog"} aria-label="꾸미기 상세" aria-modal={expanded ? undefined : true} onMouseDown={(event) => { if (!expanded && event.target === event.currentTarget) setSheet(null); }}>
      <section className="more-sheet">
        {!sheet && <div className="naner-panel-empty"><b>꾸미기</b><span>왼쪽 메뉴에서 설정할 항목을 선택해 주세요.</span></div>}
        {sheet === 'theme' && <><HeaderBar title="테마" onClose={() => setSheet(null)} /><p className="more-sheet-description">현재 나너의 기본 테마예요. 새 테마는 추후 추가돼요.</p><div className="naner-single-theme"><i aria-hidden="true" /><span><b>Modern Violet</b><small>화이트 · 차콜 · 바이올렛</small></span><b>사용 중</b></div>{tablet && <div className="naner-tablet-theme-preview"><h3>테마 미리보기</h3><div className="naner-theme-swatches" aria-label="Modern Violet 색상">{['#FFFFFF','#F5F5F7','#19191B','#635BEB','#EEECFF'].map(color => <i key={color} style={{ background: color }} title={color} />)}</div><div className="naner-theme-preview-messages" aria-label="예시 대화"><span>오늘도 좋은 하루 보내!</span><span>너도 좋은 하루 보내.</span></div></div>}</>}

        {sheet === 'layout' && <><HeaderBar title="화면 구성" onClose={() => setSheet(null)} /><p className="more-sheet-description">사용 가능한 화면 너비에 맞춰 나너가 자동으로 배치돼요.</p><div className="naner-layout-description"><div><b>현재 화면</b><span>{tablet ? '태블릿형' : expanded ? '폴더블형' : '일반폰형'}</span></div><div><b>메뉴바</b><span>{expanded ? '왼쪽' : '하단'}</span></div><div><b>대화방</b><span>{expanded ? '독립 화면 · 보관함 지원' : '독립 화면'}</span></div><div><b>화면 전환</b><span>자동</span></div></div></>}

        {sheet === 'app-icon' && <><HeaderBar title="앱 아이콘" onClose={() => setSheet(null)} /><p className="more-sheet-description">4가지 나너 아이콘 중 원하는 스타일을 선택해요. Android에서는 적용 결과를 확인한 뒤 알려드려요.</p>
          <div className="app-icon-current-status" role="status" aria-live="polite">
            <span className={`more-app-icon-preview ${appIcon} ${activeIcon.className} !grid place-items-center`}><AppIconGlyph id={appIcon} /></span>
            <span><small>{nativeAppIconSupported ? '현재 선택된 홈 화면 아이콘' : '현재 웹 미리보기'}</small><b>{appIconStateLoading ? '아이콘 확인 중…' : activeIcon.label}</b><em>{nativeAppIconSupported ? 'Android 런처 구성요소 기준 · 홈 화면 표시는 기기 런처가 갱신해요' : '홈 화면 변경은 Android 앱에서 가능'}</em></span>
          </div>
          <div className="app-icon-picker !grid !grid-cols-2 !gap-2.5 sm:!grid-cols-2" aria-busy={appIconChanging}>
          {APP_ICONS.map((item) => <button data-icon-id={item.id} type="button" key={item.id} aria-pressed={appIcon === item.id} disabled={appIconChanging} className={`${appIcon === item.id ? 'active' : ''} !min-w-0`} onClick={() => void chooseIcon(item.id)}><span className={`more-app-icon-preview ${item.id} ${item.className} !grid place-items-center`}><AppIconGlyph id={item.id} /></span><b className="!w-full !truncate !text-center">{item.label}</b>{appIcon === item.id && !appIconStateLoading && <small>✓ 현재 사용 중</small>}</button>)}
        </div></>}

        {sheet === 'emoticon' && <><HeaderBar title="이모티콘" onClose={() => setSheet(null)} /><p className="more-sheet-description">대화에서 사용할 나너 이모티콘을 모아보세요.</p><div className="emoticon-store">
          {STICKER_PACKS.map((pack) => <article key={pack.id}><div className="emoticon-preview">{pack.stickers.slice(0, 4).map((sticker) => { const id = stickerIdFromToken(sticker); return id ? <DanduliSticker key={sticker} id={id} /> : <span key={sticker}>{sticker}</span>; })}</div><div className="emoticon-copy"><b>{pack.name}</b><small>{pack.priceLabel === '기본' ? '기본 제공' : '무료'}</small></div><button type="button" disabled={chatPreferences.ownedStickerPacks.includes(pack.id)} onClick={() => addPack(pack.id)}>{chatPreferences.ownedStickerPacks.includes(pack.id) ? '사용 중' : '받기'}</button></article>)}
        </div></>}

        {sheet === 'chat-style' && <><HeaderBar title="채팅 꾸미기" onClose={() => setSheet(null)} /><p className="more-sheet-description">대화방의 배경과 메시지 글자 크기를 여기서 바로 바꿔요.</p>
          <div className="more-chat-style-block"><strong>대화방 배경</strong><div className="more-chat-backgrounds">{CHAT_BACKGROUNDS.map((item) => <button type="button" key={item.id} className={`${item.id} ${chatPreferences.background === item.id ? 'active' : ''}`} onClick={() => updateChatStyle({ background: item.id })}><i /><span>{item.label}</span></button>)}</div></div>
          <div className="more-chat-style-block"><strong>메시지 글자 크기</strong><div className="more-chat-fonts">{CHAT_FONT_SIZES.map((item) => <button type="button" key={item.id} className={chatPreferences.fontSize === item.id ? 'active' : ''} onClick={() => updateChatStyle({ fontSize: item.id })}>{item.label}</button>)}</div></div>
        </>}

        {sheet === 'store' && <><HeaderBar title="나너 스토어" onClose={() => setSheet(null)} /><p className="more-sheet-description">나너의 꾸미기 콘텐츠를 한곳에서 둘러봐요.</p><div className="more-store-hub">
          <button type="button" onClick={() => openSheet('emoticon')}><Sticker /><span><b>이모티콘 팩</b><small>대화에서 쓰는 감정 표현</small></span><em>보기</em></button>
          <button type="button" onClick={() => openSheet('app-icon')}><Smartphone /><span><b>앱 아이콘</b><small>홈 화면을 우리 스타일로</small></span><em>보기</em></button>
          <button type="button" onClick={() => openSheet('theme')}><Sparkles /><span><b>테마 컬렉션</b><small>앱 전체 분위기 바꾸기</small></span><em>보기</em></button>
        </div><p className="more-store-coming">새 테마는 디자인 검토 후 추가될 예정이에요.</p></>}

        {notice && <p className="more-sheet-notice">{notice}</p>}
      </section>
    </div>}
  </div>;
}

export function applySavedRouteAppIcon() {
  updateRouteFavicon(normalizeRouteAppIcon(localStorage.getItem('route-app-icon')));
}
