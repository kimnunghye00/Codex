import { useEffect, useMemo, useRef, useState } from 'react';
import { addDoc, collection, onSnapshot, orderBy, query, serverTimestamp } from 'firebase/firestore';
import { CalendarDays, Camera, ChevronRight, Clock3, Heart, ImagePlus, MapPin, Plus, X } from 'lucide-react';
import { db } from '../../lib/firebase';
import { syncUserProfile } from '../../lib/coupleData';
import type { RealCoupleConnection } from '../../lib/coupleConnection';
import { displayName, saveProfile, type UserProfile } from '../../utils/profile';

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
  onProfileChange: (profile: UserProfile) => void;
  connection: RealCoupleConnection | null;
  relationshipStartDate?: string;
  coupleDay: number;
  onOpenConnect: () => void;
  onOpenAnniversary: () => void;
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

async function compressProfileImage(file: File, maxSide: number, quality = 0.84): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('image-only');
  if (file.size > 12 * 1024 * 1024) throw new Error('image-too-large');

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const next = new Image();
      next.onload = () => resolve(next);
      next.onerror = () => reject(new Error('image-load-failed'));
      next.src = objectUrl;
    });

    const ratio = Math.min(1, maxSide / Math.max(image.naturalWidth || 1, image.naturalHeight || 1));
    const width = Math.max(1, Math.round(image.naturalWidth * ratio));
    const height = Math.max(1, Math.round(image.naturalHeight * ratio));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('canvas-unavailable');
    context.drawImage(image, 0, 0, width, height);
    return canvas.toDataURL('image/jpeg', quality);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export function CoupleHomeTools({ uid, profile, onProfileChange, connection, relationshipStartDate, coupleDay, onOpenConnect, onOpenAnniversary }: Props) {
  const [remoteSchedules, setRemoteSchedules] = useState<Schedule[]>([]);
  const [localSchedules, setLocalSchedules] = useState<Schedule[]>(() => loadLocal(uid));
  const [legacyPromises, setLegacyPromises] = useState<Schedule[]>(() => loadLegacyPromises(uid));
  const [myProfileOpen, setMyProfileOpen] = useState(false);
  const [partnerOpen, setPartnerOpen] = useState(false);
  const [profileDraft, setProfileDraft] = useState(() => ({
    photoDataUrl: profile.photoDataUrl ?? '',
    backgroundPhotoDataUrl: profile.backgroundPhotoDataUrl ?? '',
    statusMessage: profile.statusMessage ?? '',
  }));
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileFeedback, setProfileFeedback] = useState('');
  const profilePhotoRef = useRef<HTMLInputElement>(null);
  const profileBackgroundRef = useRef<HTMLInputElement>(null);
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
    if (myProfileOpen) return;
    setProfileDraft({
      photoDataUrl: profile.photoDataUrl ?? '',
      backgroundPhotoDataUrl: profile.backgroundPhotoDataUrl ?? '',
      statusMessage: profile.statusMessage ?? '',
    });
  }, [myProfileOpen, profile.backgroundPhotoDataUrl, profile.photoDataUrl, profile.statusMessage]);

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

  const openMyProfile = () => {
    setProfileDraft({
      photoDataUrl: profile.photoDataUrl ?? '',
      backgroundPhotoDataUrl: profile.backgroundPhotoDataUrl ?? '',
      statusMessage: profile.statusMessage ?? '',
    });
    setProfileFeedback('');
    setMyProfileOpen(true);
  };

  const chooseProfileImage = async (file: File | undefined, kind: 'avatar' | 'background') => {
    if (!file) return;
    setProfileFeedback('');
    try {
      const dataUrl = await compressProfileImage(file, kind === 'avatar' ? 720 : 1600, kind === 'avatar' ? 0.86 : 0.8);
      setProfileDraft((current) => kind === 'avatar'
        ? { ...current, photoDataUrl: dataUrl }
        : { ...current, backgroundPhotoDataUrl: dataUrl });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '';
      setProfileFeedback(message === 'image-too-large'
        ? '사진은 12MB 이하로 선택해 주세요.'
        : '사진을 불러오지 못했어요. 다른 사진으로 다시 시도해 주세요.');
    }
  };

  const saveHomeProfile = async () => {
    if (profileSaving) return;
    setProfileSaving(true);
    setProfileFeedback('');
    const next: UserProfile = {
      ...profile,
      photoDataUrl: profileDraft.photoDataUrl || undefined,
      backgroundPhotoDataUrl: profileDraft.backgroundPhotoDataUrl || undefined,
      statusMessage: profileDraft.statusMessage.trim().slice(0, 60) || undefined,
    };

    saveProfile(uid, next);
    onProfileChange(next);
    try {
      await syncUserProfile(uid, next);
      setProfileFeedback('프로필을 저장했어요.');
      window.setTimeout(() => setMyProfileOpen(false), 280);
    } catch (cause) {
      console.warn('[ROUTE home profile sync]', cause);
      setProfileFeedback('이 기기에는 저장했어요. 연결이 안정되면 다시 동기화해 주세요.');
    } finally {
      setProfileSaving(false);
    }
  };

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
      <section className="home-couple-time-card" aria-label="커플 프로필과 우리의 시간">
        <button type="button" className="home-couple-person home-couple-person-me" onClick={openMyProfile}>
          <span className="home-couple-avatar">{avatar(profile, '나')}</span>
          <b>{myRealName}</b>
          <small>{profile.statusMessage || '늘 고마워'} <span aria-hidden="true">♥</span></small>
        </button>

        <svg className="home-couple-connector" viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden="true">
          <path d="M0 20 C22 20 29 6 50 6 C71 6 78 20 100 20" />
        </svg>
        <span className="home-couple-heart-node" aria-hidden="true"><Heart size={15} fill="currentColor" /></span>

        <button type="button" className="home-couple-person home-couple-person-partner" onClick={() => connection ? setPartnerOpen(true) : onOpenConnect()}>
          <span className="home-couple-avatar partner">{avatar(partner, '상')}</span>
          <b>{partnerRealName}</b>
          <small>{partner?.statusMessage || '항상 곁에 있어줘서'} <span aria-hidden="true">♥</span></small>
        </button>

        <button type="button" className="home-couple-time-center" onClick={onOpenAnniversary}>
          <small>우리의 시간</small>
          <strong>{relationshipStartDate ? `D+${coupleDay}` : '설정하기'}</strong>
          <em>{relationshipStartDate ? relationshipStartDate.replaceAll('-', '.') : '기념일 설정 필요'}</em>
          <span>{relationshipStartDate ? '사귀는 날' : '우리의 시작일'}</span>
        </button>
      </section>

      <section className="home-schedule-card" aria-label="우리 일정">
        <header className="home-schedule-head">
          <span className="home-schedule-title-icon" aria-hidden="true"><CalendarDays size={16} /></span>
          <span className="home-schedule-title-copy">
            <b>우리 일정</b>
            <small>함께 기억할 일정을 한곳에 모아봐요.</small>
          </span>
          <button type="button" onClick={() => setAllOpen(true)}>전체보기 <ChevronRight size={14} /></button>
        </header>

        {notice && <p className="schedule-help route-home-save-notice">{notice}</p>}

        <div className="home-schedule-list">
          {upcoming.length ? upcoming.slice(0, 2).map((item) => {
            const mine = item.ownerId === uid;
            const label = item.type === 'couple' ? '약속' : mine ? '나' : partnerName;
            return <article className="home-schedule-row" key={item.id}>
              <span className={`home-schedule-date-badge ${item.type === 'couple' ? 'couple' : mine ? 'mine' : 'partner'}`}>
                <b>{prettyDate(item.date)}</b>
                <small>{item.startTime}</small>
              </span>
              <span className="home-schedule-row-copy">
                <strong>{item.title}</strong>
                <small>{item.location || (item.type === 'couple' ? '우리의 약속' : '개인 일정')}</small>
              </span>
              <em>{label}</em>
            </article>;
          }) : <div className="home-schedule-empty">
            <span className="home-schedule-empty-icon" aria-hidden="true"><CalendarDays size={18} /></span>
            <span className="home-schedule-empty-copy">
              <b>아직 예정된 일정이 없어요</b>
              <small>둘이 함께할 다음 일정을 만들어보세요.</small>
            </span>
          </div>}
        </div>

      </section>
    </section>

    {myProfileOpen && <div className="route-modal-backdrop" onMouseDown={() => setMyProfileOpen(false)}><section className="route-modal home-profile-modal self-profile-modal" onMouseDown={(e) => e.stopPropagation()}>
      <button className="route-modal-close home-profile-close" type="button" onClick={() => setMyProfileOpen(false)} aria-label="닫기"><X size={19} /></button>
      <div className="home-profile-cover">
        {profileDraft.backgroundPhotoDataUrl ? <img src={profileDraft.backgroundPhotoDataUrl} alt="내 프로필 배경" /> : <span className="home-profile-cover-placeholder" />}
        <button className="home-profile-cover-edit" type="button" onClick={() => profileBackgroundRef.current?.click()}><ImagePlus size={15} />배경사진</button>
      </div>
      <div className="home-profile-body">
        <div className="home-profile-avatar-wrap">
          <span className="home-profile-avatar">{profileDraft.photoDataUrl ? <img src={profileDraft.photoDataUrl} alt="내 프로필" /> : avatar(profile, '나')}</span>
          <button type="button" className="home-profile-avatar-edit" onClick={() => profilePhotoRef.current?.click()} aria-label="프로필 사진 변경"><Camera size={15} /></button>
        </div>
        <h2>{displayName(profile)}</h2>
        <p className="home-profile-status-preview">{profileDraft.statusMessage.trim() || '상태 메시지를 입력해 보세요.'}</p>
        <div className="home-profile-editor">
          <label>상태 메시지<textarea maxLength={60} value={profileDraft.statusMessage} onChange={(event) => setProfileDraft((current) => ({ ...current, statusMessage: event.target.value }))} placeholder="지금 내 마음이나 한마디를 남겨보세요" /></label>
          <div className="home-profile-photo-actions">
            {profileDraft.photoDataUrl && <button type="button" onClick={() => setProfileDraft((current) => ({ ...current, photoDataUrl: '' }))}>프로필 사진 삭제</button>}
            {profileDraft.backgroundPhotoDataUrl && <button type="button" onClick={() => setProfileDraft((current) => ({ ...current, backgroundPhotoDataUrl: '' }))}>배경사진 삭제</button>}
          </div>
          {profileFeedback && <p className="home-profile-feedback">{profileFeedback}</p>}
          <button className="primary home-profile-save" type="button" disabled={profileSaving} onClick={() => void saveHomeProfile()}>{profileSaving ? '저장 중...' : '프로필 저장'}</button>
        </div>
        <input ref={profilePhotoRef} hidden type="file" accept="image/*" onChange={(event) => { void chooseProfileImage(event.target.files?.[0], 'avatar'); event.currentTarget.value = ''; }} />
        <input ref={profileBackgroundRef} hidden type="file" accept="image/*" onChange={(event) => { void chooseProfileImage(event.target.files?.[0], 'background'); event.currentTarget.value = ''; }} />
      </div>
    </section></div>}

    {partnerOpen && <div className="route-modal-backdrop" onMouseDown={() => setPartnerOpen(false)}><section className="route-modal home-profile-modal partner-profile-modal" onMouseDown={(e) => e.stopPropagation()}>
      <button className="route-modal-close home-profile-close" type="button" onClick={() => setPartnerOpen(false)} aria-label="닫기"><X size={19} /></button>
      <div className="home-profile-cover">
        {partner?.backgroundPhotoDataUrl ? <img src={partner.backgroundPhotoDataUrl} alt="상대방 프로필 배경" /> : <span className="home-profile-cover-placeholder partner" />}
      </div>
      <div className="home-profile-body">
        <div className="home-profile-avatar-wrap">
          <span className="home-profile-avatar">{avatar(partner, '상')}</span>
        </div>
        <h2>{partnerRealName}</h2>
        <p className="home-profile-status-preview">{partner?.statusMessage || '함께하는 하루를 기록하고 있어요 ❤️'}</p>
        <div className="partner-profile-info"><span><small>생일</small><b>{partner?.birthDate ? partner.birthDate.replaceAll('-', '.') : '등록되지 않음'}</b></span><span><small>우리의 시작</small><b>{relationshipStartDate?.replaceAll('-', '.') || '등록되지 않음'}</b></span></div>
      </div>
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
