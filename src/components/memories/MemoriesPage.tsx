import { CalendarDays, ChevronRight, Crown, GripVertical, Heart, MapPin, Phone, Plus, Settings2, Sparkles, Trophy, Video, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type React from 'react';
import { addDoc, collection, deleteDoc, doc, onSnapshot, orderBy, query, serverTimestamp } from 'firebase/firestore';
import type { Memory, MemoryDraft } from '../../types';
import { auth, db } from '../../lib/firebase';
import { getRealCoupleConnection, type RealCoupleConnection } from '../../lib/coupleConnection';
import { subscribeCoupleShared } from '../../lib/coupleShared';
import { loadProfile, type UserProfile } from '../../utils/profile';
import { loadLocationVisits } from '../../utils/location';
import { MemoryCard } from './MemoryCard';
import { MemoryDetail } from './MemoryDetail';
import { MemoryForm } from './MemoryForm';
import { PlaceTimeline } from './PlaceTimeline';

type Filter = 'all' | 'favorite' | string;
export type HubTabId = 'album' | 'anniversary' | 'record' | 'tier' | 'schedule' | 'date';
type ScheduleType = 'personal' | 'couple';
type Schedule = { id: string; title: string; date: string; startTime: string; endTime?: string; type: ScheduleType; ownerId: string; memo?: string; location?: string; localOnly?: boolean; source?: 'date-plan'; sourceId?: string };
type DatePlan = { id: number; title: string; date: string; time: string; location: string; memo: string; scheduleId?: string; anniversaryKey?: string };
type AnniversaryItem = { title: string; date: string; icon: string; special?: boolean };

const DEFAULT_TABS: HubTabId[] = ['album', 'anniversary', 'record', 'tier', 'schedule', 'date'];
const TAB_LABEL: Record<HubTabId, string> = { album: '앨범', anniversary: '기념일', record: '기록', tier: '티어', schedule: '일정', date: '데이트' };
const DAY = 86400000;
const todayKey = () => new Date().toISOString().slice(0, 10);
const dayDiff = (date: string) => Math.ceil((new Date(`${date}T00:00:00`).getTime() - new Date(`${todayKey()}T00:00:00`).getTime()) / DAY);
const realName = (profile: UserProfile | null | undefined, fallback: string) => profile?.name?.trim() || fallback;
const SPECIAL_DAYS = [
  [1, 14, '다이어리데이', '📔'], [2, 14, '발렌타인데이', '💝'], [3, 14, '화이트데이', '🤍'],
  [4, 14, '블랙데이', '🍜'], [5, 14, '로즈데이', '🌹'], [6, 14, '키스데이', '💋'],
  [7, 14, '실버데이', '💍'], [8, 14, '그린데이', '🌿'], [9, 14, '포토데이', '📷'],
  [10, 14, '와인데이', '🍷'], [11, 11, '빼빼로데이', '🍫'], [11, 14, '무비데이', '🎬'],
  [12, 14, '허그데이', '🤗'], [12, 25, '크리스마스', '🎄'],
] as const;

function nextAnnual(month: number, day: number) {
  const now = new Date();
  let date = new Date(now.getFullYear(), month - 1, day);
  if (date < new Date(now.getFullYear(), now.getMonth(), now.getDate())) date = new Date(now.getFullYear() + 1, month - 1, day);
  return date.toISOString().slice(0, 10);
}

function thisMonthSpecialDays() {
  const now = new Date();
  return SPECIAL_DAYS.filter(([month]) => month === now.getMonth() + 1).map(([month, day, title, icon]) => ({
    title,
    date: `${now.getFullYear()}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    icon,
    special: true,
  }));
}

function nextBirthday(profile: UserProfile | null, label: string) {
  if (!profile?.birthDate) return null;
  const [, month, day] = profile.birthDate.split('-').map(Number);
  if (!month || !day) return null;
  return { title: `${label} 생일`, date: nextAnnual(month, day), icon: '🎂', special: false };
}

function dayBadge(date: string) {
  const left = dayDiff(date);
  if (left === 0) return 'D-DAY';
  return left > 0 ? `D-${left}` : `D+${Math.abs(left)}`;
}

function anniversaryPlanKey(item: AnniversaryItem) {
  return `${item.title}:${item.date}`;
}

export function MemoriesPage({ requestedTab, Header, memories, setMemories, initialMemoryId, initialDraft, onClearInitial, onClearInitialDraft, onOpenLocation }: {
  requestedTab?: HubTabId;
  Header: ({ title }: { title?: string }) => React.ReactNode;
  memories: Memory[];
  setMemories: React.Dispatch<React.SetStateAction<Memory[]>>;
  initialMemoryId?: number;
  initialDraft?: MemoryDraft;
  onClearInitial: () => void;
  onClearInitialDraft: () => void;
  onOpenLocation?: (place: string) => void;
}) {
  const uid = auth.currentUser?.uid ?? '';
  const profile = uid ? loadProfile(uid) : null;
  const [connection, setConnection] = useState<RealCoupleConnection | null>(null);
  const [relationshipStartDate, setRelationshipStartDate] = useState<string>();
  const [activeTab, setActiveTab] = useState<HubTabId>(requestedTab ?? 'album');
  const [tabOrder, setTabOrder] = useState<HubTabId[]>(() => {
    try { const parsed = JSON.parse(localStorage.getItem(`route-hub-tabs:${uid}`) || '[]') as HubTabId[]; return parsed.length === DEFAULT_TABS.length ? parsed : DEFAULT_TABS; } catch { return DEFAULT_TABS; }
  });
  const [orderOpen, setOrderOpen] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [selected, setSelected] = useState<number | undefined>(initialMemoryId);
  const [editing, setEditing] = useState<Memory | null>();
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [localSchedules, setLocalSchedules] = useState<Schedule[]>(() => { try { return JSON.parse(localStorage.getItem(`route-local-schedules:${uid}`) || '[]') as Schedule[]; } catch { return []; } });
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleFeedback, setScheduleFeedback] = useState('');
  const [scheduleForm, setScheduleForm] = useState({ title: '', date: todayKey(), startTime: '19:00', type: 'couple' as ScheduleType, location: '' });
  const [datePlans, setDatePlans] = useState<DatePlan[]>(() => { try { return JSON.parse(localStorage.getItem(`route-date-plans:${uid}`) || '[]'); } catch { return []; } });
  const [dateOpen, setDateOpen] = useState(false);
  const [dateFeedback, setDateFeedback] = useState('');
  const [dateSourceKey, setDateSourceKey] = useState<string>();
  const [dateForm, setDateForm] = useState({ title: '', date: todayKey(), time: '18:00', location: '', memo: '' });
  const [placeTimelineFocus, setPlaceTimelineFocus] = useState<string>();

  useEffect(() => { if (!uid) return; void getRealCoupleConnection(uid).then(setConnection).catch(() => setConnection(null)); }, [uid]);
  useEffect(() => { if (!connection?.coupleId) { setRelationshipStartDate(undefined); return; } return subscribeCoupleShared(connection.coupleId, (shared) => setRelationshipStartDate(shared.relationshipStartDate)); }, [connection?.coupleId]);
  useEffect(() => { if (!connection?.coupleId) { setSchedules([]); return; } const q = query(collection(db, 'couples', connection.coupleId, 'schedules'), orderBy('date', 'asc')); return onSnapshot(q, (snap) => setSchedules(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Schedule, 'id'>) }))), () => setScheduleFeedback('공유 일정을 불러오지 못해 이 기기에 저장된 일정만 표시해요.')); }, [connection?.coupleId]);
  useEffect(() => { try { localStorage.setItem(`route-hub-tabs:${uid}`, JSON.stringify(tabOrder)); } catch {} }, [tabOrder, uid]);
  useEffect(() => { try { localStorage.setItem(`route-date-plans:${uid}`, JSON.stringify(datePlans)); } catch { setDateFeedback('기기 저장 공간을 확인해 주세요.'); } }, [datePlans, uid]);
  useEffect(() => { try { localStorage.setItem(`route-local-schedules:${uid}`, JSON.stringify(localSchedules)); } catch { setScheduleFeedback('기기 저장 공간을 확인해 주세요.'); } }, [localSchedules, uid]);
  useEffect(() => {
    if (!initialDraft) return;
    setSelected(undefined);
    setActiveTab('album');
    setEditing(null);
  }, [initialDraft]);
  useEffect(() => {
    if (!requestedTab) return;
    setActiveTab(requestedTab);
  }, [requestedTab]);

  useEffect(() => {
    const handleBack = (event: Event) => {
      if (event.defaultPrevented) return;
      if (editing !== undefined) { event.preventDefault(); setEditing(undefined); if (initialDraft) onClearInitialDraft(); return; }
      if (scheduleOpen) { event.preventDefault(); setScheduleOpen(false); return; }
      if (dateOpen) { event.preventDefault(); setDateOpen(false); setDateSourceKey(undefined); return; }
      if (orderOpen) { event.preventDefault(); setOrderOpen(false); return; }
      if (selected !== undefined) { event.preventDefault(); setSelected(undefined); onClearInitial(); }
    };
    window.addEventListener('route-native-back', handleBack);
    return () => window.removeEventListener('route-native-back', handleBack);
  }, [dateOpen, editing, initialDraft, onClearInitial, onClearInitialDraft, orderOpen, scheduleOpen, selected]);

  const years = useMemo(() => [...new Set(memories.map((memory) => memory.date.slice(0, 4)))].sort().reverse(), [memories]);
  const shown = memories.filter((memory) => filter === 'all' || filter === 'favorite' && memory.favorite || memory.date.startsWith(filter));
  const selectedMemory = memories.find((memory) => memory.id === selected);
  const update = (memory: Memory) => setMemories((items) => items.some((item) => item.id === memory.id) ? items.map((item) => item.id === memory.id ? memory : item) : [memory, ...items]);
  const favorite = (id: number) => setMemories((items) => items.map((item) => item.id === id ? { ...item, favorite: !item.favorite } : item));
  const partner = connection?.partnerProfile ?? null;
  const visibleSchedules = useMemo(() => [...schedules, ...localSchedules.filter((local) => !schedules.some((remote) => remote.id === local.id))].sort((a, b) => `${a.date} ${a.startTime}`.localeCompare(`${b.date} ${b.startTime}`)), [localSchedules, schedules]);

  const sameDayMemories = useMemo(() => {
    const now = new Date();
    const mmdd = `${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    return memories.filter((memory) => memory.date.slice(5) === mmdd && Number(memory.date.slice(0, 4)) < now.getFullYear()).sort((a, b) => b.date.localeCompare(a.date));
  }, [memories]);

  const anniversaries = useMemo(() => {
    const personal: AnniversaryItem[] = [];
    const mine = nextBirthday(profile, realName(profile, '내'));
    const theirs = nextBirthday(partner, realName(partner, '상대방'));
    if (mine) personal.push(mine); if (theirs) personal.push(theirs);
    if (relationshipStartDate) {
      const start = new Date(`${relationshipStartDate}T00:00:00`);
      const now = new Date(`${todayKey()}T00:00:00`);
      const current = Math.max(1, Math.floor((now.getTime() - start.getTime()) / DAY) + 1);
      const nextHundred = Math.ceil(current / 100) * 100;
      personal.push({ title: `우리의 ${nextHundred}일`, date: new Date(start.getTime() + (nextHundred - 1) * DAY).toISOString().slice(0, 10), icon: '❤️', special: false });
      let year = now.getFullYear() - start.getFullYear();
      let anniversary = new Date(start.getFullYear() + year, start.getMonth(), start.getDate());
      if (anniversary < now) { year += 1; anniversary = new Date(start.getFullYear() + year, start.getMonth(), start.getDate()); }
      if (year > 0) personal.push({ title: `${year}주년`, date: anniversary.toISOString().slice(0, 10), icon: '💞', special: false });
    }
    return [...thisMonthSpecialDays(), ...personal].sort((a, b) => a.date.localeCompare(b.date));
  }, [profile, partner, relationshipStartDate]);

  const visits = uid ? loadLocationVisits(uid) : [];
  const placeCounts = visits.reduce<Record<string, number>>((acc, visit) => { const key = visit.placeName || '기록된 장소'; acc[key] = (acc[key] || 0) + 1; return acc; }, {});
  const topPlace = Object.entries(placeCounts).sort((a, b) => b[1] - a[1])[0];

  const moveTab = (tab: HubTabId, direction: -1 | 1) => setTabOrder((items) => { const index = items.indexOf(tab); const nextIndex = index + direction; if (nextIndex < 0 || nextIndex >= items.length) return items; const next = [...items]; [next[index], next[nextIndex]] = [next[nextIndex], next[index]]; return next; });
  const resetScheduleForm = () => setScheduleForm({ title: '', date: todayKey(), startTime: '19:00', type: 'couple' as ScheduleType, location: '' });
  const resetDateForm = () => { setDateForm({ title: '', date: todayKey(), time: '18:00', location: '', memo: '' }); setDateSourceKey(undefined); };
  const saveSchedule = async () => {
    const title = scheduleForm.title.trim();
    if (!title) { setScheduleFeedback('일정 제목을 입력해 주세요.'); return; }
    const payload = { ...scheduleForm, title, ownerId: uid };
    setScheduleFeedback('');
    if (connection?.coupleId) {
      try {
        await addDoc(collection(db, 'couples', connection.coupleId, 'schedules'), { ...payload, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
        setScheduleFeedback('일정을 저장했어요. 상대방 화면에도 함께 반영돼요.');
        setScheduleOpen(false); resetScheduleForm(); return;
      } catch (cause) {
        console.error('[ROUTE schedule save]', cause);
      }
    }
    const local: Schedule = { id: `local-${Date.now()}`, ...payload, localOnly: true };
    setLocalSchedules((items) => [...items, local]);
    setScheduleFeedback(connection ? '공유 저장에 실패해 우선 이 기기에 안전하게 저장했어요.' : '상대방 연결 전이라 이 기기에 일정을 저장했어요.');
    setScheduleOpen(false); resetScheduleForm();
  };

  const openDatePlan = (item?: AnniversaryItem) => {
    setDateFeedback('');
    if (!item) {
      resetDateForm();
      setDateOpen(true);
      return;
    }
    const key = anniversaryPlanKey(item);
    const existing = datePlans.find((plan) => plan.anniversaryKey === key);
    if (existing) {
      setActiveTab('date');
      setDateFeedback(`${item.title} 데이트 계획이 이미 있어요.`);
      return;
    }
    setDateSourceKey(key);
    setDateForm({ title: `${item.title} 데이트`, date: item.date, time: '18:00', location: '', memo: `${item.title}을 함께 보내기 위한 데이트 계획` });
    setDateOpen(true);
  };

  const saveDatePlan = async () => {
    const title = dateForm.title.trim();
    if (!title) { setDateFeedback('데이트 이름을 입력해 주세요.'); return; }

    const id = Date.now();
    const localScheduleId = `date-${id}`;
    const schedulePayload = {
      title,
      date: dateForm.date,
      startTime: dateForm.time,
      type: 'couple' as const,
      ownerId: uid,
      memo: dateForm.memo.trim(),
      location: dateForm.location.trim(),
      source: 'date-plan' as const,
      sourceId: String(id),
    };
    const localSchedule: Schedule = { id: localScheduleId, ...schedulePayload, localOnly: true };
    const plan: DatePlan = { ...dateForm, id, title, location: dateForm.location.trim(), memo: dateForm.memo.trim(), scheduleId: localScheduleId, anniversaryKey: dateSourceKey };

    setDatePlans((items) => [...items, plan]);
    setLocalSchedules((items) => [...items.filter((item) => item.id !== localScheduleId), localSchedule]);
    setDateOpen(false);
    resetDateForm();
    setActiveTab('date');

    if (!connection?.coupleId) {
      setDateFeedback('데이트를 저장했고 우리 일정에도 연결했어요. 상대방 연결 후에는 공유 일정으로 저장할 수 있어요.');
      return;
    }

    setDateFeedback('데이트를 저장했어요. 우리 일정에 공유하는 중이에요…');
    try {
      const ref = await addDoc(collection(db, 'couples', connection.coupleId, 'schedules'), { ...schedulePayload, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
      setLocalSchedules((items) => items.filter((item) => item.id !== localScheduleId));
      setDatePlans((items) => items.map((item) => item.id === id ? { ...item, scheduleId: ref.id } : item));
      setDateFeedback('데이트와 우리 일정에 함께 저장했어요. 상대방에게도 일정이 보여요.');
    } catch (cause) {
      console.error('[ROUTE date schedule link]', cause);
      setDateFeedback('데이트는 저장됐어요. 공유 일정 연결에 실패해 이 기기의 우리 일정에 안전하게 남겨뒀어요.');
    }
  };

  const deleteDatePlan = async (plan: DatePlan) => {
    setDatePlans((items) => items.filter((item) => item.id !== plan.id));
    if (!plan.scheduleId) { setDateFeedback('데이트 계획을 삭제했어요.'); return; }

    if (plan.scheduleId.startsWith('date-') || plan.scheduleId.startsWith('local-')) {
      setLocalSchedules((items) => items.filter((item) => item.id !== plan.scheduleId));
      setDateFeedback('데이트와 연결된 우리 일정을 함께 삭제했어요.');
      return;
    }

    if (!connection?.coupleId) {
      setDateFeedback('데이트는 삭제했어요. 연결된 공유 일정은 상대방 연결 후 일정 탭에서 확인해 주세요.');
      return;
    }

    try {
      await deleteDoc(doc(db, 'couples', connection.coupleId, 'schedules', plan.scheduleId));
      setDateFeedback('데이트와 연결된 우리 일정을 함께 삭제했어요.');
    } catch (cause) {
      console.error('[ROUTE linked schedule delete]', cause);
      setDateFeedback('데이트는 삭제했지만 공유 일정 삭제에 실패했어요. 일정 탭에서 한 번 확인해 주세요.');
    }
  };

  if (selectedMemory) return <><MemoryDetail memory={selectedMemory} onBack={() => { setSelected(undefined); onClearInitial(); }} onFavorite={() => favorite(selectedMemory.id)} onEdit={() => setEditing(selectedMemory)} onDelete={() => { setMemories((items) => items.filter((item) => item.id !== selectedMemory.id)); setSelected(undefined); }} onOpenPlaceTimeline={(place) => { setSelected(undefined); onClearInitial(); setActiveTab('record'); setPlaceTimelineFocus(place); }} />{editing && <MemoryForm memory={editing} onClose={() => setEditing(undefined)} onSave={(memory) => { update(memory); setEditing(undefined); }} />}</>;

  return <div className="page memories-page route-hub"><Header title="추억" />
    <div className="hub-head"><div><small>ROUTE TOGETHER</small><h1>{TAB_LABEL[activeTab]}</h1></div><button type="button" className="hub-settings" onClick={() => setOrderOpen(true)}><Settings2 size={18} /></button></div>
    <div className="hub-tabs">{tabOrder.map((tab) => <button key={tab} className={activeTab === tab ? 'active' : ''} onClick={() => setActiveTab(tab)}>{TAB_LABEL[tab]}</button>)}</div>

    {activeTab === 'album' && <>
      {sameDayMemories.length > 0 && <section className="last-year-card"><div><Sparkles size={16} /><span><b>작년 우리</b><small>같은 날짜의 추억을 다시 만나보세요</small></span></div><button onClick={() => setSelected(sameDayMemories[0].id)}>바로 보기 <ChevronRight size={15} /></button></section>}
      <div className="memory-filters"><button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>전체</button><button className={filter === 'favorite' ? 'active' : ''} onClick={() => setFilter('favorite')}>즐겨찾기</button>{years.map((year) => <button key={year} className={filter === year ? 'active' : ''} onClick={() => setFilter(year)}>{year}</button>)}</div>
      <div className="memory-list">{shown.map((memory) => <MemoryCard key={memory.id} memory={memory} onOpen={() => setSelected(memory.id)} onFavorite={() => favorite(memory.id)} />)}{!shown.length && <div className="memory-empty">아직 남긴 추억이 없어요.</div>}</div>
      <button className="fab" onClick={() => { onClearInitialDraft(); setEditing(null); }}><Plus size={18} />추억 추가</button>
      {editing !== undefined && <MemoryForm memory={editing ?? undefined} draft={editing === null ? initialDraft : undefined} onClose={() => { setEditing(undefined); if (initialDraft) onClearInitialDraft(); }} onSave={(memory) => { update(memory); setEditing(undefined); onClearInitialDraft(); setSelected(memory.id); }} />}
    </>}

    {activeTab === 'anniversary' && <div className="hub-stack"><section className="hub-hero anniversary-hero"><Heart fill="currentColor" /><div><small>OUR DAYS</small><h2>함께 기다리는 날</h2><p>기념일에서 바로 데이트를 만들면 우리 일정에도 자동으로 이어져요.</p></div></section>{anniversaries.map((item) => { const left = dayDiff(item.date); const alert = [200,100,30,7,1].includes(left); const planned = datePlans.some((plan) => plan.anniversaryKey === anniversaryPlanKey(item)); return <article className="anniversary-row" key={`${item.title}-${item.date}`}><span>{item.icon}</span><div><b>{item.title}</b><small>{item.date.replaceAll('-', '.')}</small>{alert && !item.special && <em>D-{left} 알림 시점이에요</em>}</div><div className="anniversary-flow-actions"><strong>{dayBadge(item.date)}</strong><button type="button" className={planned ? 'planned' : ''} onClick={() => openDatePlan(item)}><Plus size={12} />{planned ? '계획 보기' : '데이트'}</button></div></article>; })}</div>}

    {activeTab === 'record' && <div className="hub-stack"><section className="hub-hero record-hero"><Crown /><div><small>우리의 기록</small><h2>우리의 기록</h2><p>ROUTE 안에서 쌓인 둘의 기록을 모아봤어요.</p></div></section><div className="record-grid"><article><Phone /><small>앱 통화</small><b>준비 중</b><span>ROUTE 통화 기능 연결 예정</span></article><article><Video /><small>영상통화</small><b>준비 중</b><span>앱 영상통화 기록</span></article><article><MapPin /><small>방문 장소</small><b>{visits.length}회</b><span>{topPlace ? `${topPlace[0]} · ${topPlace[1]}회` : '위치 기록을 시작해보세요'}</span></article><article><Heart /><small>추억</small><b>{memories.length}개</b><span>함께 남긴 사진과 영상</span></article></div><PlaceTimeline memories={memories} visits={visits} schedules={visibleSchedules} datePlans={datePlans} initialPlace={placeTimelineFocus} onConsumeInitialPlace={() => setPlaceTimelineFocus(undefined)} onOpenMemory={(id) => setSelected(id)} onOpenLocation={onOpenLocation} /></div>}

    {activeTab === 'tier' && <div className="hub-stack"><section className="hub-hero tier-hero"><Trophy /><div><small>COUPLE TIER</small><h2>이번 달 커플 랭킹</h2><p>공개 참여를 선택한 커플끼리 재미로 경쟁해요.</p></div></section><div className="tier-card"><span>🥇</span><div><b>달달커플</b><small>이번 달 데이트 기록</small></div><strong>24회</strong></div><div className="tier-card"><span>🥈</span><div><b>콩떡커플</b><small>이번 달 데이트 기록</small></div><strong>21회</strong></div><div className="tier-card"><span>🥉</span><div><b>{realName(profile,'나')} ❤️ {realName(partner,'상대방')}</b><small>내 커플 · 샘플 순위</small></div><strong>{Math.max(0, Math.min(20, datePlans.length))}회</strong></div><p className="hub-note">실제 전체 사용자 순위는 서버 집계와 공개 동의 기능을 연결한 뒤 활성화돼요.</p></div>}

    {activeTab === 'schedule' && <div className="hub-stack"><div className="hub-section-head"><div><small>SHARED CALENDAR</small><h2>우리 일정</h2></div><button type="button" onClick={() => { setScheduleFeedback(''); setScheduleOpen(true); }}><Plus size={15} />일정 추가</button></div>{scheduleFeedback && <p className="hub-note">{scheduleFeedback}</p>}{visibleSchedules.map((item) => <article key={item.id} className="hub-list-row"><CalendarDays size={17} /><div><b>{item.title}</b><small>{item.date.replaceAll('-', '.')} · {item.startTime}{item.location ? ` · ${item.location}` : ''}{item.localOnly ? ' · 기기 저장' : ''}</small></div><div className="schedule-flow-actions"><span>{item.source === 'date-plan' ? '데이트' : item.type === 'couple' ? '우리' : item.ownerId === uid ? '나' : realName(partner, '상대')}</span>{item.location && <button type="button" onClick={() => onOpenLocation?.(item.location!)}><MapPin size={12} />지도</button>}</div></article>)}{!visibleSchedules.length && <div className="memory-empty">등록된 일정이 없어요.</div>}</div>}

    {activeTab === 'date' && <div className="hub-stack"><div className="hub-section-head"><div><small>DATE PLAN</small><h2>데이트</h2></div><button type="button" onClick={() => openDatePlan()}><Plus size={15} />데이트 추가</button></div>{dateFeedback && <p className="hub-note date-flow-feedback">{dateFeedback}</p>}{[...datePlans].sort((a,b) => a.date.localeCompare(b.date)).map((item) => <article key={item.id} className="hub-list-row date-row"><Heart size={17} /><div><b>{item.title}</b><small>{item.date.replaceAll('-', '.')} · {item.time}{item.location ? ` · ${item.location}` : ''}</small>{item.memo && <em>{item.memo}</em>}</div><div className="date-flow-actions">{item.scheduleId && <span><CalendarDays size={11} />일정 연결</span>}{item.location && <button type="button" className="map-link" onClick={() => onOpenLocation?.(item.location)}><MapPin size={11} />지도</button>}<button type="button" onClick={() => void deleteDatePlan(item)}>삭제</button></div></article>)}{!datePlans.length && <div className="memory-empty">다음 데이트를 계획해보세요 ❤️</div>}</div>}

    {orderOpen && <div className="hub-order-backdrop"><section className="hub-order-panel"><header><div><small>추억 구성</small><h2>탭 순서 편집</h2></div><button onClick={() => setOrderOpen(false)}><X size={18} /></button></header>{tabOrder.map((tab, index) => <div className="hub-order-row" key={tab}><GripVertical size={16} /><b>{TAB_LABEL[tab]}</b><span><button disabled={index === 0} onClick={() => moveTab(tab,-1)}>↑</button><button disabled={index === tabOrder.length-1} onClick={() => moveTab(tab,1)}>↓</button></span></div>)}</section></div>}

    {scheduleOpen && <div className="hub-order-backdrop"><section className="hub-order-panel compact"><header><div><small>NEW SCHEDULE</small><h2>일정 추가</h2></div><button onClick={() => setScheduleOpen(false)}><X size={18} /></button></header><label>제목<input value={scheduleForm.title} onChange={(e) => setScheduleForm({...scheduleForm,title:e.target.value})} /></label><label>날짜<input type="date" value={scheduleForm.date} onChange={(e) => setScheduleForm({...scheduleForm,date:e.target.value})} /></label><label>시간<input type="time" value={scheduleForm.startTime} onChange={(e) => setScheduleForm({...scheduleForm,startTime:e.target.value})} /></label><label>종류<select value={scheduleForm.type} onChange={(e) => setScheduleForm({...scheduleForm,type:e.target.value as ScheduleType})}><option value="personal">내 일정</option><option value="couple">우리 일정</option></select></label><label>장소<input value={scheduleForm.location} onChange={(e) => setScheduleForm({...scheduleForm,location:e.target.value})} /></label><button className="primary" disabled={!scheduleForm.title.trim()} onClick={() => void saveSchedule()}>저장</button></section></div>}

    {dateOpen && <div className="hub-order-backdrop"><section className="hub-order-panel compact"><header><div><small>{dateSourceKey ? 'FROM ANNIVERSARY' : 'NEW DATE'}</small><h2>{dateSourceKey ? '기념일 데이트 만들기' : '데이트 추가'}</h2></div><button onClick={() => { setDateOpen(false); resetDateForm(); }}><X size={18} /></button></header><p className="date-flow-hint"><CalendarDays size={14} />저장하면 데이트 탭과 우리 일정에 한 번에 추가돼요.</p><label>데이트 이름<input value={dateForm.title} onChange={(e) => setDateForm({...dateForm,title:e.target.value})} /></label><label>날짜<input type="date" value={dateForm.date} onChange={(e) => setDateForm({...dateForm,date:e.target.value})} /></label><label>시간<input type="time" value={dateForm.time} onChange={(e) => setDateForm({...dateForm,time:e.target.value})} /></label><label>장소<input value={dateForm.location} onChange={(e) => setDateForm({...dateForm,location:e.target.value})} /></label><label>메모<textarea value={dateForm.memo} onChange={(e) => setDateForm({...dateForm,memo:e.target.value})} /></label><button className="primary" disabled={!dateForm.title.trim()} onClick={() => void saveDatePlan()}>데이트 + 우리 일정 저장</button></section></div>}
  </div>;
}
