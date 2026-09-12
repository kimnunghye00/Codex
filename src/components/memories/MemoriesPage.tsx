import { CalendarDays, ChevronRight, Crown, GripVertical, Heart, MapPin, Pencil, Phone, Plus, Settings2, Sparkles, Trash2, Trophy, Video, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';
import { addDoc, collection, deleteDoc, doc, onSnapshot, orderBy, query, serverTimestamp, updateDoc } from 'firebase/firestore';
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
const TAB_LABEL: Record<HubTabId, string> = { album: '앨범', anniversary: '기념일', record: '기록', tier: '티어', schedule: '일정', date: '약속' };

function normalizeTabOrder(value: unknown): HubTabId[] {
  if (!Array.isArray(value)) return [...DEFAULT_TABS];
  const next: HubTabId[] = [];
  for (const candidate of value) {
    if (!DEFAULT_TABS.includes(candidate as HubTabId)) continue;
    const tab = candidate as HubTabId;
    if (!next.includes(tab)) next.push(tab);
  }
  for (const tab of DEFAULT_TABS) {
    if (!next.includes(tab)) next.push(tab);
  }
  return next;
}
const DAY = 86400000;
const localDateKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const todayKey = () => localDateKey(new Date());
const dayDiff = (date: string) => Math.ceil((new Date(`${date}T00:00:00`).getTime() - new Date(`${todayKey()}T00:00:00`).getTime()) / DAY);
const realName = (profile: UserProfile | null | undefined, fallback: string) => profile?.name?.trim() || fallback;
const SPECIAL_DAYS = [
  [2, 14, '발렌타인데이', '💝'],
  [3, 14, '화이트데이', '🤍'],
  [5, 14, '로즈데이', '🌹'],
  [6, 14, '키스데이', '💋'],
  [7, 14, '실버데이', '💍'],
  [8, 14, '그린데이', '🌿'],
  [9, 14, '포토·뮤직데이', '📷'],
  [10, 14, '와인데이', '🍷'],
  [11, 11, '빼빼로데이', '🍫'],
  [11, 14, '무비데이', '🎬'],
  [12, 14, '허그데이', '🤗'],
  [12, 25, '크리스마스', '🎄'],
] as const;

function dateInYear(year: number, month: number, day: number) {
  return localDateKey(new Date(year, month - 1, day));
}

function specialDaysForYear(year: number) {
  return SPECIAL_DAYS.map(([month, day, title, icon]) => ({
    title,
    date: dateInYear(year, month, day),
    icon,
    special: true,
  })).sort((a, b) => a.date.localeCompare(b.date));
}

function birthdayForYear(profile: UserProfile | null, label: string, year: number) {
  if (!profile?.birthDate) return null;
  const [, month, day] = profile.birthDate.split('-').map(Number);
  if (!month || !day) return null;
  return { title: `${label} 생일`, date: dateInYear(year, month, day), icon: '🎂', special: false };
}

function dayBadge(date: string) {
  const left = dayDiff(date);
  if (left === 0) return 'D-DAY';
  return left > 0 ? `D-${left}` : `D+${Math.abs(left)}`;
}

function anniversaryPlanKey(item: AnniversaryItem) {
  return `${item.title}:${item.date}`;
}

function scheduleSignature(item: Pick<Schedule, 'title' | 'date' | 'startTime'>) {
  return `${item.title}|${item.date}|${item.startTime}`;
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
    try {
      const parsed = JSON.parse(localStorage.getItem(`route-hub-tabs:${uid}`) || '[]') as unknown;
      return normalizeTabOrder(parsed);
    } catch {
      return [...DEFAULT_TABS];
    }
  });
  const [orderOpen, setOrderOpen] = useState(false);
  const draggingTabRef = useRef<HubTabId | null>(null);
  const [draggingTab, setDraggingTab] = useState<HubTabId | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [selected, setSelected] = useState<number | undefined>(initialMemoryId);
  const [editing, setEditing] = useState<Memory | null>();
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [localSchedules, setLocalSchedules] = useState<Schedule[]>(() => { try { return JSON.parse(localStorage.getItem(`route-local-schedules:${uid}`) || '[]') as Schedule[]; } catch { return []; } });
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [editingScheduleId, setEditingScheduleId] = useState<string>();
  const [scheduleFeedback, setScheduleFeedback] = useState('');
  const [scheduleForm, setScheduleForm] = useState({ title: '', date: todayKey(), startTime: '19:00', location: '' });
  const [datePlans, setDatePlans] = useState<DatePlan[]>(() => { try { return JSON.parse(localStorage.getItem(`route-date-plans:${uid}`) || '[]'); } catch { return []; } });
  const [dateOpen, setDateOpen] = useState(false);
  const [editingDatePlanId, setEditingDatePlanId] = useState<number>();
  const [editingLegacyPromiseId, setEditingLegacyPromiseId] = useState<string>();
  const [dateFeedback, setDateFeedback] = useState('');
  const [dateSourceKey, setDateSourceKey] = useState<string>();
  const [dateForm, setDateForm] = useState({ title: '', date: todayKey(), time: '18:00', location: '', memo: '' });
  const [placeTimelineFocus, setPlaceTimelineFocus] = useState<string>();

  useEffect(() => { if (!uid) return; void getRealCoupleConnection(uid).then(setConnection).catch(() => setConnection(null)); }, [uid]);
  useEffect(() => { if (!connection?.coupleId) { setRelationshipStartDate(undefined); return; } return subscribeCoupleShared(connection.coupleId, (shared) => setRelationshipStartDate(shared.relationshipStartDate)); }, [connection?.coupleId]);
  useEffect(() => { if (!connection?.coupleId) { setSchedules([]); return; } const q = query(collection(db, 'couples', connection.coupleId, 'schedules'), orderBy('date', 'asc')); return onSnapshot(q, (snap) => setSchedules(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Schedule, 'id'>) }))), () => setScheduleFeedback('공유 일정을 불러오지 못해 이 기기에 저장된 일정만 표시해요.')); }, [connection?.coupleId]);
  useEffect(() => { try { localStorage.setItem(`route-hub-tabs:${uid}`, JSON.stringify(tabOrder)); } catch {} }, [tabOrder, uid]);
  useEffect(() => { try { localStorage.setItem(`route-date-plans:${uid}`, JSON.stringify(datePlans)); window.dispatchEvent(new Event('route-schedules-local-change')); } catch { setDateFeedback('기기 저장 공간을 확인해 주세요.'); } }, [datePlans, uid]);
  useEffect(() => { try { localStorage.setItem(`route-local-schedules:${uid}`, JSON.stringify(localSchedules)); window.dispatchEvent(new Event('route-schedules-local-change')); } catch { setScheduleFeedback('기기 저장 공간을 확인해 주세요.'); } }, [localSchedules, uid]);
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
      if (scheduleOpen) { event.preventDefault(); setScheduleOpen(false); setEditingScheduleId(undefined); return; }
      if (dateOpen) { event.preventDefault(); setDateOpen(false); setEditingDatePlanId(undefined); setEditingLegacyPromiseId(undefined); setDateSourceKey(undefined); return; }
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
  const scheduleItems = useMemo(() => visibleSchedules.filter((item) => item.type !== 'couple' && item.source !== 'date-plan'), [visibleSchedules]);
  const promiseScheduleExtras = useMemo(() => {
    const linkedIds = new Set(datePlans.map((plan) => plan.scheduleId).filter(Boolean));
    const planSignatures = new Set(datePlans.map((plan) => `${plan.title}|${plan.date}|${plan.time}`));
    return visibleSchedules.filter((item) => item.type === 'couple' && !linkedIds.has(item.id) && !planSignatures.has(scheduleSignature(item)));
  }, [datePlans, visibleSchedules]);

  const sameDayMemories = useMemo(() => {
    const now = new Date();
    const mmdd = `${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    return memories.filter((memory) => memory.date.slice(5) === mmdd && Number(memory.date.slice(0, 4)) < now.getFullYear()).sort((a, b) => b.date.localeCompare(a.date));
  }, [memories]);

  const anniversaries = useMemo(() => {
    const now = new Date(`${todayKey()}T00:00:00`);
    const currentYear = now.getFullYear();
    const yearStart = new Date(currentYear, 0, 1);
    const yearEnd = new Date(currentYear, 11, 31, 23, 59, 59, 999);
    const personal: AnniversaryItem[] = [];

    const mine = birthdayForYear(profile, realName(profile, '내'), currentYear);
    const theirs = birthdayForYear(partner, realName(partner, '상대방'), currentYear);
    if (mine) personal.push(mine);
    if (theirs) personal.push(theirs);

    if (relationshipStartDate) {
      const start = new Date(`${relationshipStartDate}T00:00:00`);
      const currentDays = Math.max(1, Math.floor((now.getTime() - start.getTime()) / DAY) + 1);
      const milestoneStep = currentDays > 365 ? 1000 : 100;
      const firstDayAtYearStart = Math.max(1, Math.floor((yearStart.getTime() - start.getTime()) / DAY) + 1);
      const lastDayAtYearEnd = Math.max(1, Math.floor((yearEnd.getTime() - start.getTime()) / DAY) + 1);
      const firstMilestone = Math.max(milestoneStep, Math.ceil(firstDayAtYearStart / milestoneStep) * milestoneStep);

      for (let milestone = firstMilestone; milestone <= lastDayAtYearEnd; milestone += milestoneStep) {
        const milestoneDate = new Date(start.getTime() + (milestone - 1) * DAY);
        if (milestoneDate < start || milestoneDate.getFullYear() !== currentYear) continue;
        personal.push({
          title: `우리의 ${milestone}일`,
          date: localDateKey(milestoneDate),
          icon: '❤️',
          special: false,
        });
      }

      const yearsTogether = currentYear - start.getFullYear();
      if (yearsTogether > 0) {
        const yearlyAnniversary = new Date(currentYear, start.getMonth(), start.getDate());
        if (yearlyAnniversary >= start && yearlyAnniversary.getFullYear() === currentYear) {
          personal.push({
            title: `${yearsTogether}주년`,
            date: localDateKey(yearlyAnniversary),
            icon: '💞',
            special: false,
          });
        }
      }
    }

    return [...specialDaysForYear(currentYear), ...personal]
      .filter((item, index, items) => items.findIndex((candidate) => candidate.title === item.title && candidate.date === item.date) === index)
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [profile, partner, relationshipStartDate]);

  const visits = uid ? loadLocationVisits(uid) : [];
  const placeCounts = visits.reduce<Record<string, number>>((acc, visit) => { const key = visit.placeName || '기록된 장소'; acc[key] = (acc[key] || 0) + 1; return acc; }, {});
  const topPlace = Object.entries(placeCounts).sort((a, b) => b[1] - a[1])[0];

  const moveTab = (tab: HubTabId, direction: -1 | 1) => setTabOrder((items) => {
    const next = normalizeTabOrder(items);
    const index = next.indexOf(tab);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= next.length) return next;
    [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
    return next;
  });
  const moveTabTo = (tab: HubTabId, target: HubTabId) => setTabOrder((items) => {
    const next = normalizeTabOrder(items);
    const from = next.indexOf(tab);
    const to = next.indexOf(target);
    if (from < 0 || to < 0 || from === to) return next;
    next.splice(from, 1);
    next.splice(to, 0, tab);
    return next;
  });
  const startTabDrag = (event: React.PointerEvent<HTMLButtonElement>, tab: HubTabId) => {
    event.preventDefault();
    draggingTabRef.current = tab;
    setDraggingTab(tab);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const updateTabDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    const source = draggingTabRef.current;
    if (!source) return;
    const row = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-hub-tab]');
    const target = row?.dataset.hubTab as HubTabId | undefined;
    if (!target || target === source || !DEFAULT_TABS.includes(target)) return;
    moveTabTo(source, target);
  };
  const endTabDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    draggingTabRef.current = null;
    setDraggingTab(null);
  };
  const resetScheduleForm = () => {
    setScheduleForm({ title: '', date: todayKey(), startTime: '19:00', location: '' });
    setEditingScheduleId(undefined);
  };
  const resetDateForm = () => {
    setDateForm({ title: '', date: todayKey(), time: '18:00', location: '', memo: '' });
    setDateSourceKey(undefined);
    setEditingDatePlanId(undefined);
    setEditingLegacyPromiseId(undefined);
  };
  const openScheduleEdit = (item: Schedule) => {
    if (item.ownerId !== uid) {
      setScheduleFeedback('상대방이 만든 일정은 상대방이 수정할 수 있어요.');
      return;
    }
    setScheduleFeedback('');
    setEditingScheduleId(item.id);
    setScheduleForm({ title: item.title, date: item.date, startTime: item.startTime, location: item.location || '' });
    setScheduleOpen(true);
  };
  const deleteSchedule = async (item: Schedule) => {
    if (item.ownerId !== uid) {
      setScheduleFeedback('상대방이 만든 일정은 상대방이 삭제할 수 있어요.');
      return;
    }
    if (item.localOnly || item.id.startsWith('local-')) {
      setLocalSchedules((items) => items.filter((candidate) => candidate.id !== item.id));
      setScheduleFeedback('일정을 삭제했어요.');
      return;
    }
    if (!connection?.coupleId) {
      setScheduleFeedback('연결 상태를 확인한 뒤 다시 삭제해 주세요.');
      return;
    }
    try {
      await deleteDoc(doc(db, 'couples', connection.coupleId, 'schedules', item.id));
      setScheduleFeedback('일정을 삭제했어요.');
    } catch (cause) {
      console.error('[ROUTE schedule delete]', cause);
      setScheduleFeedback('일정을 삭제하지 못했어요. 잠시 후 다시 시도해 주세요.');
    }
  };
  const saveSchedule = async () => {
    const title = scheduleForm.title.trim();
    if (!title) { setScheduleFeedback('일정 제목을 입력해 주세요.'); return; }
    const existing = editingScheduleId ? visibleSchedules.find((item) => item.id === editingScheduleId) : undefined;
    const payload = { ...scheduleForm, title, location: scheduleForm.location.trim(), type: 'personal' as const, ownerId: existing?.ownerId || uid };
    setScheduleFeedback('');

    if (editingScheduleId && existing) {
      if (existing.ownerId !== uid) {
        setScheduleFeedback('상대방이 만든 일정은 상대방이 수정할 수 있어요.');
        return;
      }
      if (existing.localOnly || existing.id.startsWith('local-')) {
        setLocalSchedules((items) => items.map((item) => item.id === existing.id ? { ...item, ...payload, localOnly: true } : item));
        setScheduleFeedback('일정을 수정했어요.');
        setScheduleOpen(false);
        resetScheduleForm();
        return;
      }
      if (!connection?.coupleId) {
        setScheduleFeedback('연결 상태를 확인한 뒤 다시 수정해 주세요.');
        return;
      }
      try {
        await updateDoc(doc(db, 'couples', connection.coupleId, 'schedules', existing.id), {
          title: payload.title,
          date: payload.date,
          startTime: payload.startTime,
          location: payload.location,
          updatedAt: serverTimestamp(),
        });
        setScheduleFeedback('일정을 수정했어요.');
        setScheduleOpen(false);
        resetScheduleForm();
      } catch (cause) {
        console.error('[ROUTE schedule update]', cause);
        setScheduleFeedback('일정을 수정하지 못했어요. 잠시 후 다시 시도해 주세요.');
      }
      return;
    }

    if (connection?.coupleId) {
      try {
        await addDoc(collection(db, 'couples', connection.coupleId, 'schedules'), { ...payload, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
        setScheduleFeedback('일정을 저장했어요.');
        setScheduleOpen(false); resetScheduleForm(); return;
      } catch (cause) {
        console.error('[ROUTE schedule save]', cause);
      }
    }
    const local: Schedule = { id: `local-${Date.now()}`, ...payload, localOnly: true };
    setLocalSchedules((items) => [...items, local]);
    setScheduleFeedback(connection ? '공유 저장에 실패해 우선 이 기기에 안전하게 저장했어요.' : '이 기기에 일정을 저장했어요.');
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
      setDateFeedback(`${item.title} 약속이 이미 있어요.`);
      return;
    }
    setDateSourceKey(key);
    setDateForm({ title: `${item.title} 약속`, date: item.date, time: '18:00', location: '', memo: `${item.title}을 함께 보내기 위한 약속` });
    setDateOpen(true);
  };

  const openDatePlanEdit = (plan: DatePlan) => {
    setDateFeedback('');
    setEditingDatePlanId(plan.id);
    setEditingLegacyPromiseId(undefined);
    setDateSourceKey(plan.anniversaryKey);
    setDateForm({ title: plan.title, date: plan.date, time: plan.time, location: plan.location || '', memo: plan.memo || '' });
    setDateOpen(true);
  };

  const openLegacyPromiseEdit = (item: Schedule) => {
    if (item.ownerId !== uid) {
      setDateFeedback('상대방이 만든 약속은 상대방이 수정할 수 있어요.');
      return;
    }
    setDateFeedback('');
    setEditingDatePlanId(undefined);
    setEditingLegacyPromiseId(item.id);
    setDateSourceKey(undefined);
    setDateForm({ title: item.title, date: item.date, time: item.startTime, location: item.location || '', memo: item.memo || '' });
    setDateOpen(true);
  };

  const deleteLegacyPromise = async (item: Schedule) => {
    if (item.ownerId !== uid) {
      setDateFeedback('상대방이 만든 약속은 상대방이 삭제할 수 있어요.');
      return;
    }
    if (item.localOnly || item.id.startsWith('local-') || item.id.startsWith('promise-') || item.id.startsWith('date-')) {
      setLocalSchedules((items) => items.filter((candidate) => candidate.id !== item.id));
      setDateFeedback('약속을 삭제했어요.');
      return;
    }
    if (!connection?.coupleId) {
      setDateFeedback('연결 상태를 확인한 뒤 다시 삭제해 주세요.');
      return;
    }
    try {
      await deleteDoc(doc(db, 'couples', connection.coupleId, 'schedules', item.id));
      setDateFeedback('약속을 삭제했어요.');
    } catch (cause) {
      console.error('[ROUTE promise delete]', cause);
      setDateFeedback('약속을 삭제하지 못했어요. 잠시 후 다시 시도해 주세요.');
    }
  };

  const saveDatePlan = async () => {
    const title = dateForm.title.trim();
    if (!title) { setDateFeedback('약속 이름을 입력해 주세요.'); return; }

    if (editingLegacyPromiseId) {
      const existing = visibleSchedules.find((item) => item.id === editingLegacyPromiseId);
      if (!existing) {
        setDateFeedback('수정할 약속을 다시 선택해 주세요.');
        return;
      }
      if (existing.ownerId !== uid) {
        setDateFeedback('상대방이 만든 약속은 상대방이 수정할 수 있어요.');
        return;
      }
      const updatePayload = {
        title,
        date: dateForm.date,
        startTime: dateForm.time,
        location: dateForm.location.trim(),
        memo: dateForm.memo.trim(),
      };
      if (existing.localOnly || existing.id.startsWith('local-') || existing.id.startsWith('promise-') || existing.id.startsWith('date-')) {
        setLocalSchedules((items) => items.map((item) => item.id === existing.id ? { ...item, ...updatePayload } : item));
        setDateFeedback('약속을 수정했어요.');
        setDateOpen(false);
        resetDateForm();
        return;
      }
      if (!connection?.coupleId) {
        setDateFeedback('연결 상태를 확인한 뒤 다시 수정해 주세요.');
        return;
      }
      try {
        await updateDoc(doc(db, 'couples', connection.coupleId, 'schedules', existing.id), { ...updatePayload, updatedAt: serverTimestamp() });
        setDateFeedback('약속을 수정했어요.');
        setDateOpen(false);
        resetDateForm();
      } catch (cause) {
        console.error('[ROUTE legacy promise update]', cause);
        setDateFeedback('약속을 수정하지 못했어요. 잠시 후 다시 시도해 주세요.');
      }
      return;
    }

    if (editingDatePlanId !== undefined) {
      const existingPlan = datePlans.find((plan) => plan.id === editingDatePlanId);
      if (!existingPlan) {
        setDateFeedback('수정할 약속을 다시 선택해 주세요.');
        return;
      }
      const updatedPlan: DatePlan = {
        ...existingPlan,
        title,
        date: dateForm.date,
        time: dateForm.time,
        location: dateForm.location.trim(),
        memo: dateForm.memo.trim(),
      };
      const schedulePayload = {
        title,
        date: updatedPlan.date,
        startTime: updatedPlan.time,
        location: updatedPlan.location,
        memo: updatedPlan.memo,
        source: 'date-plan' as const,
        sourceId: String(updatedPlan.id),
      };
      const linkedId = existingPlan.scheduleId;
      if (!linkedId) {
        setDatePlans((items) => items.map((plan) => plan.id === existingPlan.id ? updatedPlan : plan));
        setDateFeedback('약속을 수정했어요.');
        setDateOpen(false);
        resetDateForm();
        return;
      }
      if (linkedId.startsWith('date-') || linkedId.startsWith('promise-') || linkedId.startsWith('local-')) {
        setLocalSchedules((items) => items.map((item) => item.id === linkedId ? { ...item, ...schedulePayload, ownerId: item.ownerId || uid, type: 'couple', localOnly: true } : item));
        setDatePlans((items) => items.map((plan) => plan.id === existingPlan.id ? updatedPlan : plan));
        setDateFeedback('약속을 수정했어요.');
        setDateOpen(false);
        resetDateForm();
        return;
      }
      const linkedSchedule = visibleSchedules.find((item) => item.id === linkedId);
      if (linkedSchedule && linkedSchedule.ownerId !== uid) {
        setDateFeedback('상대방이 만든 약속은 상대방이 수정할 수 있어요.');
        return;
      }
      if (!connection?.coupleId) {
        setDateFeedback('연결 상태를 확인한 뒤 다시 수정해 주세요.');
        return;
      }
      try {
        await updateDoc(doc(db, 'couples', connection.coupleId, 'schedules', linkedId), { ...schedulePayload, updatedAt: serverTimestamp() });
        setDatePlans((items) => items.map((plan) => plan.id === existingPlan.id ? updatedPlan : plan));
        setDateFeedback('약속을 수정했어요.');
        setDateOpen(false);
        resetDateForm();
      } catch (cause) {
        console.error('[ROUTE promise update]', cause);
        setDateFeedback('약속을 수정하지 못했어요. 잠시 후 다시 시도해 주세요.');
      }
      return;
    }

    const id = Date.now();
    const localScheduleId = `promise-${id}`;
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
      setDateFeedback('약속을 이 기기에 저장했어요. 상대방 연결 후에는 함께 동기화할 수 있어요.');
      return;
    }

    setDateFeedback('약속을 상대방과 공유하는 중이에요…');
    try {
      const ref = await addDoc(collection(db, 'couples', connection.coupleId, 'schedules'), { ...schedulePayload, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
      setLocalSchedules((items) => items.filter((item) => item.id !== localScheduleId));
      setDatePlans((items) => items.map((item) => item.id === id ? { ...item, scheduleId: ref.id } : item));
      setDateFeedback('약속을 저장했어요. 상대방에게도 함께 보여요.');
    } catch (cause) {
      console.error('[ROUTE promise schedule link]', cause);
      setDateFeedback('약속은 저장됐어요. 공유에 실패해 이 기기에 안전하게 남겨뒀어요.');
    }
  };

  const deleteDatePlan = async (plan: DatePlan) => {
    if (!plan.scheduleId) {
      setDatePlans((items) => items.filter((item) => item.id !== plan.id));
      setDateFeedback('약속을 삭제했어요.');
      return;
    }

    if (plan.scheduleId.startsWith('date-') || plan.scheduleId.startsWith('promise-') || plan.scheduleId.startsWith('local-')) {
      setLocalSchedules((items) => items.filter((item) => item.id !== plan.scheduleId));
      setDatePlans((items) => items.filter((item) => item.id !== plan.id));
      setDateFeedback('약속을 삭제했어요.');
      return;
    }

    const linkedSchedule = visibleSchedules.find((item) => item.id === plan.scheduleId);
    if (linkedSchedule && linkedSchedule.ownerId !== uid) {
      setDateFeedback('상대방이 만든 약속은 상대방이 삭제할 수 있어요.');
      return;
    }
    if (!connection?.coupleId) {
      setDateFeedback('연결 상태를 확인한 뒤 다시 삭제해 주세요.');
      return;
    }

    try {
      await deleteDoc(doc(db, 'couples', connection.coupleId, 'schedules', plan.scheduleId));
      setDatePlans((items) => items.filter((item) => item.id !== plan.id));
      setDateFeedback('약속을 삭제했어요.');
    } catch (cause) {
      console.error('[ROUTE linked promise delete]', cause);
      setDateFeedback('약속을 삭제하지 못했어요. 잠시 후 다시 시도해 주세요.');
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

    {activeTab === 'anniversary' && <div className="hub-stack"><section className="hub-hero anniversary-hero"><Heart fill="currentColor" /><div><small>OUR DAYS</small><h2>함께 기다리는 날</h2><p>기념일에서 바로 약속을 만들 수 있어요.</p></div></section>{anniversaries.map((item) => { const left = dayDiff(item.date); const alert = [200,100,30,7,1].includes(left); const planned = datePlans.some((plan) => plan.anniversaryKey === anniversaryPlanKey(item)); return <article className="anniversary-row" key={`${item.title}-${item.date}`}><span>{item.icon}</span><div><b>{item.title}</b><small>{item.date.replaceAll('-', '.')}</small>{alert && !item.special && <em>D-{left} 알림 시점이에요</em>}</div><div className="anniversary-flow-actions"><strong>{dayBadge(item.date)}</strong><button type="button" className={planned ? 'planned' : ''} onClick={() => openDatePlan(item)}><Plus size={12} />{planned ? '약속 보기' : '약속'}</button></div></article>; })}</div>}

    {activeTab === 'record' && <div className="hub-stack"><section className="hub-hero record-hero"><Crown /><div><small>우리의 기록</small><h2>우리의 기록</h2><p>ROUTE 안에서 쌓인 둘의 기록을 모아봤어요.</p></div></section><div className="record-grid"><article><Phone /><small>앱 통화</small><b>준비 중</b><span>ROUTE 통화 기능 연결 예정</span></article><article><Video /><small>영상통화</small><b>준비 중</b><span>앱 영상통화 기록</span></article><article><MapPin /><small>방문 장소</small><b>{visits.length}회</b><span>{topPlace ? `${topPlace[0]} · ${topPlace[1]}회` : '위치 기록을 시작해보세요'}</span></article><article><Heart /><small>추억</small><b>{memories.length}개</b><span>함께 남긴 사진과 영상</span></article></div><PlaceTimeline memories={memories} visits={visits} schedules={visibleSchedules} datePlans={datePlans} initialPlace={placeTimelineFocus} onConsumeInitialPlace={() => setPlaceTimelineFocus(undefined)} onOpenMemory={(id) => setSelected(id)} onOpenLocation={onOpenLocation} /></div>}

    {activeTab === 'tier' && <div className="hub-stack"><section className="hub-hero tier-hero"><Trophy /><div><small>COUPLE TIER</small><h2>이번 달 커플 랭킹</h2><p>공개 참여를 선택한 커플끼리 재미로 경쟁해요.</p></div></section><div className="tier-card"><span>🥇</span><div><b>달달커플</b><small>이번 달 데이트 기록</small></div><strong>24회</strong></div><div className="tier-card"><span>🥈</span><div><b>콩떡커플</b><small>이번 달 데이트 기록</small></div><strong>21회</strong></div><div className="tier-card"><span>🥉</span><div><b>{realName(profile,'나')} ❤️ {realName(partner,'상대방')}</b><small>내 커플 · 샘플 순위</small></div><strong>{Math.max(0, Math.min(20, datePlans.length))}회</strong></div><p className="hub-note">실제 전체 사용자 순위는 서버 집계와 공개 동의 기능을 연결한 뒤 활성화돼요.</p></div>}

    {activeTab === 'schedule' && <div className="hub-stack"><div className="hub-section-head"><div><small>CALENDAR</small><h2>일정</h2></div><button type="button" onClick={() => { setScheduleFeedback(''); resetScheduleForm(); setScheduleOpen(true); }}><Plus size={15} />일정 추가</button></div>{scheduleFeedback && <p className="hub-note">{scheduleFeedback}</p>}{scheduleItems.map((item) => <article key={item.id} className="hub-list-row"><CalendarDays size={17} /><div><b>{item.title}</b><small>{item.date.replaceAll('-', '.')} · {item.startTime}{item.location ? ` · ${item.location}` : ''}{item.localOnly ? ' · 기기 저장' : ''}</small></div><div className="schedule-flow-actions route-card-actions"><span className="route-status-chip">{item.localOnly ? '기기 저장' : item.ownerId === uid ? '내 일정' : '상대 일정'}</span><div className="route-action-cluster">{item.location && <button type="button" className="route-action-btn map" onClick={() => onOpenLocation?.(item.location!)}><MapPin size={13} />지도</button>}{item.ownerId === uid && <><button type="button" className="route-action-btn edit" onClick={() => openScheduleEdit(item)}><Pencil size={13} />수정</button><button type="button" className="route-action-btn delete" onClick={() => void deleteSchedule(item)}><Trash2 size={13} />삭제</button></>}</div></div></article>)}{!scheduleItems.length && <div className="memory-empty">등록된 일정이 없어요.</div>}</div>}

    {activeTab === 'date' && <div className="hub-stack"><div className="hub-section-head"><div><small>OUR PROMISE</small><h2>약속</h2></div><button type="button" onClick={() => openDatePlan()}><Plus size={15} />약속 추가</button></div>{dateFeedback && <p className="hub-note date-flow-feedback">{dateFeedback}</p>}{[...datePlans].sort((a,b) => a.date.localeCompare(b.date)).map((item) => <article key={item.id} className="hub-list-row date-row"><Heart size={17} /><div><b>{item.title}</b><small>{item.date.replaceAll('-', '.')} · {item.time}{item.location ? ` · ${item.location}` : ''}</small>{item.memo && <em>{item.memo}</em>}</div><div className="date-flow-actions route-card-actions"><span className="route-status-chip">우리 약속</span><div className="route-action-cluster">{item.location && <button type="button" className="route-action-btn map" onClick={() => onOpenLocation?.(item.location)}><MapPin size={13} />지도</button>}<button type="button" className="route-action-btn edit" onClick={() => openDatePlanEdit(item)}><Pencil size={13} />수정</button><button type="button" className="route-action-btn delete" onClick={() => void deleteDatePlan(item)}><Trash2 size={13} />삭제</button></div></div></article>)}{promiseScheduleExtras.map((item) => <article key={`legacy-${item.id}`} className="hub-list-row date-row"><Heart size={17} /><div><b>{item.title}</b><small>{item.date.replaceAll('-', '.')} · {item.startTime}{item.location ? ` · ${item.location}` : ''}</small>{item.memo && <em>{item.memo}</em>}</div><div className="date-flow-actions route-card-actions"><span className="route-status-chip">기존 약속</span><div className="route-action-cluster">{item.location && <button type="button" className="route-action-btn map" onClick={() => onOpenLocation?.(item.location!)}><MapPin size={13} />지도</button>}{item.ownerId === uid && <><button type="button" className="route-action-btn edit" onClick={() => openLegacyPromiseEdit(item)}><Pencil size={13} />수정</button><button type="button" className="route-action-btn delete" onClick={() => void deleteLegacyPromise(item)}><Trash2 size={13} />삭제</button></>}</div></div></article>)}{!datePlans.length && !promiseScheduleExtras.length && <div className="memory-empty">아직 등록된 약속이 없어요 ❤️</div>}</div>}

    {orderOpen && <div className="hub-order-backdrop"><section className="hub-order-panel route-order-fixed-shell"><header><div><small>추억 구성</small><h2>탭 순서 편집</h2></div><button onClick={() => setOrderOpen(false)} aria-label="탭 순서 편집 닫기"><X size={18} /></button></header>{tabOrder.map((tab) => <div className={`hub-order-row ${draggingTab === tab ? 'dragging' : ''}`} data-hub-tab={tab} key={tab}><button type="button" className="hub-order-drag-handle" aria-label={`${TAB_LABEL[tab]} 순서 이동`} onPointerDown={(event) => startTabDrag(event, tab)} onPointerMove={updateTabDrag} onPointerUp={endTabDrag} onPointerCancel={endTabDrag} onKeyDown={(event) => { if (event.key === 'ArrowUp') { event.preventDefault(); moveTab(tab, -1); } if (event.key === 'ArrowDown') { event.preventDefault(); moveTab(tab, 1); } }}><GripVertical size={18} /></button><b>{TAB_LABEL[tab]}</b></div>)}<footer className="hub-order-footer route-hub-order-native-footer"><button type="button" className="route-hub-order-reset" onClick={() => setTabOrder([...DEFAULT_TABS])}>기본 순서</button><button type="button" className="route-hub-order-done" onClick={() => setOrderOpen(false)}>완료</button></footer></section></div>}

    {scheduleOpen && <div className="hub-order-backdrop route-form-sheet-backdrop"><section className="hub-order-panel compact route-form-sheet route-schedule-sheet"><header><div><small>{editingScheduleId ? 'EDIT SCHEDULE' : 'NEW SCHEDULE'}</small><h2>{editingScheduleId ? '일정 수정' : '일정 추가'}</h2></div><button onClick={() => { setScheduleOpen(false); resetScheduleForm(); }}><X size={18} /></button></header><label>제목<input value={scheduleForm.title} onChange={(e) => setScheduleForm({...scheduleForm,title:e.target.value})} /></label><label>날짜<input type="date" value={scheduleForm.date} onChange={(e) => setScheduleForm({...scheduleForm,date:e.target.value})} /></label><label>시간<input type="time" value={scheduleForm.startTime} onChange={(e) => setScheduleForm({...scheduleForm,startTime:e.target.value})} /></label><label>장소<input value={scheduleForm.location} onChange={(e) => setScheduleForm({...scheduleForm,location:e.target.value})} /></label><p className="hub-note">날짜, 시간, 장소는 저장한 뒤에도 언제든 다시 수정할 수 있어요.</p><button className="primary" disabled={!scheduleForm.title.trim()} onClick={() => void saveSchedule()}>{editingScheduleId ? '수정 저장' : '일정 저장'}</button></section></div>}

    {dateOpen && <div className="hub-order-backdrop route-form-sheet-backdrop"><section className="hub-order-panel compact route-form-sheet route-promise-sheet"><header><div><small>{editingDatePlanId !== undefined || editingLegacyPromiseId ? 'EDIT PROMISE' : dateSourceKey ? 'FROM ANNIVERSARY' : 'NEW PROMISE'}</small><h2>{editingDatePlanId !== undefined || editingLegacyPromiseId ? '약속 수정' : dateSourceKey ? '기념일 약속 만들기' : '약속 추가'}</h2></div><button onClick={() => { setDateOpen(false); resetDateForm(); }}><X size={18} /></button></header><p className="date-flow-hint"><Heart size={14} />날짜, 시간, 장소를 수정하면 공유된 약속에도 함께 반영돼요.</p><label>약속 이름<input value={dateForm.title} onChange={(e) => setDateForm({...dateForm,title:e.target.value})} /></label><label>날짜<input type="date" value={dateForm.date} onChange={(e) => setDateForm({...dateForm,date:e.target.value})} /></label><label>시간<input type="time" value={dateForm.time} onChange={(e) => setDateForm({...dateForm,time:e.target.value})} /></label><label>장소<input value={dateForm.location} onChange={(e) => setDateForm({...dateForm,location:e.target.value})} /></label><label>메모<textarea value={dateForm.memo} onChange={(e) => setDateForm({...dateForm,memo:e.target.value})} /></label><button className="primary" disabled={!dateForm.title.trim()} onClick={() => void saveDatePlan()}>{editingDatePlanId !== undefined || editingLegacyPromiseId ? '수정 저장' : '약속 저장'}</button></section></div>}
  </div>;
}
