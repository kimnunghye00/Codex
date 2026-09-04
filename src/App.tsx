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
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(relationshipStartDate ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => setDraft(relationshipStartDate ?? ''), [relationshipStartDate]);
  const save = async () => {
    if (!draft || !connected) return;
    setSaving(true); setError('');
    try { await onSaveStartDate(draft); setEditing(false); } catch { setError('기념일을 저장하지 못했어요.'); } finally { setSaving(false); }
  };
  return <div className="page anniversary-page"><Header title="기념일" onSettings={onSettings} onNotifications={onNotifications} unreadCount={unreadCount} /><div className="anniversary-hero"><small>OUR TIME</small><h1>{relationshipStartDate ? `D+${coupleDay}` : '우리의 시작을 기록해요'}</h1><p>{relationshipStartDate ? formatShortDate(relationshipStartDate) : '사귄 날을 등록하면 기념일을 자동으로 계산해요.'}</p>{connected ? <button type="button" onClick={() => setEditing(true)}>{relationshipStartDate ? '시작일 수정' : '시작일 등록'}</button> : <button type="button" onClick={onSettings}>상대방 연결하기</button>}</div><div className="anniversary-list">{anniversaries.map((item) => <article key={item.id}><span>{item.icon}</span><div><b>{item.title}</b><small>{formatDate(item.date)}</small></div><strong>{daysUntil(item.date) === 0 ? 'D-DAY' : `D-${daysUntil(item.date)}`}</strong></article>)}</div>{editing && <div className="sheet-backdrop"><div className="anniversary-sheet"><div><small>RELATIONSHIP</small><h2>우리의 시작일</h2></div><input type="date" value={draft} onChange={(event) => setDraft(event.target.value)} />{error && <p>{error}</p>}<div><button onClick={() => setEditing(false)}>취소</button><button className="primary" disabled={!draft || saving} onClick={() => void save()}>{saving ? '저장 중...' : '저장'}</button></div></div></div>}</div>;
}

function MorePage({ onSettings, onNotifications, unreadCount }: { onSettings: () => void; onNotifications: () => void; unreadCount: number }) {
  return <div className="page more-page"><Header title="더보기" onSettings={onSettings} onNotifications={onNotifications} unreadCount={unreadCount} /><div className="more-menu"><button onClick={onSettings}><Settings size={19} /><span><b>앱 설정 및 테마</b><small>프로필, 테마, 알림 설정</small></span><ChevronRight size={17} /></button><button onClick={onNotifications}><Bell size={19} /><span><b>알림</b><small>최근 활동과 알림 확인</small></span><ChevronRight size={17} /></button></div></div>;
}

function BottomNav({ tab, setTab }: { tab: Tab; setTab: (tab: Tab) => void }) {
  const items: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: 'home', label: '홈', icon: <Home size={21} /> },
    { key: 'memories', label: '앨범', icon: <Image size={21} /> },
    { key: 'chat', label: '대화', icon: <MessageCircle size={21} /> },
    { key: 'location', label: '지도', icon: <MapPin size={21} /> },
    { key: 'more', label: '더보기', icon: <Ellipsis size={21} /> },
  ];
  return <nav className="bottom-nav">{items.map((item) => <button key={item.key} className={tab === item.key ? 'active' : ''} onClick={() => setTab(item.key)}>{item.icon}<span>{item.label}</span></button>)}</nav>;
}

export default App;
