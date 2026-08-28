import { useEffect, useMemo, useState } from 'react';
import { ChatPage } from './components/chat/ChatPage';
import { MemoriesPage } from './components/memories/MemoriesPage';
import type { Memory, Message } from './types';
import { isSameMonthDay } from './utils/dates';
import { loadMemories, loadMessages, saveMemories, saveMessages } from './utils/storage';
import {
  Bell, CalendarDays, ChevronRight, Copy, Heart, Home,
  Image, LockKeyhole, MessageCircle, Plus, Settings,
} from 'lucide-react';

type Tab = 'home' | 'chat' | 'memories' | 'anniversary';
type Access = 'login' | 'signup' | 'connect' | 'app';
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
  const [access, setAccess] = useState<Access>('login');
  const [tab, setTab] = useState<Tab>('home');
  const [messages, setMessages] = useState<Message[]>(() => loadMessages(initialMessages));
  const [memories, setMemories] = useState<Memory[]>(() => loadMemories(initialMemories));
  const [memoryToOpen, setMemoryToOpen] = useState<number>();
  const coupleDay = useMemo(() => Math.floor((atMidnight().getTime() - startDate.getTime()) / DAY) + 1, []);
  const anniversaries = useMemo(() => upcomingAnniversaries(), []);
  useEffect(() => saveMessages(messages), [messages]);
  useEffect(() => saveMemories(memories), [memories]);

  if (access !== 'app') return <AuthFlow step={access} setStep={setAccess} />;
  return (
    <div className="app-shell">
      <main>
        {tab === 'home' && <HomePage coupleDay={coupleDay} anniversaries={anniversaries} memories={memories} onNavigate={setTab} onOpenMemory={(id) => { setMemoryToOpen(id); setTab('memories'); }} />}
        {tab === 'chat' && <ChatPage Header={Header} messages={messages} setMessages={setMessages} />}
        {tab === 'memories' && <MemoriesPage Header={Header} memories={memories} setMemories={setMemories} initialMemoryId={memoryToOpen} onClearInitial={() => setMemoryToOpen(undefined)} />}
        {tab === 'anniversary' && <AnniversaryPage coupleDay={coupleDay} anniversaries={anniversaries} />}
      </main>
      <BottomNav tab={tab} setTab={setTab} />
    </div>
  );
}

function AuthFlow({ step, setStep }: { step: Exclude<Access, 'app'>; setStep: (value: Access) => void }) {
  const [code, setCode] = useState('');
  if (step === 'connect') {
    return (
      <div className="app-shell auth-shell">
        <Wordmark />
        <div className="connect-visual"><div className="person">민</div><span>MU</span><div className="person pale">?</div></div>
        <div className="auth-card">
          <p className="overline">ONLY FOR TWO</p><h1>우리 둘을<br />연결해요</h1>
          <p>초대 코드를 공유하거나, 받은 코드를 입력하세요.</p>
          <div className="invite-code"><span>내 초대 코드</span><strong>MU-2406</strong><button onClick={() => navigator.clipboard?.writeText('MU-2406')}><Copy size={14} /> 복사</button></div>
          <div className="divider"><span>또는</span></div>
          <label>받은 초대 코드<input value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="예: MU-1234" /></label>
          <button className="primary" onClick={() => setStep('app')} disabled={!code}>연결하고 시작하기</button>
          <button className="text-button" onClick={() => setStep('app')}>데모로 둘러보기</button>
        </div>
        <div className="privacy"><LockKeyhole size={14} /> 코드는 한 번만 사용할 수 있어요</div>
      </div>
    );
  }

  const signup = step === 'signup';
  return (
    <div className="app-shell auth-shell">
      <div className="auth-hero"><Wordmark /><div className="window-mark"><span /><span /></div><h1>우리 둘의 이야기가<br />머무는 작은 공간</h1><p>대화하고, 기억하고,<br />둘만의 시간을 이어가요.</p></div>
      <form className="auth-card" onSubmit={(event) => { event.preventDefault(); setStep(signup ? 'connect' : 'app'); }}>
        <p className="overline">{signup ? 'WELCOME TO MELUNI' : 'WELCOME BACK'}</p><h2>{signup ? '우리의 공간을 시작해볼까요?' : '다시 만나 반가워요'}</h2>
        {signup && <label>이름<input required placeholder="이름을 입력하세요" /></label>}
        <label>이메일<input required type="email" placeholder="hello@example.com" /></label>
        <label>비밀번호<input required type="password" minLength={6} placeholder="6자 이상 입력하세요" /></label>
        <button className="primary" type="submit">{signup ? '가입하고 연결하기' : '로그인'}</button>
        <p className="switch">{signup ? '이미 계정이 있나요?' : 'MELUNI가 처음인가요?'} <button type="button" onClick={() => setStep(signup ? 'login' : 'signup')}>{signup ? '로그인' : '회원가입'}</button></p>
        <button className="text-button" type="button" onClick={() => setStep('connect')}>초대 코드 화면 미리보기</button>
      </form>
    </div>
  );
}

function Wordmark() {
  return <div className="wordmark"><strong>MELUNI.</strong><span>ME + U</span></div>;
}

function Header({ title }: { title?: string }) {
  return <header className="topbar"><div className="brand"><Wordmark />{title && <span className="page-title">{title}</span>}</div><div className="header-actions"><button aria-label="알림"><Bell size={20} /><i /></button><button aria-label="설정"><Settings size={20} /></button></div></header>;
}

function HomePage({ coupleDay, anniversaries, memories, onNavigate, onOpenMemory }: { coupleDay: number; anniversaries: Anniversary[]; memories: Memory[]; onNavigate: (tab: Tab) => void; onOpenMemory: (id: number) => void }) {
  const nearest = anniversaries[0];
  const latestMemory = memories[0];
  const onThisDay = memories.find((memory) => isSameMonthDay(memory.date));
  return (
    <div className="page home-page">
      <Header />
      <section className="hero"><p className="hero-kicker">2024. 06. 01부터</p><h1>민준 <span>×</span> 서연</h1><p className="hero-day">우리의 <strong>{coupleDay}번째 날</strong></p><span className="d-day">D+{coupleDay}</span></section>
      <section className="section anniversary-preview">
        <SectionHead eyebrow="NEXT MOMENT" title="다가오는 우리 날" action="모두 보기" onClick={() => onNavigate('anniversary')} />
        {nearest ? <button className="next-card" onClick={() => onNavigate('anniversary')}><div className="event-icon">{nearest.icon}</div><div><span>{formatDate(nearest.date)}</span><h3>{nearest.title}</h3><strong>{daysUntil(nearest.date)}일 남았어요</strong></div><ChevronRight size={20} /></button> : <button className="empty-card" onClick={() => onNavigate('anniversary')}><Plus size={18} />우리만의 특별한 날을 등록해보세요</button>}
        <div className="mini-events">{anniversaries.slice(1, 3).map((event) => <button key={event.id} onClick={() => onNavigate('anniversary')}><span>{event.icon} {event.title}</span><b>D-{daysUntil(event.date)}</b></button>)}</div>
      </section>
      {onThisDay && <section className="section on-this-day"><SectionHead eyebrow="ON THIS DAY" title="1년 전 오늘" action="열어보기" onClick={() => onOpenMemory(onThisDay.id)} /><button onClick={() => onOpenMemory(onThisDay.id)}><img src={onThisDay.images[0]} alt="" /><div><h3>{onThisDay.title}</h3><p>{onThisDay.description}</p></div><ChevronRight size={18} /></button></section>}
      {latestMemory && <section className="section"><SectionHead eyebrow="OUR MOMENTS" title="최근 추억" action="전체 보기" onClick={() => onNavigate('memories')} /><button className="memory-feature" onClick={() => onOpenMemory(latestMemory.id)}><img src={latestMemory.images[0]} alt={latestMemory.title} /><div className="image-shade" /><div className="memory-copy"><span>{latestMemory.date.replaceAll('-', '. ')}</span><h3>{latestMemory.title}</h3><p>{latestMemory.description}</p></div><span className="round-button"><Image size={18} /></span></button></section>}
      <section className="section"><SectionHead eyebrow="JUST NOW" title="최근 메시지" action="채팅 열기" onClick={() => onNavigate('chat')} /><button className="recent-message" onClick={() => onNavigate('chat')}><div className="avatar">서</div><div><div><b>서연</b><span>오후 8:46</span></div><p>그럼 조금 있다가 전화하자!</p></div><ChevronRight size={19} /></button></section>
      <div className="privacy"><LockKeyhole size={14} /> 이 공간은 오직 두 사람에게만 보여요</div>
    </div>
  );
}

function SectionHead({ eyebrow, title, action, onClick }: { eyebrow: string; title: string; action: string; onClick: () => void }) {
  return <div className="section-head"><div><small>{eyebrow}</small><h2>{title}</h2></div><button onClick={onClick}>{action}<ChevronRight size={15} /></button></div>;
}

function AnniversaryPage({ coupleDay, anniversaries }: { coupleDay: number; anniversaries: Anniversary[] }) {
  return <div className="page"><Header title="기념일" /><div className="title-block"><small>OUR DAYS</small><h1>함께 기다리는 날</h1><p>우리 둘의 소중한 시간을 잊지 않도록.</p></div><div className="anniversary-card"><div className="rings"><Heart fill="currentColor" /></div><span>우리의 시간</span><strong>{coupleDay}번째 날</strong><p>2024. 06. 01부터 · D+{coupleDay}</p></div><div className="section-head upcoming"><h2>다가오는 기념일</h2><button><Plus size={16} />추가</button></div><div className="event-list">{anniversaries.map((event) => <button className="event" key={event.id}><div className="event-icon">{event.icon}</div><div><b>{event.title}</b><span>{formatDate(event.date)}</span></div><em>D-{daysUntil(event.date)}</em><ChevronRight size={17} /></button>)}</div></div>;
}

function BottomNav({ tab, setTab }: { tab: Tab; setTab: (tab: Tab) => void }) {
  const items: [Tab, string, typeof Home][] = [['home', '홈', Home], ['chat', '채팅', MessageCircle], ['memories', '추억', Image], ['anniversary', '기념일', CalendarDays]];
  return <nav className="bottom-nav" aria-label="주요 메뉴">{items.map(([id, label, Icon]) => <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}><span className="nav-icon"><Icon size={21} strokeWidth={tab === id ? 2.4 : 1.8} /></span><span>{label}</span></button>)}</nav>;
}

export default App;
