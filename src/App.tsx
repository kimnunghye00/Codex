import { useEffect, useMemo, useRef, useState } from 'react';
import { ChatPage } from './components/chat/ChatPage';
import { StableMemoriesPage, type HubTabId } from './components/memories/StableMemoriesPage';
import { StableLocationPage, type LocationTabId } from './components/location/StableLocationPage';
import { AccountSettings } from './components/auth/AccountSettings';
import { AuthFlow, Wordmark } from './components/auth/AuthFlow';
import { ProfileSetup } from './components/auth/ProfileSetup';
import { NotificationPanel } from './components/notifications/NotificationPanel';
import { CoupleHomeTools } from './components/home/CoupleHomeTools';
import { MoreServices, type MoreNavigationTarget } from './components/more/MoreServices';
import { AppHeader as SharedAppHeader } from './components/navigation/AppHeader';
import { BottomNav, type AppTab } from './components/navigation/BottomNav';
import { auth } from './lib/firebase';
import { getRealCoupleConnection, type RealCoupleConnection } from './lib/coupleConnection';
import { saveRelationshipStartDate, subscribeCoupleShared } from './lib/coupleShared';
import { onAuthStateChanged, type User } from 'firebase/auth';
import type { Memory, MemoryDraft, Message } from './types';
import { loadMemories, loadMessages, saveMemories, saveMessages } from './utils/storage';
import { displayName, loadProfile, type UserProfile } from './utils/profile';
import {
  loadNotifications,
  makeNotification,
  markAllNotificationsRead,
  saveNotifications,
  type AppNotification,
} from './utils/notifications';
import { ChevronRight, Heart, Image, MapPin, MapPinned, Plus } from 'lucide-react';

type Tab = AppTab;
type Anniversary = { id: string; icon: string; title: string; date: Date; recurring?: boolean };

const DAY = 86_400_000;
const initialMemories: Memory[] = [];
const initialMessages: Message[] = [];
const COUPLE_SPECIAL_DAYS = [
  { month: 1, day: 14, icon: '📔', title: '다이어리데이' },
  { month: 2, day: 14, icon: '💝', title: '발렌타인데이' },
  { month: 3, day: 14, icon: '🤍', title: '화이트데이' },
  { month: 4, day: 14, icon: '🍜', title: '블랙데이' },
  { month: 5, day: 14, icon: '🌹', title: '로즈데이' },
  { month: 6, day: 14, icon: '💋', title: '키스데이' },
  { month: 7, day: 14, icon: '💍', title: '실버데이' },
  { month: 8, day: 14, icon: '🌿', title: '그린데이' },
  { month: 9, day: 14, icon: '📷', title: '포토데이' },
  { month: 10, day: 14, icon: '🍷', title: '와인데이' },
  { month: 11, day: 11, icon: '🍫', title: '빼빼로데이' },
  { month: 11, day: 14, icon: '🎬', title: '무비데이' },
  { month: 12, day: 14, icon: '🤗', title: '허그데이' },
  { month: 12, day: 25, icon: '🎄', title: '크리스마스' },
] as const;

function atMidnight(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function parseDate(value?: string) {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function currentMonthSpecialDays(today = atMidnight()): Anniversary[] {
  const month = today.getMonth() + 1;
  return COUPLE_SPECIAL_DAYS
    .filter((item) => item.month === month)
    .map((item) => ({ id: `special-${item.month}-${item.day}`, icon: item.icon, title: item.title, date: new Date(today.getFullYear(), item.month - 1, item.day), recurring: true }))
    .sort((a, b) => a.date.getTime() - b.date.getTime());
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

function relativeDayLabel(date: Date, today = atMidnight()) {
  const diff = Math.round((atMidnight(date).getTime() - today.getTime()) / DAY);
  if (diff === 0) return 'D-DAY';
  return diff > 0 ? `D-${diff}` : `D+${Math.abs(diff)}`;
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
  const [memoryDraft, setMemoryDraft] = useState<MemoryDraft>();
  const [locationFocus, setLocationFocus] = useState<string>();
  const [requestedHubTab, setRequestedHubTab] = useState<HubTabId>();
  const [requestedLocationTab, setRequestedLocationTab] = useState<LocationTabId>();
  const previousMessages = useRef(messages);
  const previousMemories = useRef(memories);
  const tabHistory = useRef<Tab[]>(['home']);
  const unreadCount = notifications.filter((item) => !item.read).length;
  const start = parseDate(relationshipStartDate);
  const coupleDay = start ? Math.max(1, Math.floor((atMidnight().getTime() - start.getTime()) / DAY) + 1) : 0;
  const anniversaries = useMemo(() => profile ? buildAnniversaries(profile, connection?.partnerProfile ?? null, relationshipStartDate) : [], [connection?.partnerProfile, profile, relationshipStartDate]);

  const navigateTab = (next: Tab) => {
    if (next === tab) return;
    tabHistory.current.push(next);
    setTab(next);
  };

  const navigateMoreTarget = (target: MoreNavigationTarget) => {
    if (target.area === 'chat') {
      navigateTab('chat');
      return;
    }
    if (target.area === 'memories') {
      setRequestedHubTab(target.tab);
      navigateTab('memories');
      return;
    }
    setRequestedLocationTab(target.tab);
    navigateTab('location');
  };

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
    const handleBack = (event: Event) => {
      if (event.defaultPrevented) return;
      if (settingsOpen) { event.preventDefault(); setSettingsOpen(false); return; }
      if (notificationsOpen) { event.preventDefault(); setNotificationsOpen(false); return; }
      if (tabHistory.current.length > 1) {
        event.preventDefault();
        tabHistory.current.pop();
        setTab(tabHistory.current[tabHistory.current.length - 1] ?? 'home');
        return;
      }
      if (tab !== 'home') { event.preventDefault(); tabHistory.current = ['home']; setTab('home'); }
    };
    window.addEventListener('route-native-back', handleBack);
    return () => window.removeEventListener('route-native-back', handleBack);
  }, [notificationsOpen, settingsOpen, tab]);

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
    const handleRemoteMemories = (event: Event) => {
      const next = (event as CustomEvent<Memory[]>).detail;
      if (Array.isArray(next)) setMemories(next);
    };
    window.addEventListener('route-memories-remote-change', handleRemoteMemories);
    return () => window.removeEventListener('route-memories-remote-change', handleRemoteMemories);
  }, []);

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

  const AppHeader = ({ title }: { title?: string }) => <SharedAppHeader title={title} onSettings={() => setSettingsOpen(true)} onNotifications={openNotifications} unreadCount={unreadCount} />;
  return <>
    <div className="app-shell"><main>
      {tab === 'home' && <HomePage uid={user.uid} profile={profile} connection={connection} relationshipStartDate={relationshipStartDate} coupleDay={coupleDay} anniversaries={anniversaries} memories={memories} messages={messages} onNavigate={navigateTab} onOpenMemory={(id) => { setMemoryDraft(undefined); setMemoryToOpen(id); setRequestedHubTab('album'); navigateTab('memories'); }} onSettings={() => setSettingsOpen(true)} onNotifications={openNotifications} unreadCount={unreadCount} />}
      {tab === 'chat' && <ChatPage Header={AppHeader} messages={messages} setMessages={setMessages} connection={connection} />}
      {tab === 'memories' && <StableMemoriesPage requestedTab={requestedHubTab} Header={AppHeader} memories={memories} setMemories={setMemories} initialMemoryId={memoryToOpen} initialDraft={memoryDraft} onClearInitial={() => setMemoryToOpen(undefined)} onClearInitialDraft={() => setMemoryDraft(undefined)} onOpenLocation={(place) => { setLocationFocus(place); setRequestedLocationTab('map'); navigateTab('location'); }} />}
      {tab === 'location' && <StableLocationPage requestedTab={requestedLocationTab} Header={AppHeader} connection={connection} focusPlace={locationFocus} onClearFocus={() => setLocationFocus(undefined)} onCreateMemory={(draft) => { setMemoryToOpen(undefined); setMemoryDraft(draft); setRequestedHubTab('album'); navigateTab('memories'); }} onActivity={(title, detail) => addActivity({ actor: 'me', kind: 'location', title, detail })} />}
      {tab === 'anniversary' && <AnniversaryPage connected={Boolean(connection)} relationshipStartDate={relationshipStartDate} coupleDay={coupleDay} anniversaries={anniversaries} onSaveStartDate={saveStartDate} onSettings={() => setSettingsOpen(true)} onNotifications={openNotifications} unreadCount={unreadCount} />}
      {tab === 'more' && <MorePage onSettings={() => setSettingsOpen(true)} onNotifications={openNotifications} unreadCount={unreadCount} onNavigate={navigateMoreTarget} />}
    </main><BottomNav tab={tab} onNavigate={navigateTab} /></div>
    {settingsOpen && <AccountSettings user={user} profile={profile} onProfileChange={handleProfileChange} onClose={() => setSettingsOpen(false)} />}
    {notificationsOpen && <NotificationPanel items={notifications} onClose={() => setNotificationsOpen(false)} onReadAll={() => { const next = markAllNotificationsRead(notifications); setNotifications(next); saveNotifications(user.uid, next); }} onClear={clearNotifications} />}
  </>;
}

function HomePage({ uid, profile, connection, relationshipStartDate, coupleDay, anniversaries, memories, messages, onNavigate, onOpenMemory, onSettings, onNotifications, unreadCount }: { uid: string; profile: UserProfile; connection: RealCoupleConnection | null; relationshipStartDate?: string; coupleDay: number; anniversaries: Anniversary[]; memories: Memory[]; messages: Message[]; onNavigate: (tab: Tab) => void; onOpenMemory: (id: number) => void; onSettings: () => void; onNotifications: () => void; unreadCount: number }) {
  const nearest = anniversaries[0];
  const latestMemory = memories[0];
  const latestPartnerMessage = [...messages].reverse().find((message) => message.sender === 'partner');
  const partnerProfile = connection?.partnerProfile ?? null;
  const partnerName = partnerProfile ? displayName(partnerProfile) : '상대방';
  const partnerInitial = partnerName.slice(0, 1) || '상';

  return <div className="page home-page home-dashboard">
    <SharedAppHeader onSettings={onSettings} onNotifications={onNotifications} unreadCount={unreadCount} />
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
  const monthlySpecials = useMemo(() => currentMonthSpecialDays(), []);
  useEffect(() => setDate(relationshipStartDate ?? ''), [relationshipStartDate]);
  const save = async () => {
    if (!date) return setFeedback('서로 만나기 시작한 날짜를 입력해 주세요.');
    setSaving(true); setFeedback('');
    try { await onSaveStartDate(date); setFeedback('우리의 기념일을 저장했어요. 상대방 화면에도 함께 반영돼요.'); }
    catch { setFeedback('기념일 저장 중 문제가 생겼어요.'); }
    finally { setSaving(false); }
  };
  return <div className="page"><SharedAppHeader title="기념일" onSettings={onSettings} onNotifications={onNotifications} unreadCount={unreadCount} />
    <div className="title-block"><small>OUR DAYS</small><h1>함께 기다리는 날</h1><p>우리 둘의 생일과 소중한 기념일을 한곳에서 확인해요.</p></div>
    {connected && !relationshipStartDate && <div className="anniversary-card"><div className="rings"><Heart fill="currentColor" /></div><span>처음 한 번만 설정해 주세요</span><strong>우리의 시작일</strong><p>한 사람이 저장하면 두 사람에게 동일하게 적용돼요.</p><label style={{display:'grid',gap:8,marginTop:14}}>서로 만나기 시작한 날짜<input type="date" value={date} max={new Date().toISOString().slice(0,10)} onChange={(e) => setDate(e.target.value)} /></label><button className="primary" type="button" disabled={saving || !date} onClick={() => void save()}>{saving ? '저장 중...' : '기념일 저장'}</button>{feedback && <p>{feedback}</p>}</div>}
    {!connected && <div className="anniversary-card"><div className="rings"><Heart fill="currentColor" /></div><span>상대방 연결 필요</span><strong>둘만의 기념일</strong><p>설정에서 상대방 계정을 먼저 연결하면 생일과 기념일을 함께 볼 수 있어요.</p></div>}
    {relationshipStartDate && <div className="anniversary-card"><div className="rings"><Heart fill="currentColor" /></div><span>우리의 시간</span><strong>{coupleDay}번째 날</strong><p>{relationshipStartDate.replaceAll('-', '.')}부터 · D+{coupleDay}</p></div>}
    <div className="section-head upcoming"><h2>이번 달 기념일</h2></div>
    <div className="event-list">{monthlySpecials.map((event) => <button className="event" key={event.id}><div className="event-icon">{event.icon}</div><div><b>{event.title}</b><span>{formatDate(event.date)}</span></div><em>{relativeDayLabel(event.date)}</em><ChevronRight size={17} /></button>)}</div>
    <div className="section-head upcoming"><h2>우리의 다가오는 기념일</h2><button onClick={() => connected && !relationshipStartDate && void save()}><Plus size={16} />기념일</button></div>
    <div className="event-list">{anniversaries.map((event) => <button className="event" key={event.id}><div className="event-icon">{event.icon}</div><div><b>{event.title}</b><span>{formatDate(event.date)}</span></div><em>D-{daysUntil(event.date)}</em><ChevronRight size={17} /></button>)}</div>
  </div>;
}

function MorePage({ onSettings, onNotifications, unreadCount, onNavigate }: { onSettings: () => void; onNotifications: () => void; unreadCount: number; onNavigate: (target: MoreNavigationTarget) => void }) {
  return <div className="page more-page">
    <SharedAppHeader title="더보기" onSettings={onSettings} onNotifications={onNotifications} unreadCount={unreadCount} />
    <div className="more-scroll"><MoreServices onOpenSettings={onSettings} onOpenNotifications={onNotifications} onNavigate={onNavigate} /></div>
  </div>;
}

export default App;
