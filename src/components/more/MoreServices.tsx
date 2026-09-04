import { AppWindow, Bell, CalendarDays, Clock3, Heart, Image, MapPinned, MessageCircle, Palette, Settings, Smile, Sparkles, Trophy, UserRound, X } from 'lucide-react';
import { useMemo, useState } from 'react';

type MoreServiceId = 'profile' | 'notifications' | 'theme' | 'app-icon' | 'emoticon' | 'album' | 'anniversary' | 'record' | 'tier' | 'schedule' | 'date' | 'chat' | 'map' | 'footprint';
type AppIconId = 'route' | 'heart' | 'night' | 'cream';
type ThemeId = 'default' | 'lavender' | 'dark';

type Service = {
  id: MoreServiceId;
  label: string;
  icon: typeof Settings;
};

const SERVICES: Service[] = [
  { id: 'profile', label: '프로필', icon: UserRound },
  { id: 'notifications', label: '알림', icon: Bell },
  { id: 'theme', label: '테마', icon: Palette },
  { id: 'app-icon', label: '앱 아이콘', icon: AppWindow },
  { id: 'emoticon', label: '이모티콘', icon: Smile },
  { id: 'album', label: '앨범', icon: Image },
  { id: 'anniversary', label: '기념일', icon: Heart },
  { id: 'record', label: '기록', icon: Clock3 },
  { id: 'tier', label: '티어', icon: Trophy },
  { id: 'schedule', label: '일정', icon: CalendarDays },
  { id: 'date', label: '데이트', icon: Sparkles },
  { id: 'chat', label: '채팅', icon: MessageCircle },
  { id: 'map', label: '지도', icon: MapPinned },
  { id: 'footprint', label: '발자취', icon: MapPinned },
];

const APP_ICONS: { id: AppIconId; label: string; mark: string; className: string }[] = [
  { id: 'route', label: 'ROUTE 기본', mark: 'R', className: 'route' },
  { id: 'heart', label: '우리 하트', mark: '♥', className: 'heart' },
  { id: 'night', label: '밤의 ROUTE', mark: 'R', className: 'night' },
  { id: 'cream', label: '크림 ROUTE', mark: 'R', className: 'cream' },
];

const EMOTICON_PACKS = [
  { id: 'daily', name: '우리의 하루', preview: ['🥰', '😴', '🍚', '❤️'], price: '무료' },
  { id: 'mood', name: '오늘의 기분', preview: ['😆', '🥺', '😤', '🤭'], price: '1,500원' },
  { id: 'love', name: '사랑 가득', preview: ['💕', '💌', '😘', '🫶'], price: '1,500원' },
  { id: 'date', name: '데이트 가자', preview: ['🍿', '☕', '🚗', '🌙'], price: '2,000원' },
];

function clickBottomNav(label: string) {
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('.bottom-nav button'));
  buttons.find((button) => button.textContent?.trim() === label)?.click();
}

function clickHubTab(label: string) {
  clickBottomNav('추억');
  window.setTimeout(() => {
    const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('.hub-tabs button'));
    buttons.find((button) => button.textContent?.trim() === label)?.click();
  }, 80);
}

function clickLocationTab(label: string) {
  clickBottomNav('위치');
  window.setTimeout(() => {
    const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('.location-tabs button'));
    buttons.find((button) => button.textContent?.trim() === label)?.click();
  }, 80);
}

function updateFavicon(iconId: AppIconId) {
  const icon = APP_ICONS.find((item) => item.id === iconId) ?? APP_ICONS[0];
  const palette: Record<AppIconId, [string, string]> = {
    route: ['#1F2A44', '#FF6F61'],
    heart: ['#FF6F61', '#FFF7F5'],
    night: ['#171A2A', '#9699FF'],
    cream: ['#F4EBDD', '#1F2A44'],
  };
  const [bg, fg] = palette[icon.id];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="${bg}"/><text x="32" y="41" text-anchor="middle" font-family="Arial,sans-serif" font-size="32" font-weight="800" fill="${fg}">${icon.mark === '♥' ? '♥' : 'R'}</text></svg>`;
  const href = `data:image/svg+xml,${encodeURIComponent(svg)}`;
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.appendChild(link);
  }
  link.href = href;
}

function HeaderBar({ title, onClose }: { title: string; onClose: () => void }) {
  return <div className="more-sheet-head"><strong>{title}</strong><button type="button" onClick={onClose} aria-label="닫기"><X size={19} /></button></div>;
}

export function MoreServices() {
  const [sheet, setSheet] = useState<'theme' | 'app-icon' | 'emoticon' | null>(null);
  const [theme, setTheme] = useState<ThemeId>(() => {
    const saved = localStorage.getItem('meluni-theme');
    return saved === 'lavender' || saved === 'dark' ? saved : 'default';
  });
  const [appIcon, setAppIcon] = useState<AppIconId>(() => {
    const saved = localStorage.getItem('route-app-icon') as AppIconId | null;
    return APP_ICONS.some((item) => item.id === saved) ? saved! : 'route';
  });
  const [owned, setOwned] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('route-owned-emoticons') || '["daily"]') as string[]; } catch { return ['daily']; }
  });
  const [notice, setNotice] = useState('');

  const activeIconLabel = useMemo(() => APP_ICONS.find((item) => item.id === appIcon)?.label ?? 'ROUTE 기본', [appIcon]);

  const chooseTheme = (next: ThemeId) => {
    setTheme(next);
    localStorage.setItem('meluni-theme', next);
    document.documentElement.dataset.meluniTheme = next;
  };

  const chooseIcon = (next: AppIconId) => {
    setAppIcon(next);
    localStorage.setItem('route-app-icon', next);
    updateFavicon(next);
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
    if (id === 'profile') return document.querySelector<HTMLButtonElement>('.header-actions button[aria-label="설정"]')?.click();
    if (id === 'notifications') return document.querySelector<HTMLButtonElement>('.header-actions .notification-button')?.click();
    if (id === 'theme') return setSheet('theme');
    if (id === 'app-icon') return setSheet('app-icon');
    if (id === 'emoticon') return setSheet('emoticon');
    if (id === 'album') return clickHubTab('앨범');
    if (id === 'anniversary') return clickHubTab('기념일');
    if (id === 'record') return clickHubTab('기록');
    if (id === 'tier') return clickHubTab('티어');
    if (id === 'schedule') return clickHubTab('일정');
    if (id === 'date') return clickHubTab('데이트');
    if (id === 'chat') return clickBottomNav('채팅');
    if (id === 'map') return clickLocationTab('지도');
    if (id === 'footprint') return clickLocationTab('발자취');
  };

  return <div className="route-more-services">
    <section className="more-service-intro">
      <div><small>ROUTE 서비스</small><h1>더보기</h1><p>ROUTE 안에서 사용할 수 있는 기능을 한곳에 모았어요.</p></div>
      <span className={`more-app-icon-preview ${appIcon}`} aria-label={`현재 앱 아이콘 ${activeIconLabel}`}>{APP_ICONS.find((item) => item.id === appIcon)?.mark}</span>
    </section>

    <section className="more-service-grid" aria-label="ROUTE 전체 기능">
      {SERVICES.map(({ id, label, icon: Icon }) => <button type="button" key={id} onClick={() => openService(id)}>
        <span className="more-service-icon"><Icon size={25} strokeWidth={1.65} /></span><b>{label}</b>
      </button>)}
    </section>

    <section className="more-couple-strip"><span>♥</span><div><b>우리 둘의 ROUTE</b><small>앨범, 기록, 일정과 발자취를 이어가요.</small></div></section>

    {sheet && <div className="more-sheet-backdrop" role="dialog" aria-modal="true" onMouseDown={(event) => { if (event.target === event.currentTarget) setSheet(null); }}>
      <section className="more-sheet">
        {sheet === 'theme' && <><HeaderBar title="테마" onClose={() => setSheet(null)} /><div className="more-theme-picker">
          {(['default','lavender','dark'] as ThemeId[]).map((item) => <button type="button" key={item} className={theme === item ? 'active' : ''} onClick={() => chooseTheme(item)}><i className={item} /><span><b>{item === 'default' ? '기본' : item === 'lavender' ? '라벤더' : '다크'}</b><small>{item === 'default' ? '네이비 + 코랄' : item === 'lavender' ? '부드러운 보라' : '어두운 화면'}</small></span></button>)}
        </div></>}

        {sheet === 'app-icon' && <><HeaderBar title="앱 아이콘" onClose={() => setSheet(null)} /><p className="more-sheet-description">원하는 ROUTE 아이콘을 선택해요.</p><div className="app-icon-picker">
          {APP_ICONS.map((item) => <button type="button" key={item.id} className={appIcon === item.id ? 'active' : ''} onClick={() => chooseIcon(item.id)}><span className={`more-app-icon-preview ${item.className}`}>{item.mark}</span><b>{item.label}</b>{appIcon === item.id && <small>사용 중</small>}</button>)}
        </div></>}

        {sheet === 'emoticon' && <><HeaderBar title="이모티콘" onClose={() => setSheet(null)} /><p className="more-sheet-description">채팅에서 사용할 ROUTE 이모티콘을 모아보세요.</p><div className="emoticon-store">
          {EMOTICON_PACKS.map((pack) => <article key={pack.id}><div className="emoticon-preview">{pack.preview.map((emoji) => <span key={emoji}>{emoji}</span>)}</div><div className="emoticon-copy"><b>{pack.name}</b><small>{pack.price}</small></div><button type="button" disabled={owned.includes(pack.id)} onClick={() => addPack(pack.id, pack.price)}>{owned.includes(pack.id) ? '보유 중' : pack.price === '무료' ? '받기' : '구매하기'}</button></article>)}
        </div></>}
        {notice && <p className="more-sheet-notice">{notice}</p>}
      </section>
    </div>}
  </div>;
}

export function applySavedRouteAppIcon() {
  const saved = localStorage.getItem('route-app-icon') as AppIconId | null;
  updateFavicon(APP_ICONS.some((item) => item.id === saved) ? saved! : 'route');
}
