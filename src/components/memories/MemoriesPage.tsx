import { CalendarDays, Cake, ChevronDown, ChevronRight, Crown, GripVertical, Heart, MapPin, Phone, Plus, Settings2, Sparkles, Trophy, Video, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type React from 'react';
import { addDoc, collection, onSnapshot, orderBy, query, serverTimestamp } from 'firebase/firestore';
import type { Memory } from '../../types';
import { auth, db } from '../../lib/firebase';
import { getRealCoupleConnection, type RealCoupleConnection } from '../../lib/coupleConnection';
import { subscribeCoupleShared } from '../../lib/coupleShared';
import { displayName, loadProfile, type UserProfile } from '../../utils/profile';
import { loadLocationVisits } from '../../utils/location';
import { MemoryCard } from './MemoryCard';
import { MemoryDetail } from './MemoryDetail';
import { MemoryForm } from './MemoryForm';

type Filter = 'all' | 'favorite' | string;
type HubTab = 'album' | 'anniversary' | 'record' | 'tier' | 'schedule' | 'date';
type ScheduleType = 'personal' | 'couple';
type Schedule = { id: string; title: string; date: string; startTime: string; endTime?: string; type: ScheduleType; ownerId: string; memo?: string; location?: string };
type DatePlan = { id: number; title: string; date: string; time: string; location: string; memo: string };

const DEFAULT_TABS: HubTab[] = ['album', 'anniversary', 'record', 'tier', 'schedule', 'date'];
const TAB_LABEL: Record<HubTab, string> = { album: '앨범', anniversary: '기념일', record: 'Record', tier: '티어', schedule: '일정', date: '데이트' };
const DAY = 86400000;
const todayKey = () => new Date().toISOString().slice(0, 10);
const dayDiff = (date: string) => Math.ceil((new Date(`${date}T00:00:00`).getTime() - new Date(`${todayKey()}T00:00:00`).getTime()) / DAY);
const realName = (profile: UserProfile | null | undefined, fallback: string) => profile?.name?.trim() || fallback;

function nextAnnual(month: number, day: number) {
  const now = new Date();
  let date = new Date(now.getFullYear(), month - 1, day);
  if (date < new Date(now.getFullYear(), now.getMonth(), now.getDate())) date = new Date(now.getFullYear() + 1, month - 1, day);
  return date.toISOString().slice(0, 10);
}

function nextBirthday(profile: UserProfile | null, label: string) {
  if (!profile?.birthDate) return null;
  const [, month, day] = profile.birthDate.split('-').map(Number);
  if (!month || !day) return null;
  return { title: `${label} 생일`, date: nextAnnual(month, day), icon: '🎂' };
}

export function MemoriesPage({ Header, memories, setMemories, initialMemoryId, onClearInitial }: { Header: ({ title }: { title?: string }) => React.ReactNode; memories: Memory[]; setMemories: React.Dispatch<React.SetStateAction<Memory[]>>; initialMemoryId?: number; onClearInitial: () => void }) {
  const uid = auth.currentUser?.uid ?? '';
  const profile = uid ? loadProfile(uid) : null;
  const [connection, setConnection] = useState<RealCoupleConnection | null>(null);
  const [relationshipStartDate, setRelationshipStartDate] = useState<string>();
  const [activeTab, setActiveTab] = useState<HubTab>('album');
  const [tabOrder, setTabOrder] = useState<HubTab[]>(() => {
    try { const parsed = JSON.parse(localStorage.getItem(`route-hub-tabs:${uid}`) || '[]') as HubTab[]; return parsed.length === DEFAULT_TABS.length ? parsed : DEFAULT_TABS; } catch { return DEFAULT_TABS; }
  });
  const [orderOpen, setOrderOpen] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [selected, setSelected] = useState<number | undefined>(initialMemoryId);
  const [editing, setEditing] = useState<Memory | null>();
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleForm, setScheduleForm] = useState({ title: '', date: todayKey(), startTime: '19:00', type: 'couple' as ScheduleType, location: '' });
  const [datePlans, setDatePlans] = useState<DatePlan[]>(() => { try { return JSON.parse(localStorage.getItem(`route-date-plans:${uid}`) || '[]'); } catch { return []; } });
  const [dateOpen, setDateOpen] = useState(false);
  const [dateForm, setDateForm] = useState({ title: '', date: todayKey(), time: '18:00', location: '', memo: '' });

  useEffect(() => { if (!uid) return; void getRealCoupleConnection(uid).then(setConnection).catch(() => setConnection(null)); }, [uid]);
  useEffect(() => { if (!connection?.coupleId) return setRelationshipStartDate(undefined); return subscribeCoupleShared(connection.coupleId, (shared) => setRelationshipStartDate(shared.relationshipStartDate)); }, [connection?.coupleId]);
  useEffect(() => { if (!connection?.coupleId) return setSchedules([]); const q = query(collection(db, 'couples', connection.coupleId, 'schedules'), orderBy('date', 'asc')); return onSnapshot(q, (snap) => setSchedules(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Schedule, 'id'>) })))); }, [connection?.coupleId]);
  useEffect(() => { localStorage.setItem(`route-hub-tabs:${uid}`, JSON.stringify(tabOrder)); }, [tabOrder, uid]);
  useEffect(() => { localStorage.setItem(`route-date-plans:${uid}`, JSON.stringify(datePlans)); }, [datePlans, uid]);

  const years = useMemo(() => [...new Set(memories.map((memory) => memory.date.slice(0, 4)))].sort().reverse(), [memories]);
  const shown = memories.filter((memory) => filter === 'all' || filter === 'favorite' && memory.favorite || memory.date.startsWith(filter));
  const selectedMemory = memories.find((memory) => memory.id === selected);
  const update = (memory: Memory) => setMemories((items) => items.some((item) => item.id === memory.id) ? items.map((item) => item.id === memory.id ? memory : item) : [memory, ...items]);
  const favorite = (id: number) => setMemories((items) => items.map((item) => item.id === id ? { ...item, favorite: !item.favorite } : item));
  const partner = connection?.partnerProfile ?? null;

  const sameDayMemories = useMemo(() => {
    const now = new Date();
    const mmdd = `${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    return memories.filter((memory) => memory.date.slice(5) === mmdd && Number(memory.date.slice(0, 4)) < now.getFullYear()).sort((a, b) => b.date.localeCompare(a.date));
  }, [memories]);

  const anniversaries = useMemo(() => {
    const items: { title: string; date: string; icon: string }[] = [];
    const mine = nextBirthday(profile, realName(profile, '내'));
    const theirs = nextBirthday(partner, realName(partner, '상대방'));
    if (mine) items.push(mine); if (theirs) items.push(theirs);
    items.push({ title: '발렌타인데이', date: nextAnnual(2, 14), icon: '💝' }, { title: '화이트데이', date: nextAnnual(3, 14), icon: '🤍' }, { title: '크리스마스', date: nextAnnual(12, 25), icon: '🎄' });
    if (relationshipStartDate) {
      const start = new Date(`${relationshipStartDate}T00:00:00`);
      const now = new Date(`${todayKey()}T00:00:00`);
      const current = Math.max(1, Math.floor((now.getTime() - start.getTime()) / DAY) + 1);
      const nextHundred = Math.ceil(current / 100) * 100;
      items.push({ title: `우리의 ${nextHundred}일`, date: new Date(start.getTime() + (nextHundred - 1) * DAY).toISOString().slice(0, 10), icon: '❤️' });
      let year = now.getFullYear() - start.getFullYear();
      let anniversary = new Date(start.getFullYear() + year, start.getMonth(), start.getDate());
      if (anniversary < now) { year += 1; anniversary = new Date(start.getFullYear() + year, start.getMonth(), start.getDate()); }
      if (year > 0) items.push({ title: `${year}주년`, date: anniversary.toISOString().slice(0, 10), icon: '💞' });
    }
    return items.sort((a, b) => a.date.localeCompare(b.date));
  }, [profile, partner, relationshipStartDate]);

  const visits = uid ? loadLocationVisits(uid) : [];
  const placeCounts = visits.reduce<Record<string, number>>((acc, visit) => { const key = visit.placeName || '기록된 장소'; acc[key] = (acc[key] || 0) + 1; return acc; }, {});
  const topPlace = Object.entries(placeCounts).sort((a, b) => b[1] - a[1])[0];

  const moveTab = (tab: HubTab, direction: -1 | 1) => setTabOrder((items) => { const index = items.indexOf(tab); const nextIndex = index + direction; if (nextIndex < 0 || nextIndex >= items.length) return items; const next = [...items]; [next[index], next[nextIndex]] = [next[nextIndex], next[index]]; return next; });

  const saveSchedule = async () => {
    if (!connection?.coupleId || !scheduleForm.title.trim()) return;
    await addDoc(collection(db, 'couples', connection.coupleId, 'schedules'), { ...scheduleForm, title: scheduleForm.title.trim(), ownerId: uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    setScheduleOpen(false); setScheduleForm({ title: '', date: todayKey(), startTime: '19:00', type: 'couple', location: '' });
  };

  if (selectedMemory) return <><MemoryDetail memory={selectedMemory} onBack={() => { setSelected(undefined); onClearInitial(); }} onFavorite={() => favorite(selectedMemory.id)} onEdit={() => setEditing(selectedMemory)} onDelete={() => { setMemories((items) => items.filter((item) => item.id !== selectedMemory.id)); setSelected(undefined); }} />{editing && <MemoryForm memory={editing} onClose={() => setEditing(undefined)} onSave={(memory) => { update(memory); setEditing(undefined); }} />}</>;

  return <div className="page memories-page route-hub"><Header title="앨범" />
    <div className="hub-head"><div><small>ROUTE TOGETHER</small><h1>{TAB_LABEL[activeTab]}</h1></div><button type="button" className="hub-settings" onClick={() => setOrderOpen(true)}><Settings2 size={18} /></button></div>
    <div className="hub-tabs">{tabOrder.map((tab) => <button key={tab} className={activeTab === tab ? 'active' : ''} onClick={() => setActiveTab(tab)}>{TAB_LABEL[tab]}</button>)}</div>

    {activeTab === 'album' && <>
      {sameDayMemories.length > 0 && <section className="last-year-card"><div><Sparkles size={16} /><span><b>작년 우리</b><small>같은 날짜의 추억을 다시 만나보세요</small></span></div><button onClick={() => setSelected(sameDayMemories[0].id)}>바로 보기 <ChevronRight size={15} /></button></section>}
      <div className="memory-filters"><button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>전체</button><button className={filter === 'favorite' ? 'active' : ''} onClick={() => setFilter('favorite')}>즐겨찾기</button>{years.map((year) => <button key={year} className={filter === year ? 'active' : ''} onClick={() => setFilter(year)}>{year}</button>)}</div>
      <div className="memory-list">{shown.map((memory) => <MemoryCard key={memory.id} memory={memory} onOpen={() => setSelected(memory.id)} onFavorite={() => favorite(memory.id)} />)}{!shown.length && <div className="memory-empty">아직 남긴 추억이 없어요.</div>}</div>
      <button className="fab" onClick={() => setEditing(null)}><Plus size={18} />추억 추가</button>
      {editing !== undefined && <MemoryForm memory={editing ?? undefined} onClose={() => setEditing(undefined)} onSave={(memory) => { update(memory); setEditing(undefined); setSelected(memory.id); }} />}
    </>}

    {activeTab === 'anniversary' && <div className="hub-stack"><section className="hub-hero anniversary-hero"><Heart fill="currentColor" /><div><small>OUR DAYS</small><h2>함께 기다리는 날</h2><p>생일과 기념일, 특별한 날을 한눈에 확인해요.</p></div></section>{anniversaries.map((item) => { const left = dayDiff(item.date); const alert = [200,100,30,7,1].includes(left); return <article className="anniversary-row" key={`${item.title}-${item.date}`}><span>{item.icon}</span><div><b>{item.title}</b><small>{item.date.replaceAll('-', '.')}</small>{alert && <em>D-{left} 알림 시점이에요</em>}</div><strong>{left === 0 ? 'D-DAY' : `D-${left}`}</strong></article>; })}</div>}

    {activeTab === 'record' && <div className="hub-stack"><section className="hub-hero record-hero"><Crown /><div><small>OUR RECORD</small><h2>우리의 기록</h2><p>ROUTE 안에서 쌓인 둘의 기록을 모아봤어요.</p></div></section><div className="record-grid"><article><Phone /><small>앱 통화</small><b>준비 중</b><span>ROUTE 통화 기능 연결 예정</span></article><article><Video /><small>영상통화</small><b>준비 중</b><span>앱 영상통화 기록</span></article><article><MapPin /><small>방문 장소</small><b>{visits.length}회</b><span>{topPlace ? `${topPlace[0]} · ${topPlace[1]}회` : '위치 기록을 시작해보세요'}</span></article><article><Heart /><small>추억</small><b>{memories.length}개</b><span>함께 남긴 사진과 영상</span></article></div></div>}

    {activeTab === 'tier' && <div className="hub-stack"><section className="hub-hero tier-hero"><Trophy /><div><small>COUPLE TIER</small><h2>이번 달 커플 랭킹</h2><p>공개 참여를 선택한 커플끼리 재미로 경쟁해요.</p></div></section><div className="tier-card"><span>🥇</span><div><b>달달커플</b><small>이번 달 데이트 기록</small></div><strong>24회</strong></div><div className="tier-card"><span>🥈</span><div><b>콩떡커플</b><small>이번 달 데이트 기록</small></div><strong>21회</strong></div><div className="tier-card"><span>🥉</span><div><b>{realName(profile,'나')} ❤️ {realName(partner,'상대방')}</b><small>내 커플 · 샘플 순위</small></div><strong>{Math.max(0, Math.min(20, datePlans.length))}회</strong></div><p className="hub-note">실제 전체 사용자 순위는 서버 집계와 공개 참여 설정을 연결한 뒤 활성화됩니다.</p></div>}

    {activeTab === 'schedule' && <div className="hub-stack"><div className="hub-section-head"><div><small>CALENDAR</small><h2>서로의 일정</h2></div><button onClick={() => setScheduleOpen(true)} disabled={!connection}><Plus size={15} />추가</button></div>{!connection && <div className="hub-empty">상대방을 연결하면 서로의 일정을 함께 볼 수 있어요.</div>}{schedules.map((item) => <article className="schedule-hub-row" key={item.id}><CalendarDays size={17} /><div><b>{item.title}</b><small>{item.date.replaceAll('-', '.')} · {item.startTime}{item.location ? ` · ${item.location}` : ''}</small></div><span>{item.type === 'couple' ? '우리' : item.ownerId === uid ? '내 일정' : '상대 일정'}</span></article>)}</div>}

    {activeTab === 'date' && <div className="hub-stack"><div className="hub-section-head"><div><small>DATE PLAN</small><h2>우리 데이트</h2></div><button onClick={() => setDateOpen(true)}><Plus size={15} />추가</button></div>{datePlans.length ? datePlans.sort((a,b) => a.date.localeCompare(b.date)).map((plan) => <article className="date-plan-card" key={plan.id}><span><Heart size={17} fill="currentColor" /></span><div><small>{plan.date.replaceAll('-', '.')} · {plan.time}</small><b>{plan.title}</b><p>{plan.location}{plan.memo ? ` · ${plan.memo}` : ''}</p></div><button onClick={() => setDatePlans((items) => items.filter((item) => item.id !== plan.id))}>삭제</button></article>) : <div className="hub-empty">다음 데이트를 계획해보세요 ❤️</div>}</div>}

    {orderOpen && <div className="hub-modal-backdrop"><section className="hub-modal"><div className="hub-modal-head"><div><small>EDIT ORDER</small><h2>탭 순서 편집</h2></div><button onClick={() => setOrderOpen(false)}><X /></button></div>{tabOrder.map((tab, index) => <div className="tab-order-row" key={tab}><GripVertical size={18} /><b>{TAB_LABEL[tab]}</b><span><button disabled={index === 0} onClick={() => moveTab(tab,-1)}>↑</button><button disabled={index === tabOrder.length - 1} onClick={() => moveTab(tab,1)}>↓</button></span></div>)}</section></div>}

    {scheduleOpen && <div className="hub-modal-backdrop"><section className="hub-modal"><div className="hub-modal-head"><h2>일정 추가</h2><button onClick={() => setScheduleOpen(false)}><X /></button></div><label>제목<input value={scheduleForm.title} onChange={(e) => setScheduleForm({...scheduleForm,title:e.target.value})} /></label><label>날짜<input type="date" value={scheduleForm.date} onChange={(e) => setScheduleForm({...scheduleForm,date:e.target.value})} /></label><label>시간<input type="time" value={scheduleForm.startTime} onChange={(e) => setScheduleForm({...scheduleForm,startTime:e.target.value})} /></label><label>구분<select value={scheduleForm.type} onChange={(e) => setScheduleForm({...scheduleForm,type:e.target.value as ScheduleType})}><option value="personal">내 일정</option><option value="couple">우리 일정</option></select></label><label>장소<input value={scheduleForm.location} onChange={(e) => setScheduleForm({...scheduleForm,location:e.target.value})} /></label><button className="primary" onClick={() => void saveSchedule()}>저장</button></section></div>}

    {dateOpen && <div className="hub-modal-backdrop"><section className="hub-modal"><div className="hub-modal-head"><h2>데이트 추가</h2><button onClick={() => setDateOpen(false)}><X /></button></div><label>데이트 이름<input value={dateForm.title} onChange={(e) => setDateForm({...dateForm,title:e.target.value})} /></label><label>날짜<input type="date" value={dateForm.date} onChange={(e) => setDateForm({...dateForm,date:e.target.value})} /></label><label>시간<input type="time" value={dateForm.time} onChange={(e) => setDateForm({...dateForm,time:e.target.value})} /></label><label>장소<input value={dateForm.location} onChange={(e) => setDateForm({...dateForm,location:e.target.value})} /></label><label>메모<textarea value={dateForm.memo} onChange={(e) => setDateForm({...dateForm,memo:e.target.value})} /></label><button className="primary" onClick={() => { if (!dateForm.title.trim()) return; setDatePlans((items) => [...items,{...dateForm,title:dateForm.title.trim(),id:Date.now()}]); setDateOpen(false); }}>저장</button></section></div>}
  </div>;
}
