import { useEffect, useMemo, useState } from 'react';
import { addDoc, collection, onSnapshot, orderBy, query, serverTimestamp } from 'firebase/firestore';
import { CalendarDays, ChevronRight, Clock3, Heart, MapPin, Plus, UserRound, X } from 'lucide-react';
import { db } from '../../lib/firebase';
import type { RealCoupleConnection } from '../../lib/coupleConnection';
import { displayName, type UserProfile } from '../../utils/profile';

type ScheduleType = 'personal' | 'couple';
type ScheduleFilter = 'all' | 'couple' | 'mine' | 'partner';

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
const todayKey = () => new Date().toISOString().slice(0, 10);

function loadLocal(uid: string): Schedule[] {
  try {
    return JSON.parse(localStorage.getItem(localKey(uid)) || '[]') as Schedule[];
  } catch {
    return [];
  }
}

function avatar(profile: UserProfile | null, fallback: string) {
  if (profile?.photoDataUrl) return <img src={profile.photoDataUrl} alt="프로필" />;
  return <span>{profile?.name?.trim()?.slice(0, 1) || fallback}</span>;
}

function prettyDate(value: string) {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  const today = todayKey();
  if (value === today) return '오늘';
  return `${date.getMonth() + 1}월 ${date.getDate()}일`;
}

export function CoupleHomeTools({ uid, profile, connection, relationshipStartDate, onOpenMyProfile, onOpenConnect }: Props) {
  const [remoteSchedules, setRemoteSchedules] = useState<Schedule[]>([]);
  const [localSchedules, setLocalSchedules] = useState<Schedule[]>(() => loadLocal(uid));
  const [partnerOpen, setPartnerOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [allOpen, setAllOpen] = useState(false);
  const [filter, setFilter] = useState<ScheduleFilter>('all');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ title: '', date: todayKey(), startTime: '19:00', endTime: '', type: 'couple' as ScheduleType, memo: '', location: '' });

  useEffect(() => {
    setLocalSchedules(loadLocal(uid));
  }, [uid]);

  useEffect(() => {
    if (!connection?.coupleId) {
      setRemoteSchedules([]);
      return;
    }
    const schedulesRef = collection(db, 'couples', connection.coupleId, 'schedules');
    const q = query(schedulesRef, orderBy('date', 'asc'));
    return onSnapshot(q, (snapshot) => {
      setRemoteSchedules(snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as Omit<Schedule, 'id'>) })));
    }, () => setRemoteSchedules([]));
  }, [connection?.coupleId]);

  const schedules = useMemo(() => {
    const source = connection ? remoteSchedules : localSchedules;
    return [...source].sort((a, b) => `${a.date} ${a.startTime}`.localeCompare(`${b.date} ${b.startTime}`));
  }, [connection, localSchedules, remoteSchedules]);

  const upcoming = schedules.filter((item) => item.date >= todayKey()).slice(0, 3);
  const partner = connection?.partnerProfile ?? null;
  const partnerName = partner ? displayName(partner) : '상대방';
  const partnerRealName = partner?.name?.trim() || '상대방';
  const myRealName = profile.name?.trim() || '나';

  const filtered = schedules.filter((item) => {
    if (filter === 'all') return true;
    if (filter === 'couple') return item.type === 'couple';
    if (filter === 'mine') return item.type === 'personal' && item.ownerId === uid;
    return item.type === 'personal' && item.ownerId !== uid;
  });

  const submit = async () => {
    if (!form.title.trim() || !form.date || !form.startTime) {
      setError('제목, 날짜, 시작 시간을 입력해 주세요.');
      return;
    }
    setSaving(true);
    setError('');
    const payload: Omit<Schedule, 'id'> = {
      title: form.title.trim(),
      date: form.date,
      startTime: form.startTime,
      endTime: form.endTime || undefined,
      type: connection ? form.type : 'personal',
      ownerId: uid,
      memo: form.memo.trim() || undefined,
      location: form.location.trim() || undefined,
    };
    try {
      if (connection?.coupleId) {
        await addDoc(collection(db, 'couples', connection.coupleId, 'schedules'), { ...payload, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
      } else {
        const next = [...localSchedules, { ...payload, id: `local-${Date.now()}` }];
        setLocalSchedules(next);
        localStorage.setItem(localKey(uid), JSON.stringify(next));
      }
      setForm({ title: '', date: todayKey(), startTime: '19:00', endTime: '', type: connection ? 'couple' : 'personal', memo: '', location: '' });
      setScheduleOpen(false);
    } catch {
      setError('일정을 저장하지 못했어요. 잠시 후 다시 시도해 주세요.');
    } finally {
      setSaving(false);
    }
  };

  return <>
    <section className="home-couple-tools" aria-label="커플 프로필과 일정">
      <div className="home-couple-profile-card">
        <button type="button" className="home-person home-person-me" onClick={onOpenMyProfile}>
          <span className="home-profile-avatar">{avatar(profile, '나')}</span>
          <span className="home-profile-copy"><b>{myRealName}</b><small>내 프로필 편집</small></span>
        </button>
        <span className="home-profile-heart" aria-hidden="true"><Heart size={18} fill="currentColor" /></span>
        <button type="button" className="home-person" onClick={() => connection ? setPartnerOpen(true) : onOpenConnect()}>
          <span className="home-profile-avatar partner">{avatar(partner, '상')}</span>
          <span className="home-profile-copy"><b>{partnerRealName}</b><small>{connection ? '프로필 보기' : '상대 연결하기'}</small></span>
        </button>
      </div>

      <div className="home-schedule-card">
        <div className="home-schedule-head"><span><CalendarDays size={16} /><b>우리 일정</b></span><button type="button" onClick={() => setAllOpen(true)}>전체보기 <ChevronRight size={14} /></button></div>
        <div className="home-schedule-list">
          {upcoming.length ? upcoming.map((item) => {
            const mine = item.ownerId === uid;
            const label = item.type === 'couple' ? '우리' : mine ? '나' : partnerName;
            return <div className="home-schedule-row" key={item.id}><span className={`schedule-dot ${item.type === 'couple' ? 'couple' : mine ? 'mine' : 'partner'}`} /><span className="schedule-when"><b>{prettyDate(item.date)}</b><small>{item.startTime}</small></span><strong>{item.title}</strong><em>{label}</em></div>;
          }) : <div className="home-schedule-empty"><span>아직 예정된 일정이 없어요</span><small>둘만의 새로운 일정을 만들어보세요 ❤️</small></div>}
        </div>
        <button className="home-schedule-add" type="button" onClick={() => setScheduleOpen(true)}><Plus size={14} /> 일정 추가</button>
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
      <label>일정 제목<input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="예: 저녁 데이트" autoFocus /></label>
      <div className="schedule-form-grid"><label>날짜<input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></label><label>시작 시간<input type="time" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} /></label></div>
      <label>종료 시간 <small>(선택)</small><input type="time" value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })} /></label>
      <div className="schedule-type-picker"><button type="button" className={form.type === 'personal' ? 'active' : ''} onClick={() => setForm({ ...form, type: 'personal' })}><UserRound size={16} />내 일정</button><button type="button" disabled={!connection} className={form.type === 'couple' ? 'active' : ''} onClick={() => setForm({ ...form, type: 'couple' })}><Heart size={16} />우리 일정</button></div>
      <label>장소 <small>(선택)</small><div className="schedule-input-icon"><MapPin size={15} /><input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="장소를 입력해 주세요" /></div></label>
      <label>메모 <small>(선택)</small><textarea value={form.memo} onChange={(e) => setForm({ ...form, memo: e.target.value })} placeholder="메모를 남겨보세요" /></label>
      {error && <p className="schedule-error">{error}</p>}
      {!connection && <p className="schedule-help">상대방을 연결하기 전에는 내 일정으로 저장돼요.</p>}
      <button className="primary schedule-save" type="button" disabled={saving} onClick={() => void submit()}>{saving ? '저장 중...' : '일정 저장'}</button>
    </section></div>}

    {allOpen && <div className="route-modal-backdrop" onMouseDown={() => setAllOpen(false)}><section className="route-modal all-schedules-modal" onMouseDown={(e) => e.stopPropagation()}>
      <div className="route-modal-title"><div><small>OUR CALENDAR</small><h2>일정</h2></div><button type="button" onClick={() => setAllOpen(false)}><X size={19} /></button></div>
      <div className="schedule-filters"><button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>전체</button><button className={filter === 'couple' ? 'active' : ''} onClick={() => setFilter('couple')}>우리</button><button className={filter === 'mine' ? 'active' : ''} onClick={() => setFilter('mine')}>내 일정</button><button className={filter === 'partner' ? 'active' : ''} onClick={() => setFilter('partner')} disabled={!connection}>상대 일정</button></div>
      <div className="all-schedule-list">{filtered.length ? filtered.map((item) => <article key={item.id} className="all-schedule-item"><span className={`schedule-dot ${item.type === 'couple' ? 'couple' : item.ownerId === uid ? 'mine' : 'partner'}`} /><div><small>{prettyDate(item.date)} · {item.startTime}{item.endTime ? `–${item.endTime}` : ''}</small><b>{item.title}</b>{item.location && <em><MapPin size={13} />{item.location}</em>}</div><span className="schedule-owner">{item.type === 'couple' ? '우리' : item.ownerId === uid ? '나' : partnerName}</span></article>) : <div className="all-schedule-empty"><Clock3 size={24} /><b>표시할 일정이 없어요</b><span>새로운 일정을 추가해보세요.</span></div>}</div>
      <button className="primary schedule-save" type="button" onClick={() => { setAllOpen(false); setScheduleOpen(true); }}><Plus size={16} /> 일정 추가</button>
    </section></div>}
  </>;
}
