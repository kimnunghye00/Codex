import { useEffect, useMemo, useRef, useState } from 'react';
import { ChatPage } from './components/chat/ChatPage';
import { MemoriesPage } from './components/memories/MemoriesPage';
import { LocationPage } from './components/location/LocationPage';
import { AccountSettings } from './components/auth/AccountSettings';
import { AuthFlow, Wordmark } from './components/auth/AuthFlow';
import { ProfileSetup } from './components/auth/ProfileSetup';
import { NotificationPanel } from './components/notifications/NotificationPanel';
import { CoupleHomeTools } from './components/home/CoupleHomeTools';
import { auth } from './lib/firebase';
import { getRealCoupleConnection, type RealCoupleConnection } from './lib/coupleConnection';
import { saveRelationshipStartDate, subscribeCoupleShared } from './lib/coupleShared';
import { onAuthStateChanged, type User } from 'firebase/auth';
import type { Memory, Message } from './types';
import { loadMemories, loadMessages, saveMemories, saveMessages } from './utils/storage';
import { displayName, loadProfile, type UserProfile } from './utils/profile';
import {
  loadNotifications,
  makeNotification,
  markAllNotificationsRead,
  saveNotifications,
  type AppNotification,
} from './utils/notifications';
import {
  Bell, ChevronRight, Ellipsis, Heart, Home,
  Image, MapPin, MapPinned, MessageCircle, Plus, Settings,
} from 'lucide-react';

type Tab = 'home' | 'chat' | 'memories' | 'location' | 'anniversary' | 'more';
type Anniversary = { id: string; icon: string; title: string; date: Date; recurring?: boolean };
type MeluniTheme = 'default' | 'lavender' | 'dark';

const DAY = 86_400_000;
const initialMemories: Memory[] = [];
const initialMessages: Message[] = [];

function atMidnight(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function parseDate(value?: string) {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function nextBirthday(profile: UserProfile, ownerLabel: string, today = atMidnight()): Anniversary | null {
  const birth = parseDate(profile.birthDate);
  if (!birth) return null;
  let date = new Date(today.getFullYear(), birth.getMonth(), birth.getDate());
  if (date < today) date = new Date(today.getFullYear() + 1, birth.getMonth(), birth.getDate());
  return { id: `birthday-${ownerLabel}`, icon: '🎂', title: `${displayName(profile)} 생일`, date, recurring: true };
}

function buildAnniversaries(profile: UserProfile, partnerProfile: UserProfile | null, relationshipStartDate?: string, today = atMidnight()): Anniversary[] {
  const events: Anniversary[] = [];
  const mine = nextBirthday(profile, 'me', today);
  const partner = partnerProfile ? nextBirthday(partnerProfile, 'partner', today) : null;
  if (mine) events.push(mine);
  if (partner) events.push(partner);

  const start = parseDate(relationshipStartDate);
  if (start) {
    const currentDay = Math.max(1, Math.floor((today.getTime() - start.getTime()) / DAY) + 1);
    if (currentDay < 365) {
      const nextHundred = Math.ceil(currentDay / 100) * 100;
      events.push({ id: `day-${nextHundred}`, icon: '✨', title: `우리의 ${nextHundred}일`, date: new Date(start.getTime() + (nextHundred - 1) * DAY) });
    } else {
      const nextThousand = Math.ceil(currentDay / 1000) * 1000;
      events.push({ id: `day-${nextThousand}`, icon: '✨', title: `우리의 ${nextThousand}일`, date: new Date(start.getTime() + (nextThousand - 1) * DAY) });
      let anniversaryYear = today.getFullYear() - start.getFullYear();
      let anniversaryDate = new Date(start.getFullYear() + anniversaryYear, start.getMonth(), start.getDate());
      if (anniversaryDate < today) {
        anniversaryYear += 1;
        anniversaryDate = new Date(start.getFullYear() + anniversaryYear, start.getMonth(), start.getDate());
      }
      events.push({ id: `year-${anniversaryYear}`, icon: '💞', title: `우리의 ${anniversaryYear}주년`, date: anniversaryDate, recurring: true });
    }
  }
  return events.filter((event) => event.date >= today).sort((a, b) => a.date.getTime() - b.date.getTime());
}

function daysUntil(date: Date, today = atMidnight()) {
  return Math.max(0, Math.ceil((atMidnight(date).getTime() - today.getTime()) / DAY));
}

function formatDate(date: Date) {
  return `${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일`;
}

function formatShortDate(value?: string) {
  return value ? value.replaceAll('-', '.') : '기념일 설정 필요';
}

function App() {
  const [user, setUser] = useState<User | null>(auth.currentUser);
  const [authReady, setAuthReady] = useState(false);
  const [profile, setProfile] = useState<UserProfile | null>(() => auth.currentUser ? loadProfile(auth.currentUser.uid) : null);
  const [connection, setConnection] = useState<RealCoupleConnection | null>(null);
  const [relationshipStartDate, setRelationshipStartDate] = useState<string>();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notifications, setNotifications] = useState<AppNotification[]>(() => auth.currentUser ? loadNotifications(auth.currentUser.uid) : []);
  const [tab, setTab] = useState<Tab>('home');
  const [messages, setMessages] = useState<Message[]>(() => loadMessages(initialMessages));
  const [memories, setMemories] = useState<Memory[]>(() => loadMemories(initialMemories));
  const [memoryToOpen, setMemoryToOpen] = useState<number>();
  const previousMessages = useRef(messages);
  const previousMemories = useRef(memories);
  const unreadCount = notifications.filter((item) => !item.read).length;
  const start = parseDate(relationshipStartDate);
  const coupleDay = start ? Math.max(1, Math.floor((atMidnight().getTime() - start.getTime()) / DAY) + 1) : 0;
  const anniversaries = useMemo(() => profile ? buildAnniversaries(profile, connection?.partnerProfile ?? null, relationshipStartDate) : [], [connection?.partnerProfile, profile, relationshipStartDate]);

  const addActivity = (input: Omit<AppNotification, 'id' | 'createdAt' | 'read'>) => {
    const uid = user?.uid ?? auth.currentUser?.uid;
    if (!uid) return;
    setNotifications((items) => {
      const next = [makeNotification(input), ...items].slice(0, 200);
      saveNotifications(uid, next);
      return next;
    });
  };

  useEffect(() => onAuthStateChanged(auth, (nextUser) => {
    setUser(nextUser);
    setProfile(nextUser ? loadProfile(nextUser.uid) : null);
    setNotifications(nextUser ? loadNotifications(nextUser.uid) : []);
    setAuthReady(true);
  }), []);

  useEffect(() => {
    if (!user) { setConnection(null); return; }
    let cancelled = false;
    const check = () => void getRealCoupleConnection(user.uid).then((next) => { if (!cancelled) setConnection(next); }).catch(() => { if (!cancelled) setConnection(null); });
    check();
    const timer = window.setInterval(check, 3000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [user?.uid]);

  useEffect(() => {
    if (!connection?.coupleId) { setRelationshipStartDate(undefined); return; }
    return subscribeCoupleShared(connection.coupleId, (shared) => setRelationshipStartDate(shared.relationshipStartDate));
  }, [connection?.coupleId]);

  useEffect(() => {
    saveMessages(messages);
    const before = previousMessages.current;
    const beforeById = new Map(before.map((message) => [message.id, message]));
    const afterById = new Map(messages.map((message) => [message.id, message]));
    messages.filter((message) => !beforeById.has(message.id)).forEach((message) => addActivity({ actor: message.sender === 'me' ? 'me' : 'partner', kind: 'chat', title: message.sender === 'me' ? '메시지를 보냈어요' : '새 메시지가 왔어요', detail: message.type === 'image' ? '사진을 보냈어요.' : message.text?.slice(0, 70) }));
    before.filter((message) => !afterById.has(message.id)).forEach((message) => addActivity({ actor: 'me', kind: 'chat', title: '메시지를 삭제했어요', detail: message.text?.slice(0, 60) }));
    previousMessages.current = messages;
  }, [messages]);

  useEffect(() => {
    saveMemories(memories);
    const before = previousMemories.current;
    const beforeById = new Map(before.map((memory) => [memory.id, memory]));
    const afterById = new Map(memories.map((memory) => [memory.id, memory]));
    memories.filter((memory) => !beforeById.has(memory.id)).forEach((memory) => addActivity({ actor: memory.createdBy === 'me' ? 'me' : 'partner', kind: 'memory', title: '새 추억을 추가했어요', detail: memory.title }));
    before.filter((memory) => !afterById.has(memory.id)).forEach((memory) => addActivity({ actor: 'me', kind: 'memory', title: '추억을 삭제했어요', detail: memory.title }));
    previousMemories.current = memories;
  }, [memories]);

  const handleProfileChange = (next: UserProfile) => { setProfile(next); };
  const openNotifications = () => {
    if (!user) return;
    const next = markAllNotificationsRead(notifications);
    setNotifications(next); saveNotifications(user.uid, next); setNotificationsOpen(true);
  };
  const clearNotifications = () => { if (user) { setNotifications([]); saveNotifications(user.uid, []); } };
  const saveStartDate = async (value: string) => {
    if (!connection?.coupleId) throw new Error('not-connected');
    await saveRelationshipStartDate(connection.coupleId, value);
    setRelationshipStartDate(value);
  };

  if (!authReady) return <div className="app-shell auth-loading"><Wordmark /><div className="loading-mark" /><p>ROUTE를 준비하고 있어요</p></div>;
  if (!user) return <AuthFlow />;
  if (!profile) return <ProfileSetup user={user} onComplete={handleProfileChange} />;

  const AppHeader = ({ title }: { title?: string }) => <Header title={title} onSettings={() => setSettingsOpen(true)} onNotifications={openNotifications} unreadCount={unreadCount} />;
  return <>
    <div className="app-shell"><main>
      {tab === 'home' && <HomePage uid={user.uid} profile={profile} connection={connection} relationshipStartDate={relationshipStartDate} coupleDay={coupleDay} anniversaries={anniversaries} memories={memories} messages={messages} onNavigate={setTab} onOpenMemory={(id) => { setMemoryToOpen(id); setTab('memories'); }} onSettings={() => setSettingsOpen(true)} onNotifications={openNotifications} unreadCount={unreadCount} />}
      {tab === 'chat' && <ChatPage Header={AppHeader} messages={messages} setMessages={setMessages} connection={connection} />}
      {tab === 'memories' && <MemoriesPage Header={AppHeader} memories={memories} setMemories={setMemories} initialMemoryId={memoryToOpen} onClearInitial={() => setMemoryToOpen(undefined)} />}
      {tab === 'location' && <LocationPage Header={AppHeader} connection={connection} onActivity={(title, detail) => addActivity({ actor: 'me', kind: 'location', title, detail })} />}
      {tab === 'anniversary' && <AnniversaryPage connected={Boolean(connection)} relationshipStartDate={relationshipStartDate} coupleDay={coupleDay} anniversaries={anniversaries} onSaveStartDate={saveStartDate} onSettings={() => setSettingsOpen(true)} onNotifications={openNotifications} unreadCount={unreadCount} />}
      {tab === 'more' && <MorePage onSettings={() => setSettingsOpen(true)} onNotifications={openNotifications} unreadCount={unreadCount} />}
    </main><BottomNav tab={tab} setTab={setTab} /></div>
    {settingsOpen && <AccountSettings user={user} profile={profile} onProfileChange={handleProfileChange} onClose={() => setSettingsOpen(false)} />}
    {notificationsOpen && <NotificationPanel items={notifications} onClose={() => setNotificationsOpen(false)} onReadAll={() => { const next = markAllNotificationsRead(notifications); setNotifications(next); saveNotifications(user.uid, next); }} onClear={clearNotifications} />}
  </>;
}

function Header({ title, onSettings, onNotifications, unreadCount }: { title?: string; onSettings: () => void; onNotifications: () => void; unreadCount: number }) {
  return <header className="topbar"><div className="brand"><Wordmark />{title && <span className="page-title">{title}</span>}</div><div className="header-actions"><button className="notification-button" aria-label={`알림 ${unreadCount ? `${unreadCount}개` : ''}`} onClick={onNotifications}><Bell size={20} />{unreadCount > 0 && <em className="notification-count">{unreadCount > 99 ? '99+' : unreadCount}</em>}</button><button aria-label="설정" onClick={onSettings}><Settings size={20} /></button></div></header>;
}

function HomePage({ uid, profile, connection, relationshipStartDate, coupleDay, anniversaries, memories, messages, onNavigate, onOpenMemory, onSettings, onNotifications, unreadCount }: { uid: string; profile: UserProfile; connection: RealCoupleConnection | null; relationshipStartDate?: string; coupleDay: number; anniversaries: Anniversary[]; memories: Memory[]; messages: Message[]; onNavigate: (tab: Tab) => void; onOpenMemory: (id: number) => void; onSettings: () => void; onNotifications: () => void; unreadCount: number }) {
  const nearest = anniversaries[0];
  const latestMemory = memories[0];
  const latestPartnerMessage = [...messages].reverse().find((message) => message.sender === 'partner');
  const partnerProfile = connection?.partnerProfile ?? null;
  const partnerName = partnerProfile ? displayName(partnerProfile) : '상대방';
  const partnerInitial = partnerName.slice(0, 1) || '상';

  return <div className="page home-page home-dashboard">
    <Header onSettings={onSettings} onNotifications={onNotifications} unreadCount={unreadCount} />
    <CoupleHomeTools uid={uid} profile={profile} connection={connection} relationshipStartDate={relationshipStartDate} onOpenMyProfile={onSettings} onOpenConnect={onSettings} />
    <div className="home-dashboard-grid">
      <button className="home-map-card" type="button" aria-label="우리의 지도 열기" onClick={() => onNavigate('location')}>
        <div className="home-map-grid-lines" /><span className="home-map-road road-a" /><span className="home-map-road road-b" /><span className="home-map-river" />
        <span className="home-map-place place-office">ROUTE</span><span className="home-map-place place-cafe">카페</span><span className="home-map-place place-park">공원</span>
        <div className="home-location-status"><MapPin size={16} /><span><b>{connection ? `${partnerName} · 위치 공유` : '상대방 연결 전'}</b><small>{connection ? '최근 위치를 확인해보세요' : '설정에서 상대방을 연결해 주세요'}</small></span></div>
        <div className="home-map-person"><span className="home-map-halo" /><span className="home-map-avatar">{partnerInitial}</span><MapPin size={25} fill="currentColor" /></div><div className="home-map-locate"><MapPinned size={20} /></div>
      </button>
      <div className="home-dashboard-side">
        <button className="home-time-card" type="button" onClick={() => onNavigate('anniversary')}>
          <div className="home-card-title"><span>우리의 시간</span><Heart size={16} fill="currentColor" /></div>
          <div className="home-time-block"><small>{relationshipStartDate ? '사귄 지' : '기념일'}</small><strong>{relationshipStartDate ? `D+${coupleDay}` : '설정하기'}</strong><em>{formatShortDate(relationshipStartDate)}</em></div>
          <div className="home-time-divider" />
          {nearest ? <div className="home-time-block upcoming-time"><small>다가오는 날</small><strong>D-{daysUntil(nearest.date)}</strong><em>{nearest.title}</em></div> : <div className="home-time-block upcoming-time"><small>다가오는 날</small><strong>-</strong><em>생일과 기념일을 준비하고 있어요</em></div>}
        </button>
        {latestMemory ? <button className="home-photo-card" type="button" onClick={() => onOpenMemory(latestMemory.id)}><img src={latestMemory.images[0]} alt={latestMemory.title} /><span className="home-photo-shade" /><span className="home-photo-copy"><small>최근 추억</small><strong>{latestMemory.title}</strong><em>{latestMemory.date.replaceAll('-', '.')}</em></span><span className="home-photo-heart"><Heart size={16} /></span></button> : <button className="home-photo-card empty" type="button" onClick={() => onNavigate('memories')}><Image size={24} /><span>첫 추억을 남겨보세요</span></button>}
        <button className="home-chat-card" type="button" onClick={() => onNavigate('chat')}><span className="home-chat-head"><b>최근 대화</b><ChevronRight size={17} /></span><span className="home-chat-preview"><span className="home-chat-avatar">{partnerInitial}</span><span className="home-chat-copy"><b>{partnerName}</b><small>{latestPartnerMessage?.text ?? '아직 대화가 없어요.'}</small></span></span></button>
      </div>
    </div>
  </div>;
}

function AnniversaryPage({ connected, relationshipStartDate, coupleDay, anniversaries, onSaveStartDate, onSettings, onNotifications, unreadCount }: { connected: boolean; relationshipStartDate?: string; coupleDay: number; anniversaries: Anniversary[]; onSaveStartDate: (value: string) => Promise<void>; onSettings: () => void; onNotifications: () => void; unreadCount: number }) {
  const [date, setDate] = useState(relationshipStartDate ?? '');
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState('');
  useEffect(() => setDate(relationshipStartDate ?? ''), [relationshipStartDate]);
  const save = async () => {
    if (!date) return setFeedback('서로 만나기 시작한 날짜를 입력해 주세요.');
    setSaving(true); setFeedback('');
    try { await onSaveStartDate(date); setFeedback('우리의 기념일을 저장했어요. 상대방 화면에도 함께 반영돼요.'); }
    catch { setFeedback('기념일 저장 중 문제가 생겼어요.'); }
    finally { setSaving(false); }
  };
  return <div className="page"><Header title="기념일" onSettings={onSettings} onNotifications={onNotifications} unreadCount={unreadCount} />
    <div className="title-block"><small>OUR DAYS</small><h1>함께 기다리는 날</h1><p>우리 둘의 생일과 소중한 기념일을 한곳에서 확인해요.</p></div>
    {connected && !relationshipStartDate && <div className="anniversary-card"><div className="rings"><Heart fill="currentColor" /></div><span>처음 한 번만 설정해 주세요</span><strong>우리의 시작일</strong><p>한 사람이 저장하면 두 사람에게 동일하게 적용돼요.</p><label style={{display:'grid',gap:8,marginTop:14}}>서로 만나기 시작한 날짜<input type="date" value={date} max={new Date().toISOString().slice(0,10)} onChange={(e) => setDate(e.target.value)} /></label><button className="primary" type="button" disabled={saving || !date} onClick={() => void save()}>{saving ? '저장 중...' : '기념일 저장'}</button>{feedback && <p>{feedback}</p>}</div>}
    {!connected && <div className="anniversary-card"><div className="rings"><Heart fill="currentColor" /></div><span>상대방 연결 필요</span><strong>둘만의 기념일</strong><p>설정에서 상대방 계정을 먼저 연결하면 생일과 기념일을 함께 볼 수 있어요.</p></div>}
    {relationshipStartDate && <div className="anniversary-card"><div className="rings"><Heart fill="currentColor" /></div><span>우리의 시간</span><strong>{coupleDay}번째 날</strong><p>{relationshipStartDate.replaceAll('-', '.')}부터 · D+{coupleDay}</p></div>}
    <div className="section-head upcoming"><h2>다가오는 기념일</h2><button onClick={() => connected && !relationshipStartDate && void save()}><Plus size={16} />기념일</button></div>
    <div className="event-list">{anniversaries.map((event) => <button className="event" key={event.id}><div className="event-icon">{event.icon}</div><div><b>{event.title}</b><span>{formatDate(event.date)}</span></div><em>D-{daysUntil(event.date)}</em><ChevronRight size={17} /></button>)}</div>
  </div>;
}

function MorePage({ onSettings, onNotifications, unreadCount }: { onSettings: () => void; onNotifications: () => void; unreadCount: number }) {
  const [theme, setTheme] = useState<MeluniTheme>(() => { const saved = localStorage.getItem('meluni-theme'); return saved === 'lavender' || saved === 'dark' ? saved : 'default'; });
  useEffect(() => { document.documentElement.dataset.meluniTheme = theme; localStorage.setItem('meluni-theme', theme); }, [theme]);
  return <div className="page more-page"><Header title="더보기" onSettings={onSettings} onNotifications={onNotifications} unreadCount={unreadCount} /><div className="more-scroll">
    <section className="more-hero"><div className="more-hero-copy"><small>ROUTE SETTINGS</small><h1>우리에게 맞게 꾸며요</h1><p>프로필부터 테마, 알림과 앱 설정까지 한곳에서 관리할 수 있어요.</p></div><div className="more-hero-icon"><Settings size={25} /></div></section>
    <section className="more-section"><div className="more-section-head"><h2>빠른 메뉴</h2><span>자주 쓰는 설정</span></div><div className="more-grid"><button className="more-grid-button" type="button" onClick={onSettings}><span className="more-icon"><Settings size={18} /></span><b>프로필</b></button><button className="more-grid-button" type="button" onClick={onNotifications}><span className="more-icon"><Bell size={18} />{unreadCount > 0 && <em className="more-badge">{unreadCount > 9 ? '9+' : unreadCount}</em>}</span><b>알림</b></button><button className="more-grid-button" type="button" onClick={() => document.getElementById('theme-settings')?.scrollIntoView({ behavior: 'smooth', block: 'center' })}><span className="more-icon"><Heart size={18} /></span><b>테마</b></button><button className="more-grid-button" type="button"><span className="more-icon"><MapPinned size={18} /></span><b>앱 설정</b></button></div></section>
    <section className="more-section" id="theme-settings"><div className="more-section-head"><h2>테마</h2><span>즉시 적용돼요</span></div><div className="theme-card"><div className="theme-options"><button className={`theme-option ${theme === 'default' ? 'active' : ''}`} type="button" onClick={() => setTheme('default')}><i className="theme-swatch default" /><span><b>기본</b><small>네이비 + 코랄</small></span></button><button className={`theme-option ${theme === 'lavender' ? 'active' : ''}`} type="button" onClick={() => setTheme('lavender')}><i className="theme-swatch lavender" /><span><b>라벤더</b><small>부드러운 보라</small></span></button><button className={`theme-option ${theme === 'dark' ? 'active' : ''}`} type="button" onClick={() => setTheme('dark')}><i className="theme-swatch dark" /><span><b>다크</b><small>어두운 화면</small></span></button></div></div></section>
    <section className="more-section"><div className="more-section-head"><h2>앱 및 계정</h2><span>ROUTE 관리</span></div><div className="more-list"><button className="more-list-button" type="button" onClick={onSettings}><span className="more-list-icon"><Settings size={17} /></span><span className="more-list-copy"><b>계정 및 프로필 설정</b><small>이름, 생년월일, 이메일과 프로필 사진</small></span><ChevronRight size={17} /></button><button className="more-list-button" type="button" onClick={onNotifications}><span className="more-list-icon"><Bell size={17} /></span><span className="more-list-copy"><b>알림 설정</b><small>최근 알림 확인 및 알림 관리</small></span><ChevronRight size={17} /></button><button className="more-list-button" type="button"><span className="more-list-icon"><MessageCircle size={17} /></span><span className="more-list-copy"><b>채팅 및 데이터</b><small>채팅 저장, 사진과 데이터 관리</small></span><ChevronRight size={17} /></button><button className="more-list-button" type="button"><span className="more-list-icon"><Home size={17} /></span><span className="more-list-copy"><b>앱 정보 및 도움말</b><small>ROUTE 버전, 이용 안내와 문의</small></span><ChevronRight size={17} /></button></div></section>
  </div></div>;
}

function BottomNav({ tab, setTab }: { tab: Tab; setTab: (tab: Tab) => void }) {
  const items: [Tab, string, typeof Home][] = [['home', '홈', Home], ['memories', '추억', Image], ['chat', '채팅', MessageCircle], ['location', '위치', MapPinned], ['more', '더보기', Ellipsis]];
  return <nav className="bottom-nav" aria-label="주요 메뉴">{items.map(([id, label, Icon]) => <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}><span className="nav-icon"><Icon size={21} strokeWidth={tab === id ? 2.4 : 1.8} /></span><span>{label}</span></button>)}</nav>;
}

export default App;
