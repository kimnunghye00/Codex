import { useMemo, useState } from 'react';
import {
  Bell, CalendarDays, Camera, ChevronRight, Copy, Heart, Home,
  Image, LockKeyhole, MessageCircle, MoreHorizontal, Plus, Send, Settings,
} from 'lucide-react';

type Tab = 'home' | 'chat' | 'memories' | 'anniversary';
type Access = 'login' | 'signup' | 'connect' | 'app';
type Memory = { id: number; date: string; title: string; note: string; image: string };
type Message = { id: number; text: string; mine: boolean; time: string };
type Anniversary = { id: number; icon: string; title: string; date: Date; recurring?: boolean };

const DAY = 86_400_000;
const startDate = new Date(2024, 5, 1);
const initialMemories: Memory[] = [
  { id: 1, date: '8월 11일', title: '여름날의 산책', note: '노을이 예뻤던 한강에서', image: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=900&q=80' },
  { id: 2, date: '8월 3일', title: '우리의 작은 휴가', note: '비가 와도 좋았던 하루', image: 'https://images.unsplash.com/photo-1528127269322-539801943592?auto=format&fit=crop&w=900&q=80' },
  { id: 3, date: '7월 20일', title: '좋아하는 카페', note: '다음엔 창가 자리에 앉자', image: 'https://images.unsplash.com/photo-1445116572660-236099ec97a0?auto=format&fit=crop&w=900&q=80' },
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
  const [messages, setMessages] = useState<Message[]>([
    { id: 1, text: '오늘 하루는 어땠어?', mine: false, time: '오후 8:42' },
    { id: 2, text: '바빴지만 이제 네 목소리 들으면 괜찮을 것 같아', mine: true, time: '오후 8:45' },
    { id: 3, text: '그럼 조금 있다가 전화하자!', mine: false, time: '오후 8:46' },
  ]);
  const [draft, setDraft] = useState('');
  const coupleDay = useMemo(() => Math.floor((atMidnight().getTime() - startDate.getTime()) / DAY) + 1, []);
  const anniversaries = useMemo(() => upcomingAnniversaries(), []);
  const send = () => {
    if (!draft.trim()) return;
    setMessages((items) => [...items, { id: Date.now(), text: draft.trim(), mine: true, time: '지금' }]);
    setDraft('');
  };

  if (access !== 'app') return <AuthFlow step={access} setStep={setAccess} />;
  return (
    <div className="app-shell">
      <main>
        {tab === 'home' && <HomePage coupleDay={coupleDay} anniversaries={anniversaries} onNavigate={setTab} />}
        {tab === 'chat' && <ChatPage messages={messages} draft={draft} setDraft={setDraft} send={send} />}
        {tab === 'memories' && <MemoriesPage />}
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
        <div className="connect-visual"><div className="person">민</div><span>사이</span><div className="person pale">?</div></div>
        <div className="auth-card">
          <p className="overline">ONLY FOR TWO</p><h1>우리 사이를<br />연결해요</h1>
          <p>초대 코드를 공유하거나, 받은 코드를 입력하세요.</p>
          <div className="invite-code"><span>내 초대 코드</span><strong>SAI-2406</strong><button onClick={() => navigator.clipboard?.writeText('SAI-2406')}><Copy size={14} /> 복사</button></div>
          <div className="divider"><span>또는</span></div>
          <label>받은 초대 코드<input value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="예: SAI-1234" /></label>
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
      <div className="auth-hero"><Wordmark /><div className="window-mark"><span /><span /></div><h1>우리 사이의 이야기가<br />머무는 작은 창구</h1><p>대화하고, 기억하고,<br />둘만의 시간을 이어가요.</p></div>
      <form className="auth-card" onSubmit={(event) => { event.preventDefault(); setStep(signup ? 'connect' : 'app'); }}>
        <p className="overline">{signup ? 'WELCOME TO SAI' : 'WELCOME BACK'}</p><h2>{signup ? '사이를 시작해볼까요?' : '다시 만나 반가워요'}</h2>
        {signup && <label>이름<input required placeholder="이름을 입력하세요" /></label>}
        <label>이메일<input required type="email" placeholder="hello@example.com" /></label>
        <label>비밀번호<input required type="password" minLength={6} placeholder="6자 이상 입력하세요" /></label>
        <button className="primary" type="submit">{signup ? '가입하고 연결하기' : '로그인'}</button>
        <p className="switch">{signup ? '이미 계정이 있나요?' : '사이가 처음인가요?'} <button type="button" onClick={() => setStep(signup ? 'login' : 'signup')}>{signup ? '로그인' : '회원가입'}</button></p>
        <button className="text-button" type="button" onClick={() => setStep('connect')}>초대 코드 화면 미리보기</button>
      </form>
    </div>
  );
}

function Wordmark() {
  return <div className="wordmark"><strong>사이.</strong><span>너와 나 사이</span></div>;
}

function Header({ title }: { title?: string }) {
  return <header className="topbar"><div className="brand"><Wordmark />{title && <span className="page-title">{title}</span>}</div><div className="header-actions"><button aria-label="알림"><Bell size={20} /><i /></button><button aria-label="설정"><Settings size={20} /></button></div></header>;
}

function HomePage({ coupleDay, anniversaries, onNavigate }: { coupleDay: number; anniversaries: Anniversary[]; onNavigate: (tab: Tab) => void }) {
  const nearest = anniversaries[0];
  return (
    <div className="page home-page">
      <Header />
      <section className="hero"><p className="hero-kicker">2024. 06. 01부터</p><h1>민준 <span>×</span> 서연</h1><p className="hero-day">우리의 <strong>{coupleDay}번째 날</strong></p><span className="d-day">D+{coupleDay}</span></section>
      <section className="section anniversary-preview">
        <SectionHead eyebrow="NEXT MOMENT" title="다가오는 우리 날" action="모두 보기" onClick={() => onNavigate('anniversary')} />
        {nearest ? <button className="next-card" onClick={() => onNavigate('anniversary')}><div className="event-icon">{nearest.icon}</div><div><span>{formatDate(nearest.date)}</span><h3>{nearest.title}</h3><strong>{daysUntil(nearest.date)}일 남았어요</strong></div><ChevronRight size={20} /></button> : <button className="empty-card" onClick={() => onNavigate('anniversary')}><Plus size={18} />우리만의 특별한 날을 등록해보세요</button>}
        <div className="mini-events">{anniversaries.slice(1, 3).map((event) => <button key={event.id} onClick={() => onNavigate('anniversary')}><span>{event.icon} {event.title}</span><b>D-{daysUntil(event.date)}</b></button>)}</div>
      </section>
      <section className="section"><SectionHead eyebrow="OUR MOMENTS" title="최근 추억" action="전체 보기" onClick={() => onNavigate('memories')} /><button className="memory-feature" onClick={() => onNavigate('memories')}><img src={initialMemories[0].image} alt="여름 바다의 추억" /><div className="image-shade" /><div className="memory-copy"><span>{initialMemories[0].date}</span><h3>{initialMemories[0].title}</h3><p>{initialMemories[0].note}</p></div><span className="round-button"><Image size={18} /></span></button></section>
      <section className="section"><SectionHead eyebrow="JUST NOW" title="최근 메시지" action="채팅 열기" onClick={() => onNavigate('chat')} /><button className="recent-message" onClick={() => onNavigate('chat')}><div className="avatar">서</div><div><div><b>서연</b><span>오후 8:46</span></div><p>그럼 조금 있다가 전화하자!</p></div><ChevronRight size={19} /></button></section>
      <div className="privacy"><LockKeyhole size={14} /> 이 공간은 오직 두 사람에게만 보여요</div>
    </div>
  );
}

function SectionHead({ eyebrow, title, action, onClick }: { eyebrow: string; title: string; action: string; onClick: () => void }) {
  return <div className="section-head"><div><small>{eyebrow}</small><h2>{title}</h2></div><button onClick={onClick}>{action}<ChevronRight size={15} /></button></div>;
}

function ChatPage({ messages, draft, setDraft, send }: { messages: Message[]; draft: string; setDraft: (value: string) => void; send: () => void }) {
  return <div className="page full-page"><Header title="대화" /><div className="chat-profile"><div className="avatar large">서</div><div><b>서연</b><span><i /> 지금 함께 있어요</span></div><button aria-label="대화 메뉴"><MoreHorizontal /></button></div><div className="messages"><div className="date-chip">오늘</div>{messages.map((message) => <div className={`bubble-row ${message.mine ? 'mine' : ''}`} key={message.id}>{!message.mine && <div className="avatar tiny">서</div>}<div className="bubble">{message.text}<time>{message.time}</time></div></div>)}</div><div className="composer"><button aria-label="사진 추가"><Plus /></button><input value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && send()} placeholder="메시지를 입력하세요" /><button className="send" onClick={send} aria-label="보내기"><Send size={18} /></button></div></div>;
}

function MemoriesPage() {
  return <div className="page"><Header title="추억" /><div className="title-block"><small>BETWEEN US</small><h1>우리 사이의 순간들</h1><p>오래 기억하고 싶은 날을 차곡차곡 남겨요.</p></div><div className="memory-grid">{initialMemories.map((memory, index) => <article className={index === 0 ? 'wide' : ''} key={memory.id}><img src={memory.image} alt={memory.title} /><div className="image-shade" /><div><span>{memory.date}</span><h3>{memory.title}</h3>{index === 0 && <p>{memory.note}</p>}</div></article>)}</div><button className="fab"><Camera size={18} /> 추억 남기기</button></div>;
}

function AnniversaryPage({ coupleDay, anniversaries }: { coupleDay: number; anniversaries: Anniversary[] }) {
  return <div className="page"><Header title="기념일" /><div className="title-block"><small>OUR DAYS</small><h1>함께 기다리는 날</h1><p>둘 사이의 소중한 시간을 잊지 않도록.</p></div><div className="anniversary-card"><div className="rings"><Heart fill="currentColor" /></div><span>우리의 시간</span><strong>{coupleDay}번째 날</strong><p>2024. 06. 01부터 · D+{coupleDay}</p></div><div className="section-head upcoming"><h2>다가오는 기념일</h2><button><Plus size={16} />추가</button></div><div className="event-list">{anniversaries.map((event) => <button className="event" key={event.id}><div className="event-icon">{event.icon}</div><div><b>{event.title}</b><span>{formatDate(event.date)}</span></div><em>D-{daysUntil(event.date)}</em><ChevronRight size={17} /></button>)}</div></div>;
}

function BottomNav({ tab, setTab }: { tab: Tab; setTab: (tab: Tab) => void }) {
  const items: [Tab, string, typeof Home][] = [['home', '홈', Home], ['chat', '채팅', MessageCircle], ['memories', '추억', Image], ['anniversary', '기념일', CalendarDays]];
  return <nav className="bottom-nav" aria-label="주요 메뉴">{items.map(([id, label, Icon]) => <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}><span className="nav-icon"><Icon size={21} strokeWidth={tab === id ? 2.4 : 1.8} /></span><span>{label}</span></button>)}</nav>;
}

export default App;
