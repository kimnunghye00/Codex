import { Heart, Image, MapPinned, MessageCircle, Settings, Smartphone, Sparkles, Trophy, Clock3, CalendarDays, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { normalizeRouteAppIcon, updateRouteFavicon, type RouteAppIconId } from '../../utils/appIcon';
import type { HubTabId } from '../memories/MemoriesPage';
import type { LocationTabId } from '../location/LocationPage';

type MoreServiceId = 'album' | 'anniversary' | 'record' | 'tier' | 'schedule' | 'date' | 'chat' | 'map' | 'footprint' | 'settings';
type AppIconId = RouteAppIconId;
type ThemeId = 'default' | 'lavender' | 'dark';
type MoreSheet = 'theme' | 'app-icon' | 'emoticon';

export type MoreNavigationTarget =
  | { area: 'chat' }
  | { area: 'memories'; tab: HubTabId }
  | { area: 'location'; tab: LocationTabId };

type Service = {
  id: MoreServiceId;
  label: string;
  icon: typeof Settings;
};

type AppIconOption = {
  id: AppIconId;
  label: string;
  className: string;
};

const SERVICES: Service[] = [
  { id: 'album', label: '추억', icon: Image },
  { id: 'anniversary', label: '기념일', icon: Heart },
  { id: 'record', label: '기록', icon: Clock3 },
  { id: 'tier', label: '티어', icon: Trophy },
  { id: 'schedule', label: '일정', icon: CalendarDays },
  { id: 'date', label: '약속', icon: Sparkles },
  { id: 'chat', label: '대화', icon: MessageCircle },
  { id: 'map', label: '지도', icon: MapPinned },
  { id: 'footprint', label: '발자취', icon: MapPinned },
  { id: 'settings', label: '설정', icon: Settings },
];

const APP_ICONS: AppIconOption[] = [
  { id: 'route', label: 'ROUTE 시그니처', className: '!bg-[#28314A] !text-[#FFF9F6]' },
  { id: 'heart', label: '커플 하트', className: '!bg-[#FF7266] !text-[#FFF9F6]' },
  { id: 'pin-duo', label: '핀 듀오', className: '!bg-[#F7F1E7] !text-[#3D405B]' },
  { id: 'heart-chat', label: '하트 톡', className: '!bg-[#454866] !text-[#FFF9F6]' },
  { id: 'our-route', label: '우리의 경로', className: '!bg-[#E8F1EC] !text-[#3D405B]' },
  { id: 'night', label: 'ROUTE 나이트', className: '!bg-[#171A2A] !text-[#999CFF]' },
  { id: 'cream', label: 'ROUTE 크림', className: '!bg-[#F4EBDD] !text-[#29324A]' },
  { id: 'minimal', label: 'ROUTE 미니멀', className: '!bg-[#FCFCFA] !text-[#30354D]' },
];

const EMOTICON_PACKS = [
  { id: 'daily', name: '우리의 하루', preview: ['🥰', '😴', '🍚', '❤️'], price: '무료' },
  { id: 'mood', name: '오늘의 기분', preview: ['😆', '🥺', '😤', '🤭'], price: '1,500원' },
  { id: 'love', name: '사랑 가득', preview: ['💕', '💌', '😘', '🫶'], price: '1,500원' },
  { id: 'date', name: '데이트 가자', preview: ['🍿', '☕', '🚗', '🌙'], price: '2,000원' },
];

function AppIconGlyph({ id }: { id: AppIconId }) {
  if (id === 'heart') return <Heart size={25} fill="currentColor" strokeWidth={1.6} />;
  if (id === 'pin-duo') return <span className="relative block h-8 w-9" aria-hidden="true"><MapPinned className="absolute left-0 top-0" size={23} strokeWidth={2.2} /><MapPinned className="absolute bottom-0 right-0 !text-[#E07A5F]" size={21} strokeWidth={2.2} /></span>;
  if (id === 'heart-chat') return <span className="relative grid place-items-center" aria-hidden="true"><MessageCircle size={29} strokeWidth={1.8} /><Heart className="absolute !text-[#FF8075]" size={12} fill="currentColor" strokeWidth={1.5} /></span>;
  if (id === 'our-route') return <span className="relative block h-8 w-9" aria-hidden="true"><span className="absolute left-1 top-5 h-0.5 w-7 -rotate-[24deg] rounded-full bg-current" /><span className="absolute left-0.5 top-5 size-2 rounded-full !bg-[#E07A5F]" /><span className="absolute right-0.5 top-1 size-2 rounded-full bg-current" /><Heart className="absolute bottom-0 right-2 !text-[#E07A5F]" size={11} fill="currentColor" /></span>;
  if (id === 'night') return <span className="text-[30px] font-medium leading-none" aria-hidden="true">☾</span>;
  if (id === 'cream') return <span className="grid size-9 place-items-center rounded-full border border-[#D8CBBB] bg-[#FFF9F1] text-[19px] font-black" aria-hidden="true">R</span>;
  if (id === 'minimal') return <span className="relative text-[24px] font-black leading-none" aria-hidden="true">R<span className="absolute -right-2 -top-1 size-2 rounded-full bg-[#E07A5F]" /></span>;
  return <span className="relative text-[24px] font-black leading-none" aria-hidden="true">R<span className="absolute -right-2 -top-1 size-2 rounded-full bg-[#FF786B]" /></span>;
}

function HeaderBar({ title, onClose }: { title: string; onClose: () => void }) {
  return <div className="more-sheet-head"><strong>{title}</strong><button type="button" onClick={onClose} aria-label="닫기"><X size={19} /></button></div>;
}

export function MoreServices({ onOpenSettings, onOpenNotifications: _onOpenNotifications, onNavigate }: {
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
  const [notice, setNotice] = useState('');

  const activeIcon = useMemo(() => APP_ICONS.find((item) => item.id === appIcon) ?? APP_ICONS[0], [appIcon]);

  useEffect(() => {
    const openSheet = (event: Event) => {
      const requested = (event as CustomEvent<MoreSheet>).detail;
      if (requested === 'theme' || requested === 'app-icon' || requested === 'emoticon') {
        setNotice('');
        setSheet(requested);
      }
    };
    window.addEventListener('route-open-more-sheet', openSheet);
    return () => window.removeEventListener('route-open-more-sheet', openSheet);
  }, []);

  const chooseTheme = (next: ThemeId) => {
    setTheme(next);
    localStorage.setItem('meluni-theme', next);
    document.documentElement.dataset.meluniTheme = next;
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

  const openService = (id: MoreServiceId) => {
    setNotice('');
    if (id === 'album') return onNavigate({ area: 'memories', tab: 'album' });
    if (id === 'anniversary') return onNavigate({ area: 'memories', tab: 'anniversary' });
    if (id === 'record') return onNavigate({ area: 'memories', tab: 'record' });
    if (id === 'tier') return onNavigate({ area: 'memories', tab: 'tier' });
    if (id === 'schedule') return onNavigate({ area: 'memories', tab: 'schedule' });
    if (id === 'date') return onNavigate({ area: 'memories', tab: 'date' });
    if (id === 'chat') return onNavigate({ area: 'chat' });
    if (id === 'map') return onNavigate({ area: 'location', tab: 'map' });
    if (id === 'footprint') return onNavigate({ area: 'location', tab: 'footprints' });
    onOpenSettings();
  };

  return <div className="route-more-services">
    <section className="more-service-intro">
      <div><small>ROUTE 서비스</small><h1>더보기</h1><p>ROUTE의 주요 기능과 설정을 한곳에서 열 수 있어요.</p></div>
      <span className={`more-app-icon-preview ${appIcon} ${activeIcon.className} !grid place-items-center`} aria-label={`현재 앱 아이콘 ${activeIcon.label}`}><AppIconGlyph id={appIcon} /></span>
    </section>

    <section className="more-feature-section" aria-labelledby="route-more-features-title">
      <div className="more-section-title"><small>ROUTE 기능</small><h2 id="route-more-features-title">자주 쓰는 기능</h2></div>
      <div className="more-service-grid" aria-label="ROUTE 주요 기능">
        {SERVICES.map(({ id, label, icon: Icon }) => <button type="button" key={id} onClick={() => openService(id)}>
          <span className="more-service-icon"><Icon size={25} strokeWidth={1.65} /></span><b>{label}</b>
        </button>)}
      </div>
    </section>

    <section className="more-couple-strip"><span>♥</span><div><b>우리 둘의 ROUTE</b><small>추억, 기록, 일정과 발자취를 이어가요.</small></div></section>

    {sheet && <div className="more-sheet-backdrop" role="dialog" aria-modal="true" onMouseDown={(event) => { if (event.target === event.currentTarget) setSheet(null); }}>
      <section className="more-sheet">
        {sheet === 'theme' && <><HeaderBar title="테마" onClose={() => setSheet(null)} /><div className="more-theme-picker">
          {(['default','lavender','dark'] as ThemeId[]).map((item) => <button type="button" key={item} className={theme === item ? 'active' : ''} onClick={() => chooseTheme(item)}><i className={item} /><span><b>{item === 'default' ? '기본' : item === 'lavender' ? '라벤더' : '다크'}</b><small>{item === 'default' ? '네이비 + 코랄' : item === 'lavender' ? '부드러운 보라' : '어두운 화면'}</small></span></button>)}
        </div></>}

        {sheet === 'app-icon' && <><HeaderBar title="앱 아이콘" onClose={() => setSheet(null)} /><p className="more-sheet-description">새로 디자인한 8가지 ROUTE 아이콘 중 원하는 스타일을 선택해요.</p><div className="app-icon-picker !grid !grid-cols-2 !gap-2.5 sm:!grid-cols-4">
          {APP_ICONS.map((item) => <button data-icon-id={item.id} type="button" key={item.id} className={`${appIcon === item.id ? 'active' : ''} !min-w-0`} onClick={() => chooseIcon(item.id)}><span className={`more-app-icon-preview ${item.id} ${item.className} !grid place-items-center`}><AppIconGlyph id={item.id} /></span><b className="!w-full !truncate !text-center">{item.label}</b>{appIcon === item.id && <small>사용 중</small>}</button>)}
        </div></>}

        {sheet === 'emoticon' && <><HeaderBar title="이모티콘" onClose={() => setSheet(null)} /><p className="more-sheet-description">대화에서 사용할 ROUTE 이모티콘을 모아보세요.</p><div className="emoticon-store">
          {EMOTICON_PACKS.map((pack) => <article key={pack.id}><div className="emoticon-preview">{pack.preview.map((emoji) => <span key={emoji}>{emoji}</span>)}</div><div className="emoticon-copy"><b>{pack.name}</b><small>{pack.price}</small></div><button type="button" disabled={owned.includes(pack.id)} onClick={() => addPack(pack.id, pack.price)}>{owned.includes(pack.id) ? '보유 중' : pack.price === '무료' ? '받기' : '구매하기'}</button></article>)}
        </div></>}
        {notice && <p className="more-sheet-notice">{notice}</p>}
      </section>
    </div>}
  </div>;
}

export function applySavedRouteAppIcon() {
  updateRouteFavicon(normalizeRouteAppIcon(localStorage.getItem('route-app-icon')));
}
