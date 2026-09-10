import { useEffect, useMemo, useState } from 'react';
import { addDoc, collection, onSnapshot, orderBy, query, serverTimestamp } from 'firebase/firestore';
import { CalendarDays, ChevronRight, Clock3, Heart, MapPin, Plus, X } from 'lucide-react';
import { db } from '../../lib/firebase';
import type { RealCoupleConnection } from '../../lib/coupleConnection';
import { displayName, type UserProfile } from '../../utils/profile';

type ScheduleType = 'personal' | 'couple';
type ScheduleFilter = 'all' | 'couple' | 'mine' | 'partner';
type CloudWriteState = 'confirmed' | 'queued' | 'failed';

type Schedule = {
  id: string;
  title: string;
  date: string;
  startTime: string;
  endTime?: string;
  type: ScheduleType;
  ownerId: string;
  memo?: string;
  location?: string;
  localOnly?: boolean;
};

type DatePlan = {
  id: number;
  title: string;
  date: string;
  time: string;
  location: string;
  memo: string;
  scheduleId?: string;
};

type Props = {
  uid: string;
  profile: UserProfile;
  connection: RealCoupleConnection | null;
  relationshipStartDate?: string;
  onOpenMyProfile: () => void;
  onOpenConnect: () => void;
};

const localKey = (uid: string) => `route-local-schedules:${uid}`;
const appointmentKey = (uid: string) => `route-date-plans:${uid}`;
const todayKey = () => new Date().toISOString().slice(0, 10);
const CLOUD_ACK_WAIT_MS = 1200;
const SCHEDULE_SUBSCRIBE_DELAY_MS = 450;

function loadLocal(uid: string): Schedule[] {
  try { return JSON.parse(localStorage.getItem(localKey(uid)) || '[]') as Schedule[]; }
  catch { return []; }
}

function saveLocal(uid: string, items: Schedule[]) {
  localStorage.setItem(localKey(uid), JSON.stringify(items));
}

function loadLegacyPromises(uid: string): Schedule[] {
  try {
    const plans = JSON.parse(localStorage.getItem(appointmentKey(uid)) || '[]') as DatePlan[];
    return plans.map((plan) => ({
      id: plan.scheduleId || `promise-${plan.id}`,
      title: plan.title,
      date: plan.date,
      startTime: plan.time,
      type: 'couple' as const,
      ownerId: uid,
      memo: plan.memo || undefined,
      location: plan.location || undefined,
      localOnly: !plan.scheduleId || plan.scheduleId.startsWith('local-') || plan.scheduleId.startsWith('date-'),
    }));
  } catch {
    return [];
  }
}

function scheduleKey(item: Pick<Schedule, 'title' | 'date' | 'startTime' | 'type'>) {
  return `${item.title}|${item.date}|${item.startTime}|${item.type}`;
}

async function observeCloudWrite<T>(write: Promise<T>): Promise<CloudWriteState> {
  let timeout: number | undefined;
  const tracked: Promise<CloudWriteState> = write
    .then(() => 'confirmed' as CloudWriteState)
    .catch((cause) => {
      console.warn('[ROUTE schedule cloud save]', cause);
      return 'failed' as CloudWriteState;
    });
  const delayed = new Promise<CloudWriteState>((resolve) => {
    timeout = window.setTimeout(() => resolve('queued'), CLOUD_ACK_WAIT_MS);
  });
  const result = await Promise.race([tracked, delayed]);
  if (timeout !== undefined) window.clearTimeout(timeout);
  return result;
}

function avatar(profile: UserProfile | null, fallback: string) {
  if (profile?.photoDataUrl) return <img className="!h-full !w-full object-cover" src={profile.photoDataUrl} alt="프로필" />;
  return <span>{profile?.name?.trim()?.slice(0, 1) || fallback}</span>;
}

function prettyDate(value: string) {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  if (value === todayKey()) return '오늘';
  return `${date.getMonth() + 1}월 ${date.getDate()}일`;
}

export function CoupleHomeTools({ uid, profile, connection, relationshipStartDate, onOpenMyProfile, onOpenConnect }: Props) {
  const [remoteSchedules, setRemoteSchedules] = useState<Schedule[]>([]);
  const [localSchedules, setLocalSchedules] = useState<Schedule[]>(() => loadLocal(uid));
  const [legacyPromises, setLegacyPromises] = useState<Schedule[]>(() => loadLegacyPromises(uid));
  const [partnerOpen, setPartnerOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [allOpen, setAllOpen] = useState(false);
  const [filter, setFilter] = useState<ScheduleFilter>('all');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [form, setForm] = useState({ title: '', date: todayKey(), startTime: '19:00', endTime: '', memo: '', location: '' });

  useEffect(() => {
    setLocalSchedules(loadLocal(uid));
    setLegacyPromises(loadLegacyPromises(uid));
  }, [uid]);

  useEffect(() => {
    const refresh = () => setLegacyPromises(loadLegacyPromises(uid));
    window.addEventListener('route-schedules-local-change', refresh);
    window.addEventListener('route-memories-local-change', refresh);
    return () => {
      window.removeEventListener('route-schedules-local-change', refresh);
      window.removeEventListener('route-memories-local-change', refresh);
    };
  }, [uid]);

  useEffect(() => {
    if (!connection?.coupleId) { setRemoteSchedules([]); return; }
    const schedulesRef = collection(db, 'couples', connection.coupleId, 'schedules');
    const q = query(schedulesRef, orderBy('date', 'asc'));
    let unsubscribe: (() => void) | undefined;
    let startTimer: number | undefined;

    const stop = () => {
      if (startTimer !== undefined) window.clearTimeout(startTimer);
      startTimer = undefined;
      unsubscribe?.();
      unsubscribe = undefined;
    };
    const start = () => {
      if (document.visibilityState === 'hidden' || unsubscribe || startTimer !== undefined) return;
      startTimer = window.setTimeout(() => {
        startTimer = undefined;
        if (document.visibilityState === 'hidden') return;
        unsubscribe = onSnapshot(q, (snapshot) => {
          setRemoteSchedules(snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as Omit<Schedule, 'id'>) })));
        }, () => setNotice('공유 일정을 불러오지 못해 기기에 저장된 일정으로 표시하고 있어요.'));
      }, SCHEDULE_SUBSCRIBE_DELAY_MS);
    };
    const syncVisibility = () => {
      if (document.visibilityState === 'hidden') stop();
      else start();
    };

    document.addEventListener('visibilitychange', syncVisibility);
    start();
    return () => {
      document.removeEventListener('visibilitychange', syncVisibility);
      stop();
    };
  }, [connection?.coupleId]);

  const schedules = useMemo(() => {
    const merged = new Map<string, Schedule>();
    legacyPromises.forEach((item) => merged.set(scheduleKey(item), item));
    localSchedules.forEach((item) => merged.set(scheduleKey(item), item));
    remoteSchedules.forEach((item) => merged.set(scheduleKey(item), item));
    return [...merged.values()].sort((a, b) => `${a.date} ${a.startTime}`.localeCompare(`${b.date} ${b.startTime}`));
  }, [legacyPromises, localSchedules, remoteSchedules]);

  const upcoming = useMemo(() => schedules.filter((item) => item.date >= todayKey()).slice(0, 3), [schedules]);
  const partner = connection?.partnerProfile ?? null;
  const partnerName = partner ? displayName(partner) : '상대방';
  const partnerRealName = partner?.name?.trim() || '상대방';
  const myRealName = profile.name?.trim() || '나';

  const filtered = useMemo(() => schedules.filter((item) => {
    if (filter === 'all') return true;
    if (filter === 'couple') return item.type === 'couple';
    if (filter === 'mine') return item.type === 'personal' && item.ownerId === uid;
    return item.type === 'personal' && item.ownerId !== uid;
  }), [filter, schedules, uid]);

  const persistLocal = (schedule: Omit<Schedule, 'id'>) => {
    const local: Schedule = { ...schedule, id: `local-${Date.now()}`, localOnly: true };
    const next = [...localSchedules, local];
    setLocalSchedules(next);
    saveLocal(uid, next);
    window.dispatchEvent(new Event('route-schedules-local-change'));
  };

  const submit = async () => {
    if (!form.title.trim() || !form.date || !form.startTime) {
      setError('제목, 날짜, 시작 시간을 입력해 주세요.');
      return;
    }
    if (saving) return;
    setSaving(true);
    setError('');
    setNotice('');
    const payload: Omit<Schedule, 'id'> = {
      title: form.title.trim(),
      date: form.date,
      startTime: form.startTime,
      endTime: form.endTime || undefined,
      type: 'personal',
      ownerId: uid,
      memo: form.memo.trim() || undefined,
      location: form.location.trim() || undefined,
    };

    persistLocal(payload);

    let cloudState: CloudWriteState = connection?.coupleId ? 'queued' : 'failed';
    if (connection?.coupleId) {
      cloudState = await observeCloudWrite(addDoc(collection(db, 'couples', connection.coupleId, 'schedules'), {
        ...payload,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }));
    }

    setNotice(cloudState === 'confirmed'
      ? '일정을 저장했어요.'
      : cloudState === 'queued'
        ? '일정을 기기에 저장했어요. 연결이 돌아오면 동기화돼요.'
        : '일정을 기기에 저장했어요.');
    setForm({ title: '', date: todayKey(), startTime: '19:00', endTime: '', memo: '', location: '' });
    setScheduleOpen(false);
    setSaving(false);
  };

  return <>
    <section className="home-couple-tools" aria-label="커플 프로필과 일정">
      <div className="home-couple-profile-card !grid !grid-cols-[minmax(0,1fr)_24px_minmax(0,1fr)] !items-center !gap-2 !overflow-hidden !px-3 !py-2 lg:!grid-cols-[minmax(0,1fr)_32px_minmax(0,1fr)] lg:!px-4">
        <button type="button" className="home-person home-person-me !grid !min-w-0 !grid-cols-[32px_minmax(0,1fr)] !items-center !gap-2 !overflow-hidden !bg-transparent !p-0 !text-left" onClick={onOpenMyProfile}>
          <span className="home-profile-avatar !grid !size-8 !shrink-0 place-items-center !overflow-hidden !rounded-full text-[10px] leading-none">{avatar(profile, '나')}</span>
          <span className="home-profile-copy !block !min-w-0 !overflow-hidden"><b className="!block !w-full !truncate !text-[10px] !leading-none">{myRealName}</b><small className="!hidden">내 프로필 편집</small></span>
        </button>
        <span className="home-profile-heart !grid !size-6 shrink-0 place-items-center !leading-none" aria-hidden="true"><Heart size={15} fill="currentColor" /></span>
        <button type="button" className="home-person !grid !min-w-0 !grid-cols-[minmax(0,1fr)_32px] !items-center !gap-2 !overflow-hidden !bg-transparent !p-0 !text-right" onClick={() => connection ? setPartnerOpen(true) : onOpenConnect()}>
          <span className="home-profile-copy !order-1 !block !min-w-0 !overflow-hidden"><b className="!block !w-full !truncate !text-right !text-[10px] !leading-none">{partnerRealName}</b><small className="!hidden">{connection ? '프로필 보기' : '상대 연결하기'}</small></span>
          <span className="home-profile-avatar partner !order-2 !grid !size-8 !shrink-0 place-items-center !overflow-hidden !rounded-full text-[10px] leading-none">{avatar(partner, '상')}</span>
        </button>
      </div>

      <div className="home-schedule-card !min-w-0 !overflow-hidden">
        <div className="home-schedule-head !flex !min-w-0 !items-center !justify-between !gap-1"><span className="!flex !min-w-0 !items-center !gap-1"><CalendarDays size={15} className="shrink-0" /><b className="truncate !leading-none">우리 일정</b></span><button className="!flex shrink-0 !items-center !gap-0.5" type="button" onClick={() => setAllOpen(true)}>전체보기 <ChevronRight size={13} /></button></div>
        {notice && <p className="schedule-help route-home-save-notice">{notice}</p>}
        <div className="home-schedule-list !min-w-0">
          {upcoming.length ? upcoming.map((item) => {
            const mine = item.ownerId === uid;
            const label = item.type === 'couple' ? '약속' : mine ? '나' : partnerName;
            return <div className="home-schedule-row !min-w-0" key={item.id}><span className={`schedule-dot ${item.type === 'couple' ? 'couple' : mine ? 'mine' : 'partner'}`} /><span className="schedule-when !min-w-0"><b>{prettyDate(item.date)}</b><small>{item.startTime}</small></span><strong className="!min-w-0 !truncate">{item.title}</strong><em>{label}</em></div>;
          }) : <div className="home-schedule-empty"><span>아직 예정된 일정이 없어요</span><small>일정은 일정 탭, 둘이 정한 약속은 약속 탭에서 추가해보세요 ❤️</small></div>}
        </div>
        <button className="home-schedule-add !flex !w-full !items-center !justify-center" type="button" onClick={() => { setError(''); setNotice(''); setScheduleOpen(true); }}><Plus size={14} /> 일정 추가</button>
      </div>
    </section>

    {partnerOpen && <div className="route-modal-backdrop" onMouseDown={() => setPartnerOpen(false)}><section className="route-modal partner-profile-modal" onMouseDown={(e) => e.stopPropagation()}>
      <button className="route-modal-close" type="button" onClick={() => setPartnerOpen(false)} aria-label="닫기"><X size={19} /></button>
      <span className="partner-profile-avatar">{avatar(partner, '상')}</span>
      <h2>{partnerRealName}</h2>
      <p className="partner-status">{(partner as UserProfile & { statusMessage?: string } | null)?.statusMessage || '함께하는 하루를 기록하고 있어요 ❤️'}</p>
      <div className="partner-profile-info"><span><small>생일</small><b>{partner?.birthDate ? partner.birthDate.replaceAll('-', '.') : '등록되지 않음'}</b></span><span><small>우리의 시작</small><b>{relationshipStartDate?.replaceAll('-', '.') || '등록되지 않음'}</b></span></div>
    </section></div>}

    {scheduleOpen && <div className="route-modal-backdrop" onMouseDown={() => setScheduleOpen(false)}><section className="route-modal schedule-form-modal" onMouseDown={(e) => e.stopPropagation()}>
      <div className="route-modal-title"><div><small>NEW SCHEDULE</small><h2>일정 추가</h2></div><button type="button" onClick={() => setScheduleOpen(false)}><X size={19} /></button></div>
      <label>일정 제목<input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="예: 병원, 회의, 운동" autoFocus /></label>
      <div className="schedule-form-grid"><label>날짜<input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></label><label>시작 시간<input type="time" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} /></label></div>
      <label>종료 시간 <small>(선택)</small><input type="time" value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })} /></label>
      <label>장소 <small>(선택)</small><div className="schedule-input-icon"><MapPin size={15} /><input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="장소를 입력해 주세요" /></div></label>
      <label>메모 <small>(선택)</small><textarea value={form.memo} onChange={(e) => setForm({ ...form, memo: e.target.value })} placeholder="메모를 남겨보세요" /></label>
      {error && <p className="schedule-error">{error}</p>}
      <p className="schedule-help">둘이 함께 정한 약속은 추억 &gt; 약속에서 따로 추가할 수 있어요.</p>
      <button className="primary schedule-save" type="button" disabled={saving} onClick={() => void submit()}>{saving ? '저장 중...' : '저장'}</button>
    </section></div>}

    {allOpen && <div className="route-modal-backdrop" onMouseDown={() => setAllOpen(false)}><section className="route-modal all-schedules-modal" onMouseDown={(e) => e.stopPropagation()}>
      <div className="route-modal-title"><div><small>OUR CALENDAR</small><h2>일정</h2></div><button type="button" onClick={() => setAllOpen(false)}><X size={19} /></button></div>
      <div className="schedule-filters"><button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>전체</button><button className={filter === 'couple' ? 'active' : ''} onClick={() => setFilter('couple')}>약속</button><button className={filter === 'mine' ? 'active' : ''} onClick={() => setFilter('mine')}>내 일정</button><button className={filter === 'partner' ? 'active' : ''} onClick={() => setFilter('partner')} disabled={!connection}>상대 일정</button></div>
      <div className="all-schedule-list">{filtered.length ? filtered.map((item) => <article key={item.id} className="all-schedule-item"><span className={`schedule-dot ${item.type === 'couple' ? 'couple' : item.ownerId === uid ? 'mine' : 'partner'}`} /><div><small>{prettyDate(item.date)} · {item.startTime}{item.endTime ? `–${item.endTime}` : ''}</small><b>{item.title}</b>{item.location && <em><MapPin size={13} />{item.location}</em>}</div><span className="schedule-owner">{item.type === 'couple' ? '약속' : item.ownerId === uid ? '나' : partnerName}</span></article>) : <div className="all-schedule-empty"><Clock3 size={24} /><b>표시할 일정이 없어요</b><span>새로운 일정을 추가해보세요.</span></div>}</div>
      <button className="primary schedule-save" type="button" onClick={() => { setAllOpen(false); setScheduleOpen(true); }}><Plus size={16} /> 일정 추가</button>
    </section></div>}
  </>;
}
