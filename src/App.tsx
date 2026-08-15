import { useMemo, useState } from 'react';
import { Bell, CalendarDays, Camera, ChevronRight, Heart, Home, Image, LockKeyhole, MessageCircle, MoreHorizontal, Plus, Send, Settings, Sparkles, UserRound } from 'lucide-react';

type Tab = 'home' | 'chat' | 'memories' | 'anniversary';
type Memory = { id: number; date: string; title: string; note: string; image: string };
type Message = { id: number; text: string; mine: boolean; time: string };

const initialMemories: Memory[] = [
  { id: 1, date: '8월 11일', title: '여름날의 산책', note: '노을이 예뻤던 한강에서', image: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=900&q=80' },
  { id: 2, date: '8월 3일', title: '우리의 작은 휴가', note: '비가 와도 좋았던 하루', image: 'https://images.unsplash.com/photo-1528127269322-539801943592?auto=format&fit=crop&w=900&q=80' },
  { id: 3, date: '7월 20일', title: '좋아하는 카페', note: '다음엔 창가 자리에 앉자', image: 'https://images.unsplash.com/photo-1445116572660-236099ec97a0?auto=format&fit=crop&w=900&q=80' },
];
const startDate = new Date('2024-06-01T00:00:00');

function App() {
  const [access, setAccess] = useState<'login'|'signup'|'connect'|'app'>('login');
  const [tab, setTab] = useState<Tab>('home');
  const [messages, setMessages] = useState<Message[]>([
    { id: 1, text: '오늘 하루는 어땠어?', mine: false, time: '오후 8:42' },
    { id: 2, text: '바빴지만 이제 네 목소리 들으면 괜찮을 것 같아 ☺️', mine: true, time: '오후 8:45' },
    { id: 3, text: '그럼 조금 있다가 전화하자!', mine: false, time: '오후 8:46' },
  ]);
  const [draft, setDraft] = useState('');
  const dday = useMemo(() => Math.floor((Date.now() - startDate.getTime()) / 86400000) + 1, []);
  const send = () => { if (!draft.trim()) return; setMessages(v => [...v, { id: Date.now(), text: draft.trim(), mine: true, time: '지금' }]); setDraft(''); };
  if (access !== 'app') return <AuthFlow step={access} setStep={setAccess}/>;
  return <div className="app-shell">
    <main>
      {tab === 'home' && <HomePage dday={dday} onNavigate={setTab} />}
      {tab === 'chat' && <ChatPage messages={messages} draft={draft} setDraft={setDraft} send={send} />}
      {tab === 'memories' && <MemoriesPage />}
      {tab === 'anniversary' && <AnniversaryPage dday={dday} />}
    </main>
    <BottomNav tab={tab} setTab={setTab} />
  </div>;
}

function AuthFlow({step,setStep}:{step:'login'|'signup'|'connect';setStep:(v:'login'|'signup'|'connect'|'app')=>void}){
  const [code,setCode]=useState('');
  if(step==='connect') return <div className="app-shell auth-shell"><div className="auth-brand">둘온·</div><div className="connect-visual"><div className="person">민</div><Heart fill="currentColor"/><div className="person pale">?</div></div><div className="auth-card"><small>ALMOST THERE</small><h1>우리 둘을 연결해요</h1><p>초대 코드를 공유하거나, 받은 코드를 입력하세요.</p><div className="invite-code"><span>내 초대 코드</span><strong>DUON-2406</strong><button onClick={()=>navigator.clipboard?.writeText('DUON-2406')}>복사</button></div><div className="divider"><span>또는</span></div><label>받은 초대 코드<input value={code} onChange={e=>setCode(e.target.value.toUpperCase())} placeholder="예: DUON-1234"/></label><button className="primary" onClick={()=>setStep('app')} disabled={!code}>연결하고 시작하기</button><button className="text-button" onClick={()=>setStep('app')}>데모 커플로 둘러보기</button></div><div className="privacy"><LockKeyhole size={14}/> 코드는 한 번만 사용할 수 있어요</div></div>;
  const signup=step==='signup';
  return <div className="app-shell auth-shell"><div className="auth-hero"><div className="auth-brand">둘온·</div><div className="line-heart"><span/><Heart fill="currentColor"/><span/></div><h1>우리 둘만의<br/>조용한 공간</h1><p>소중한 대화와 순간을<br/>가장 가까운 한 사람과 나눠요.</p></div><form className="auth-card" onSubmit={e=>{e.preventDefault();setStep(signup?'connect':'app')}}><small>{signup?'CREATE ACCOUNT':'WELCOME BACK'}</small><h2>{signup?'처음 오셨나요?':'다시 만나 반가워요'}</h2>{signup&&<label>이름<input required placeholder="이름을 입력하세요"/></label>}<label>이메일<input required type="email" placeholder="hello@example.com"/></label><label>비밀번호<input required type="password" minLength={6} placeholder="6자 이상 입력하세요"/></label><button className="primary" type="submit">{signup?'가입하고 연결하기':'로그인'}</button><p className="switch">{signup?'이미 계정이 있나요?':'둘온이 처음인가요?'} <button type="button" onClick={()=>setStep(signup?'login':'signup')}>{signup?'로그인':'회원가입'}</button></p><button className="text-button" type="button" onClick={()=>setStep('connect')}>초대 코드 화면 미리보기</button></form></div>
}

function Header({ title, quiet = false }: { title?: string; quiet?: boolean }) {
  return <header className={`topbar ${quiet ? 'quiet' : ''}`}><div className="brand"><span className="brand-mark">둘온</span>{title && <span className="page-title">{title}</span>}</div><div className="header-actions"><button aria-label="알림"><Bell size={21}/><i /></button><button aria-label="설정"><Settings size={21}/></button></div></header>;
}

function HomePage({ dday, onNavigate }: { dday: number; onNavigate: (t: Tab) => void }) {
  return <div className="page home-page"><Header /><section className="hero">
    <div className="eyebrow"><Sparkles size={14}/> 오늘도 함께, 우리 둘</div>
    <h1>민준 <span>&</span> 서연</h1><p>2024년 6월 1일부터</p>
    <div className="day-count"><small>함께한 지</small><strong>D+{dday}</strong><Heart fill="currentColor" size={18}/></div>
  </section>
  <section className="section"><div className="section-head"><div><small>OUR MOMENTS</small><h2>최근 추억</h2></div><button onClick={()=>onNavigate('memories')}>모두 보기 <ChevronRight size={15}/></button></div>
    <div className="memory-feature"><img src={initialMemories[0].image}/><div className="image-shade"/><div className="memory-copy"><span>{initialMemories[0].date}</span><h3>{initialMemories[0].title}</h3><p>{initialMemories[0].note}</p></div><button className="round-button"><Image size={18}/></button></div>
  </section>
  <section className="section"><div className="section-head"><div><small>JUST NOW</small><h2>최근 메시지</h2></div><button onClick={()=>onNavigate('chat')}>채팅 열기 <ChevronRight size={15}/></button></div>
    <button className="recent-message" onClick={()=>onNavigate('chat')}><div className="avatar">서</div><div><div><b>서연</b><span>오후 8:46</span></div><p>그럼 조금 있다가 전화하자!</p></div><ChevronRight size={19}/></button>
  </section><div className="privacy"><LockKeyhole size={14}/> 이 공간은 오직 두 사람에게만 보여요</div></div>;
}

function ChatPage({messages,draft,setDraft,send}:{messages:Message[];draft:string;setDraft:(v:string)=>void;send:()=>void}) {
 return <div className="page full-page"><Header title="대화"/><div className="chat-profile"><div className="avatar large">서</div><div><b>서연</b><span><i/> 지금 함께 있어요</span></div><button><MoreHorizontal/></button></div><div className="messages"><div className="date-chip">2026년 8월 15일</div>{messages.map(m=><div className={`bubble-row ${m.mine?'mine':''}`} key={m.id}>{!m.mine&&<div className="avatar tiny">서</div>}<div className="bubble">{m.text}<time>{m.time}</time></div></div>)}</div><div className="composer"><button aria-label="사진 추가"><Plus/></button><input value={draft} onChange={e=>setDraft(e.target.value)} onKeyDown={e=>e.key==='Enter'&&send()} placeholder="메시지를 입력하세요"/><button className="send" onClick={send} aria-label="보내기"><Send size={19}/></button></div></div>
}

function MemoriesPage(){return <div className="page"><Header title="추억"/><div className="title-block"><small>TOGETHER, FOREVER</small><h1>우리의 순간들</h1><p>소중한 날을 사진과 이야기로 남겨요.</p></div><div className="memory-grid">{initialMemories.map((m,i)=><article className={i===0?'wide':''} key={m.id}><img src={m.image}/><div className="image-shade"/><div><span>{m.date}</span><h3>{m.title}</h3>{i===0&&<p>{m.note}</p>}</div></article>)}</div><button className="fab"><Camera/> 추억 남기기</button></div>}

function AnniversaryPage({dday}:{dday:number}){const events=[{icon:'🎂',title:'서연 생일',date:'9월 22일',left:'38일 남음'},{icon:'🌿',title:'처음 만난 날',date:'10월 8일',left:'54일 남음'},{icon:'✨',title:'500일',date:'10월 13일',left:'59일 남음'}];return <div className="page"><Header title="기념일"/><div className="title-block"><small>OUR SPECIAL DAYS</small><h1>함께 기다리는 날</h1></div><div className="anniversary-card"><div className="rings"><Heart fill="currentColor"/></div><span>우리가 사랑한 시간</span><strong>D+{dday}</strong><p>2024. 06. 01</p></div><div className="section-head upcoming"><h2>다가오는 기념일</h2><button><Plus size={16}/> 추가</button></div><div className="event-list">{events.map(e=><div className="event" key={e.title}><div className="event-icon">{e.icon}</div><div><b>{e.title}</b><span>{e.date}</span></div><em>{e.left}</em></div>)}</div></div>}

function BottomNav({tab,setTab}:{tab:Tab;setTab:(t:Tab)=>void}){const items:[Tab,string,typeof Home][]=[['home','홈',Home],['chat','채팅',MessageCircle],['memories','추억',Image],['anniversary','기념일',CalendarDays]];return <nav className="bottom-nav">{items.map(([id,label,Icon])=><button key={id} className={tab===id?'active':''} onClick={()=>setTab(id)}><Icon size={22} strokeWidth={tab===id?2.5:1.8}/><span>{label}</span>{tab===id&&<i/>}</button>)}</nav>}

export default App;
