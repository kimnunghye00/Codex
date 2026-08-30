import { useEffect, useMemo, useRef, useState } from 'react';
import { ChatPage } from './components/chat/ChatPage';
import { MemoriesPage } from './components/memories/MemoriesPage';
import { LocationPage } from './components/location/LocationPage';
import { AccountSettings } from './components/auth/AccountSettings';
import { AuthFlow, Wordmark } from './components/auth/AuthFlow';
import { ProfileSetup } from './components/auth/ProfileSetup';
import { NotificationPanel } from './components/notifications/NotificationPanel';
import { auth } from './lib/firebase';
import { loadLocalAiPartner } from './lib/coupleData';
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
type Anniversary = { id: number; icon: string; title: string; date: Date; recurring?: boolean };

const DAY = 86_400_000;
const startDate = new Date(2024, 5, 1);
const initialMemories: Memory[] = [
  { id: 1, date: '2026-08-11', title: '여름날의 산책', description: '노을이 예뻤던 한강에서 오래 걸었던 날.', images: ['https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=900&q=80'], location: '강릉 경포해변', tags: ['여행', '산책'], createdBy: 'me', favorite: true },
  { id: 2, date: '2026-08-03', title: '우리의 작은 휴가', description: '비가 와도 좋았던 하루.', images: ['https://images.unsplash.com/photo-1528127269322-539801943592?auto=format&fit=crop&w=900&q=80'], location: '제주', tags: ['여행'], createdBy: 'partner' },
  { id: 3, date: '2025-08-15', title: '서울숲에서', description: '처음 같이 피크닉 갔던 날. 그늘 아래서 오래 이야기했다.', images: ['https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=900&q=80'], location: '서울숲', tags: ['피크닉', '오늘의추억'], createdBy: 'me' },
];
const initialMessages: Message[] = [
  { id: 1, sender: 'partner', type: 'text', text: '오늘 하루는 어땠어?', timestamp: '2026-08-14T20:42:00', read: true },
  { id: 2, sender: 'me', type: 'text', text: '바빴지만 이제 네 목소리 들으면 괜찮을 것 같아', timestamp: '2026-08-14T20:45:00', read: true, reactions: [{ emoji: '❤️', by: 'partner' }] },
  { id: 3, sender: 'partner', type: 'text', text: '그럼 조금 있다가 전화하자!', timestamp: '2026-08-15T20:46:00', read: true },
];

function atMidnight(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function upcomingAnniversaries(today = atMidnight()): Anniversary[] {
  const yearly = [
    { id: 1, icon: '🎂', title: '서연 생일', month: 8, day: 22 },
    { id: 2, icon: '🌿', title: '처음 만난 날', month: 9, day: 8 },
  ].map((event) => {
    let date = new Date(today.getFullYear(), event.month, event.day);
    if (date < today) date = new Date(today.getFullYear() + 1, event.month, event.day);
    return { id: event.id, icon: event.icon, title: event.title, date, recurring: true };
  });

  const currentDay = Math.floor((today.getTime() - startDate.getTime()) / DAY) + 1;
  const milestone = Math.ceil(currentDay / 100) * 100;
  const milestoneDate = new Date(startDate.getTime() + (milestone - 1) * DAY);
  return [...yearly, { id: 3, icon: '✨', title: `우리의 ${milestone}일`, date: milestoneDate }]
    .sort((a, b) => a.date.getTime() - b.date.getTime());
}

function daysUntil(date: Date, today = atMidnight()) {
  return Math.max(0, Math.ceil((atMidnight(date).getTime() - today.getTime()) / DAY));
}

function formatDate(date: Date) {
  return `${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일`;
}

function App() {
  const [user, setUser] = useState<User | null>(auth.currentUser);
  const [authReady, setAuthReady] = useState(false);
  const [profile, setProfile] = useState<UserProfile | null>(() => auth.currentUser ? loadProfile(auth.currentUser.uid) : null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notifications, setNotifications] = useState<AppNotification[]>(() => auth.currentUser ? loadNotifications(auth.currentUser.uid) : []);
  const [tab, setTab] = useState<Tab>('home');
  const [messages, setMessages] = useState<Message[]>(() => loadMessages(initialMessages));
  const [memories, setMemories] = useState<Memory[]>(() => loadMemories(initialMemories));
  const [memoryToOpen, setMemoryToOpen] = useState<number>();
  const previousMessages = useRef(messages);
  const previousMemories = useRef(memories);
  const coupleDay = useMemo(() => Math.floor((atMidnight().getTime() - startDate.getTime()) / DAY) + 1, []);
  const anniversaries = useMemo(() => upcomingAnniversaries(), []);
  const unreadCount = notifications.filter((item) => !item.read).length;

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
    saveMessages(messages);
    const before = previousMessages.current;
    const beforeById = new Map(before.map((message) => [message.id, message]));
    const afterById = new Map(messages.map((message) => [message.id, message]));

    messages.filter((message) => !beforeById.has(message.id)).forEach((message) => {
      addActivity({
        actor: message.sender === 'me' ? 'me' : 'partner',
        kind: 'chat',
        title: message.sender === 'me' ? '메시지를 보냈어요' : '새 메시지가 왔어요',
        detail: message.type === 'image' ? '사진을 보냈어요.' : message.text?.slice(0, 70),
      });
    });

    messages.forEach((message) => {
      const old = beforeById.get(message.id);
      if (!old) return;
      if (old.saved !== message.saved) addActivity({ actor: 'me', kind: 'chat', title: message.saved ? '메시지를 저장했어요' : '메시지 저장을 해제했어요', detail: message.text?.slice(0, 60) });
      if (JSON.stringify(old.reactions ?? []) !== JSON.stringify(message.reactions ?? [])) addActivity({ actor: 'me', kind: 'chat', title: '메시지 반응을 변경했어요', detail: message.text?.slice(0, 60) });
    });

    before.filter((message) => !afterById.has(message.id)).forEach((message) => addActivity({ actor: 'me', kind: 'chat', title: '메시지를 삭제했어요', detail: message.text?.slice(0, 60) }));
    previousMessages.current = messages;
  }, [messages]);

  useEffect(() => {
    saveMemories(memories);
    const before = previousMemories.current;
    const beforeById = new Map(before.map((memory) => [memory.id, memory]));
    const afterById = new Map(memories.map((memory) => [memory.id, memory]));

    memories.filter((memory) => !beforeById.has(memory.id)).forEach((memory) => addActivity({ actor: memory.createdBy === 'me' ? 'me' : 'partner', kind: 'memory', title: '새 추억을 추가했어요', detail: memory.title }));
    memories.forEach((memory) => {
      const old = beforeById.get(memory.id);
      if (!old) return;
      if (old.favorite !== memory.favorite) addActivity({ actor: 'me', kind: 'memory', title: memory.favorite ? '추억을 즐겨찾기했어요' : '추억 즐겨찾기를 해제했어요', detail: memory.title });
      else if (JSON.stringify(old) !== JSON.stringify(memory)) addActivity({ actor: 'me', kind: 'memory', title: '추억을 수정했어요', detail: memory.title });
    });
    before.filter((memory) => !afterById.has(memory.id)).forEach((memory) => addActivity({ actor: 'me', kind: 'memory', title: '추억을 삭제했어요', detail: memory.title }));
    previousMemories.current = memories;
  }, [memories]);

  const handleProfileChange = (next: UserProfile) => {
    if (profile) {
      const nicknameChanged = profile.nickname !== next.nickname;
      const details: string[] = [];
      if (profile.name !== next.name) details.push('이름');
      if (profile.birthDate !== next.birthDate) details.push('생년월일');
      if (profile.gender !== next.gender) details.push('성별');
      if (profile.photoDataUrl !== next.photoDataUrl) details.push('프로필 사진');
      if (nicknameChanged) details.push('별명');
      if (details.length) addActivity({ actor: nicknameChanged && next.nicknameSetBy === 'partner' ? 'partner' : 'me', kind: 'profile', title: nicknameChanged && next.nicknameSetBy === 'partner' ? '상대방이 내 별명을 바꿨어요' : '프로필을 변경했어요', detail: details.join(' · ') });
    } else {
      addActivity({ actor: 'me', kind: 'profile', title: '프로필 설정을 완료했어요' });
    }
    setProfile(next);
  };

  const openNotifications = () => {
    const uid = user?.uid;
    if (!uid) return;
    const next = markAllNotificationsRead(notifications);
    setNotifications(next);
    saveNotifications(uid, next);
    setNotificationsOpen(true);
  };

  const clearNotifications = () => {
    if (!user) return;
    setNotifications([]);
    saveNotifications(user.uid, []);
  };

  if (!authReady) return <div className="app-shell auth-loading"><Wordmark /><div className="loading-mark" /><p>MELUNI를 준비하고 있어요</p></div>;
  if (!user) return <AuthFlow />;
  if (!profile) return <ProfileSetup user={user} onComplete={handleProfileChange} />;

  const AppHeader = ({ title }: { title?: string }) => <Header title={title} onSettings={() => setSettingsOpen(true)} onNotifications={openNotifications} unreadCount={unreadCount} />;
  return (
    <>
      <div className="app-shell">
        <main>
          {tab === 'home' && <HomePage profile={profile} coupleDay={coupleDay} anniversaries={anniversaries} memories={memories} messages={messages} onNavigate={setTab} onOpenMemory={(id) => { setMemoryToOpen(id); setTab('memories'); }} onSettings={() => setSettingsOpen(true)} onNotifications={openNotifications} unreadCount={unreadCount} />}
          {tab === 'chat' && <ChatPage Header={AppHeader} messages={messages} setMessages={setMessages} />}
          {tab === 'memories' && <MemoriesPage Header={AppHeader} memories={memories} setMemories={setMemories} initialMemoryId={memoryToOpen} onClearInitial={() => setMemoryToOpen(undefined)} />}
          {tab === 'location' && <LocationPage Header={AppHeader} onActivity={(title, detail) => addActivity({ actor: 'me', kind: 'location', title, detail })} />}
          {tab === 'anniversary' && <AnniversaryPage coupleDay={coupleDay} anniversaries={anniversaries} onSettings={() => setSettingsOpen(true)} onNotifications={openNotifications} unreadCount={unreadCount} />}
          {tab === 'more' && <MorePage onSettings={() => setSettingsOpen(true)} onNotifications={openNotifications} unreadCount={unreadCount} />}
        </main>
        <BottomNav tab={tab} setTab={setTab} />
      </div>
      {settingsOpen && <AccountSettings user={user} profile={profile} onProfileChange={handleProfileChange} onClose={() => setSettingsOpen(false)} />}
      {notificationsOpen && <NotificationPanel items={notifications} onClose={() => setNotificationsOpen(false)} onReadAll={() => {
        const next = markAllNotificationsRead(notifications);
        setNotifications(next);
        saveNotifications(user.uid, next);
      }} onClear={clearNotifications} />}
    </>
  );
}

function Header({ title, onSettings, onNotifications, unreadCount }: { title?: string; onSettings: () => void; onNotifications: () => void; unreadCount: number }) {
  return <header className="topbar"><div className="brand"><Wordmark />{title && <span className="page-title">{title}</span>}</div><div className="header-actions"><button className="notification-button" aria-label={`알림 ${unreadCount ? `${unreadCount}개` : ''}`} onClick={onNotifications}><Bell size={20} />{unreadCount > 0 && <em className="notification-count">{unreadCount > 99 ? '99+' : unreadCount}</em>}</button><button aria-label="설정" onClick={onSettings}><Settings size={20} /></button></div></header>;
}

function HomePage({ profile, coupleDay, anniversaries, memories, messages, onNavigate, onOpenMemory, onSettings, onNotifications, unreadCount }: { profile: UserProfile; coupleDay: number; anniversaries: Anniversary[]; memories: Memory[]; messages: Message[]; onNavigate: (tab: Tab) => void; onOpenMemory: (id: number) => void; onSettings: () => void; onNotifications: () => void; unreadCount: number }) {
  const nearest = anniversaries[0];
  const latestMemory = memories[0];
  const latestPartnerMessage = [...messages].reverse().find((message) => message.sender === 'partner');
  const aiPartner = auth.currentUser ? loadLocalAiPartner(auth.currentUser.uid) : null;
  const partnerName = aiPartner?.connected ? aiPartner.displayName : '서연';
  const partnerInitial = partnerName.slice(0, 1);

  return (
    <div className="page home-page home-dashboard">
      <Header onSettings={onSettings} onNotifications={onNotifications} unreadCount={unreadCount} />

      <div className="home-dashboard-grid">
        <button className="home-map-card" type="button" onClick={() => onNavigate('location')} aria-label="위치 화면 열기">
          <div className="home-map-grid-lines" />
          <span className="home-map-road road-a" />
          <span className="home-map-road road-b" />
          <span className="home-map-river" />
          <span className="home-map-place place-office">MELUNI 오피스</span>
          <span className="home-map-place place-cafe">카페</span>
          <span className="home-map-place place-park">공원</span>

          <div className="home-location-status"><MapPin size={16} /><span><b>{partnerName} · 위치 공유</b><small>최근 위치를 확인해보세요</small></span></div>
          <div className="home-map-person"><span className="home-map-halo" /><span className="home-map-avatar">{partnerInitial}</span><MapPin size={25} fill="currentColor" /></div>
          <div className="home-map-locate"><MapPinned size={20} /></div>
        </button>

        <div className="home-dashboard-side">
          <button className="home-time-card" type="button" onClick={() => onNavigate('anniversary')}>
            <div className="home-card-title"><span>우리의 시간</span><Heart size={16} fill="currentColor" /></div>
            <div className="home-time-block"><small>사귄 지</small><strong>D+{coupleDay}</strong><em>2024.06.01부터</em></div>
            <div className="home-time-divider" />
            {nearest && <div className="home-time-block upcoming-time"><small>다가오는 날</small><strong>D-{daysUntil(nearest.date)}</strong><em>{nearest.title}</em></div>}
          </button>

          {latestMemory ? <button className="home-photo-card" type="button" onClick={() => onOpenMemory(latestMemory.id)}>
            <img src={latestMemory.images[0]} alt={latestMemory.title} />
            <span className="home-photo-shade" />
            <span className="home-photo-copy"><small>최근 추억</small><strong>{latestMemory.title}</strong><em>{latestMemory.date.replaceAll('-', '.')}</em></span>
            <span className="home-photo-heart"><Heart size={16} /></span>
          </button> : <button className="home-photo-card empty" type="button" onClick={() => onNavigate('memories')}><Image size={24} /><span>첫 추억을 남겨보세요</span></button>}

          <button className="home-chat-card" type="button" onClick={() => onNavigate('chat')}>
            <span className="home-chat-head"><b>최근 대화</b><ChevronRight size={17} /></span>
            <span className="home-chat-preview"><span className="home-chat-avatar">{partnerInitial}</span><span className="home-chat-copy"><b>{partnerName}</b><small>{latestPartnerMessage?.text ?? '아직 대화가 없어요.'}</small></span></span>
          </button>
        </div>
      </div>
    </div>
  );
}

function SectionHead({ eyebrow, title, action, onClick }: { eyebrow: string; title: string; action: string; onClick: () => void }) {
  return <div className="section-head"><div><small>{eyebrow}</small><h2>{title}</h2></div><button onClick={onClick}>{action}<ChevronRight size={15} /></button></div>;
}

function AnniversaryPage({ coupleDay, anniversaries, onSettings, onNotifications, unreadCount }: { coupleDay: number; anniversaries: Anniversary[]; onSettings: () => void; onNotifications: () => void; unreadCount: number }) {
  return <div className="page"><Header title="기념일" onSettings={onSettings} onNotifications={onNotifications} unreadCount={unreadCount} /><div className="title-block"><small>OUR DAYS</small><h1>함께 기다리는 날</h1><p>우리 둘의 소중한 시간을 잊지 않도록.</p></div><div className="anniversary-card"><div className="rings"><Heart fill="currentColor" /></div><span>우리의 시간</span><strong>{coupleDay}번째 날</strong><p>2024. 06. 01부터 · D+{coupleDay}</p></div><div className="section-head upcoming"><h2>다가오는 기념일</h2><button><Plus size={16} />추가</button></div><div className="event-list">{anniversaries.map((event) => <button className="event" key={event.id}><div className="event-icon">{event.icon}</div><div><b>{event.title}</b><span>{formatDate(event.date)}</span></div><em>D-{daysUntil(event.date)}</em><ChevronRight size={17} /></button>)}</div></div>;
}

function MorePage({ onSettings, onNotifications, unreadCount }: { onSettings: () => void; onNotifications: () => void; unreadCount: number }) {
  return <div className="page"><Header title="더보기" onSettings={onSettings} onNotifications={onNotifications} unreadCount={unreadCount} /><div className="title-block"><small>MORE</small><h1>더보기</h1><p>계정과 앱 설정을 관리할 수 있어요.</p></div><div className="event-list"><button className="event" type="button" onClick={onSettings}><div className="event-icon"><Settings size={20} /></div><div><b>계정 및 프로필 설정</b><span>내 정보와 계정 설정을 관리해요</span></div><ChevronRight size={17} /></button><button className="event" type="button" onClick={onNotifications}><div className="event-icon"><Bell size={20} /></div><div><b>알림</b><span>최근 알림을 확인해요</span></div>{unreadCount > 0 && <em>{unreadCount}</em>}<ChevronRight size={17} /></button></div></div>;
}

function BottomNav({ tab, setTab }: { tab: Tab; setTab: (tab: Tab) => void }) {
  const items: [Tab, string, typeof Home][] = [['home', '홈', Home], ['memories', '추억', Image], ['chat', '채팅', MessageCircle], ['location', '위치', MapPinned], ['more', '더보기', Ellipsis]];
  return <nav className="bottom-nav" aria-label="주요 메뉴">{items.map(([id, label, Icon]) => <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}><span className="nav-icon"><Icon size={21} strokeWidth={tab === id ? 2.4 : 1.8} /></span><span>{label}</span></button>)}</nav>;
}

export default App;