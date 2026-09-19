import { useEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';
import { CalendarDays, ChevronDown, ChevronUp, Heart, MapPin, MessageCircle, Plus, Search, Trash2, X } from 'lucide-react';
import { auth } from '../../lib/firebase';
import type { RealCoupleConnection } from '../../lib/coupleConnection';
import { searchLocation, type LocationSearchResult } from '../../utils/location';
import {
  addDatePlace, addPlaceOpinion, deleteDateCourse, deleteDatePlace, deletePlaceOpinion,
  saveDateCourse, setPlaceLike, subscribeDateCourses, subscribeDatePlaces,
  subscribePlaceLikes, subscribePlaceOpinions, updateDatePlace,
  type DateCourse, type DatePlace, type PlaceOpinion,
} from '../../lib/dateMap';
import './DateMapPage.css';

type Category = DatePlace['category'];
const CATEGORIES: Category[] = ['맛집', '카페', '놀거리', '여행', '기타'];
const MAP_ORIGIN = 'https://meluni-f4e00.web.app';
const MAP_HOST = `${MAP_ORIGIN}/naver-map-host.html?v=7`;
const ALL = '전체';
function dateToday() {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const part = (type: string) => parts.find((item) => item.type === type)?.value || '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function errorText(error: unknown) {
  const code = String((error as { code?: string })?.code ?? '');
  if (code.includes('permission-denied')) return '두 사람의 연결 상태 또는 장소 접근 권한을 확인해 주세요.';
  return '작업을 완료하지 못했어요. 네트워크를 확인하고 다시 시도해 주세요.';
}

function kmApprox(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const lat = (a.latitude - b.latitude) * 111.2;
  const lon = (a.longitude - b.longitude) * 111.2 * Math.cos(a.latitude * Math.PI / 180);
  return Math.hypot(lat, lon);
}

export function DateMapPage({ Header, connection, focusPlace, onClearFocus }: {
  Header: ({ title }: { title?: string }) => React.ReactNode;
  connection: RealCoupleConnection | null;
  focusPlace?: string;
  onClearFocus: () => void;
}) {
  const uid = auth.currentUser?.uid ?? '';
  const coupleId = connection?.coupleId ?? '';
  const [places, setPlaces] = useState<DatePlace[]>([]);
  const [courses, setCourses] = useState<DateCourse[]>([]);
  const [tab, setTab] = useState<'places' | 'courses'>('places');
  const [category, setCategory] = useState<string>(ALL);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [candidate, setCandidate] = useState<LocationSearchResult | null>(null);
  const [candidateCategory, setCandidateCategory] = useState<Category>('기타');
  const [candidateMemo, setCandidateMemo] = useState('');
  const [selectedId, setSelectedId] = useState<string>('');
  const [likes, setLikes] = useState<string[]>([]);
  const [opinions, setOpinions] = useState<PlaceOpinion[]>([]);
  const [opinion, setOpinion] = useState('');
  const [editMemo, setEditMemo] = useState('');
  const [editCategory, setEditCategory] = useState<Category>('기타');
  const [courseId, setCourseId] = useState('');
  const [courseTitle, setCourseTitle] = useState('');
  const [courseDate, setCourseDate] = useState(dateToday);
  const [coursePlaceIds, setCoursePlaceIds] = useState<string[]>([]);
  const [choiceId, setChoiceId] = useState('');
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);
  const selected = places.find((item) => item.id === selectedId);
  const course = courses.find((item) => item.id === courseId);
  const visible = useMemo(() => places.filter((item) => category === ALL || item.category === category), [places, category]);

  useEffect(() => {
    setPlaces([]); setCourses([]); setSelectedId(''); setCourseId(''); setLikes([]); setOpinions([]);
    if (!coupleId) return;
    const stopPlaces = subscribeDatePlaces(coupleId, setPlaces, (error) => setMessage(errorText(error)));
    const stopCourses = subscribeDateCourses(coupleId, setCourses, (error) => setMessage(errorText(error)));
    return () => { stopPlaces(); stopCourses(); };
  }, [coupleId]);

  useEffect(() => {
    setLikes([]); setOpinions([]); setOpinion('');
    if (!coupleId || !selectedId) return;
    const stopLikes = subscribePlaceLikes(coupleId, selectedId, setLikes, (error) => setMessage(errorText(error)));
    const stopOpinions = subscribePlaceOpinions(coupleId, selectedId, setOpinions, (error) => setMessage(errorText(error)));
    return () => { stopLikes(); stopOpinions(); };
  }, [coupleId, selectedId]);

  useEffect(() => {
    setEditMemo(selected?.memo ?? '');
    setEditCategory(selected?.category ?? '기타');
  }, [selected?.id, selected?.memo, selected?.category]);

  useEffect(() => {
    if (!course) return;
    setCourseTitle(course.title); setCourseDate(course.date); setCoursePlaceIds(course.placeIds);
  }, [course?.id, course?.updatedAt]);

  const search = async (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) { setMessage('검색할 장소나 주소를 입력해 주세요.'); return; }
    setSearching(true); setCandidate(null); setMessage('');
    try {
      const found = await searchLocation(trimmed);
      if (!found) { setCandidate(null); setMessage('장소를 찾지 못했어요. 주소나 지역명을 더 자세히 입력해 주세요.'); return; }
      setCandidate(found);
    } catch (error) {
      setMessage(errorText(error));
    } finally { setSearching(false); }
  };

  useEffect(() => {
    if (!focusPlace) return;
    setQuery(focusPlace);
    void search(focusPlace).finally(onClearFocus);
  // One-shot external navigation, not on each render.
  }, [focusPlace]);

  const mapVisits = useMemo(() => [
    ...visible.map((item) => ({
      id: item.id, latitude: item.latitude, longitude: item.longitude, placeName: item.name,
      arrivedAt: '2026-01-01T00:00:00.000Z', leftAt: '2026-01-01T00:00:00.000Z',
    })),
    ...(candidate ? [{ id: 'search-preview', latitude: candidate.latitude, longitude: candidate.longitude,
      placeName: candidate.placeName, arrivedAt: '2026-01-01T00:00:00.000Z', leftAt: '2026-01-01T00:00:00.000Z' }] : []),
  ], [visible, candidate]);
  useEffect(() => {
    const timer = window.setTimeout(() => { if (!mapReady) setMapError(true); }, 12000);
    const receive = (event: MessageEvent<{ source?: string; type?: string }>) => {
      if (event.origin !== MAP_ORIGIN || event.source !== frame.current?.contentWindow || event.data?.source !== 'route-map-host') return;
      if (event.data.type === 'ready') { setMapReady(true); setMapError(false); }
      if (['auth-error', 'sdk-error', 'render-error'].includes(event.data.type ?? '')) setMapError(true);
    };
    window.addEventListener('message', receive);
    return () => { window.clearTimeout(timer); window.removeEventListener('message', receive); };
  }, [mapReady]);

  useEffect(() => {
    if (!mapReady) return;
    frame.current?.contentWindow?.postMessage({ source: 'route-map-parent', type: 'render', mode: 'date-plan', visits: mapVisits }, MAP_ORIGIN);
  }, [mapReady, mapVisits]);

  const mapFocus = (place: { latitude: number; longitude: number; placeName: string }) => {
    if (!mapReady) return;
    frame.current?.contentWindow?.postMessage({ source: 'route-map-parent', type: 'focus', showPopup: true,
      visit: { latitude: place.latitude, longitude: place.longitude, placeName: place.placeName } }, MAP_ORIGIN);
  };

  const submit = async (work: () => Promise<unknown>, success: string) => {
    setPending(true); setMessage('');
    try { await work(); setMessage(success); } catch (error) { setMessage(errorText(error)); }
    finally { setPending(false); }
  };

  const appendToCourse = (placeId: string) => {
    setCoursePlaceIds((ids) => ids.includes(placeId) || ids.length >= 20 ? ids : [...ids, placeId]);
  };

  const saveCandidate = async (addToCurrentCourse = false) => {
    if (!candidate || !uid || !coupleId || pending) return;
    if (addToCurrentCourse && coursePlaceIds.length >= 20) {
      setMessage('하나의 코스에는 장소를 최대 20곳까지 추가할 수 있어요.');
      return;
    }
    const duplicate = places.find((item) => item.name.trim().toLowerCase() === candidate.placeName.trim().toLowerCase()
      && kmApprox(item, candidate) < 0.15);
    if (duplicate) {
      if (addToCurrentCourse) {
        if (coursePlaceIds.includes(duplicate.id)) {
          setMessage('이미 이 코스에 포함된 장소예요.');
          return;
        }
        appendToCourse(duplicate.id);
      } else {
        setSelectedId(duplicate.id);
      }
      setCandidate(null);
      setMessage(addToCurrentCourse
        ? '기존에 저장된 장소를 코스에 추가했어요. 마지막에 코스 저장을 눌러 주세요.'
        : '이미 저장된 장소예요. 기존 장소를 선택했어요.');
      return;
    }
    // Save a shared place first, then append its stable ID to this unsaved
    // course draft. Never reset the selected course or erase earlier stops.
    await submit(async () => {
      const id = await addDatePlace(coupleId, uid, {
        name: candidate.placeName.slice(0, 120), address: query.trim().slice(0, 240),
        latitude: candidate.latitude, longitude: candidate.longitude, category: candidateCategory, memo: candidateMemo.trim().slice(0, 1000),
      });
      if (addToCurrentCourse) appendToCourse(id);
      else setSelectedId(id);
      setCandidate(null); setCandidateMemo('');
    }, addToCurrentCourse
      ? '새 장소를 코스에 추가했어요. 마지막에 코스 저장을 눌러 주세요.'
      : '우리의 지도에 장소를 저장했어요.');
  };

  const newCourse = () => {
    setCourseId(''); setCourseTitle(''); setCourseDate(dateToday()); setCoursePlaceIds([]); setChoiceId(''); setTab('courses');
  };
  const chooseCourse = (item: DateCourse) => {
    setCourseId(item.id); setCourseTitle(item.title); setCourseDate(item.date); setCoursePlaceIds([...item.placeIds]); setTab('courses');
  };
  const saveCourse = async () => {
    if (!coupleId || !uid || !courseTitle.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(courseDate)) {
      setMessage('데이트 코스 이름과 날짜를 확인해 주세요.'); return;
    }
    if (!coursePlaceIds.length) { setMessage('데이트 코스에 장소를 하나 이상 추가해 주세요.'); return; }
    await submit(async () => {
      const id = await saveDateCourse(coupleId, uid, { title: courseTitle.trim().slice(0, 100), date: courseDate, placeIds: coursePlaceIds }, courseId || undefined);
      setCourseId(id);
    }, '데이트 코스를 저장했어요. 상대방에게도 표시돼요.');
  };
  const changeOrder = (index: number, offset: number) => setCoursePlaceIds((ids) => {
    const next = [...ids]; const target = index + offset;
    if (target < 0 || target >= next.length) return ids;
    [next[index], next[target]] = [next[target], next[index]];
    return next;
  });

  return <div className="page date-map-page">
    <Header title="지도" />
    <div className="date-map-heading"><div><small>OUR DATE MAP</small><h1>우리의 데이트 지도 ♡</h1><p>가고 싶은 장소를 둘이 저장하고 데이트를 계획해요.</p></div></div>
    <form className="date-map-search" onSubmit={(event) => { event.preventDefault(); void search(query); }}>
      <Search size={19} aria-hidden="true"/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="가게 이름, 주소, 지역 검색" aria-label="데이트 장소 검색"/>
      <button type="submit" disabled={searching}>{searching ? '검색 중…' : '검색'}</button>
    </form>
    {message && <p className="date-map-feedback" role="status">{message}</p>}
    {!connection && <p className="date-map-connect">두 사람이 함께 사용할 장소·코스 저장은 커플 연결 후 이용할 수 있어요. 지도 검색은 먼저 사용해 볼 수 있어요.</p>}
    <div className="date-map-filters">{[ALL,...CATEGORIES].map((item) => <button key={item} type="button" className={category === item ? 'active' : ''} onClick={() => setCategory(item)}>{item}</button>)}</div>
    <div className="date-map-workspace">
      <section className="date-map-map" aria-label="데이트 장소 지도">
        <iframe ref={frame} title="단둘이 데이트 지도" src={MAP_HOST} referrerPolicy="strict-origin-when-cross-origin" onLoad={() => setMapReady(false)} onError={() => setMapError(true)} />
        {!mapReady && <div className="date-map-loading">{mapError ? '지도를 불러오지 못했어요. 네트워크 또는 지도 인증을 확인해 주세요.' : '네이버 지도를 불러오는 중이에요…'}</div>}
        <div className="date-map-caption">📍 저장한 장소 {places.length}곳 · 방문 기록과 분리된 계획 지도</div>
      </section>
      <section className="date-map-panel">
        <div className="date-map-tabs" role="tablist" aria-label="데이트 지도 보기">
          <button type="button" role="tab" aria-selected={tab === 'places'} className={tab === 'places' ? 'active' : ''} onClick={() => setTab('places')}>저장한 장소</button>
          <button type="button" role="tab" aria-selected={tab === 'courses'} className={tab === 'courses' ? 'active' : ''} onClick={() => setTab('courses')}>데이트 코스</button>
        </div>
        {candidate && <article className="date-map-candidate">
            <div className="date-map-panel-header"><strong>검색한 장소</strong><button type="button" aria-label="검색 결과 닫기" onClick={() => setCandidate(null)}><X size={16}/></button></div>
            <b>{candidate.placeName}</b><small>검색어: {query} · 지도 핀 위치가 맞는지 확인한 후 추가해 주세요.</small>
            <div className="date-map-inline"><select aria-label="장소 분류" value={candidateCategory} onChange={(e) => setCandidateCategory(e.target.value as Category)}>{CATEGORIES.map((item) => <option key={item}>{item}</option>)}</select>
            <button type="button" onClick={() => mapFocus(candidate)}>지도에서 보기</button></div>
            <textarea value={candidateMemo} onChange={(e) => setCandidateMemo(e.target.value)} maxLength={1000} placeholder="함께 가고 싶은 이유나 메모 (선택)" />
            <button className="date-map-primary" type="button" disabled={pending || !connection || (tab === 'courses' && coursePlaceIds.length >= 20)} onClick={() => void saveCandidate(tab === 'courses')}><Plus size={15}/> {tab === 'courses' ? '이 코스에 추가' : '우리 장소로 저장'}</button>
          </article>}
        {tab === 'places' && <>
          <div className="date-map-panel-header"><strong>우리가 가고 싶은 곳</strong><span>{visible.length}곳</span></div>
          {!visible.length && <p className="date-map-empty">아직 저장한 장소가 없어요. 검색해서 첫 데이트 장소를 등록해 봐요.</p>}
          {visible.map((item) => <button type="button" className={selectedId === item.id ? 'date-map-place active' : 'date-map-place'} key={item.id} onClick={() => { setSelectedId(item.id); setCandidate(null); mapFocus({ ...item, placeName: item.name }); }}>
            <span className="date-map-pin"><MapPin size={18}/></span><span><b>{item.name}</b><small>{item.category} · {item.address}</small></span><ChevronDown size={15}/>
          </button>)}
          {selected && <article className="date-map-detail">
            <div className="date-map-panel-header"><strong>{selected.name}</strong><button type="button" aria-label="선택 해제" onClick={() => setSelectedId('')}><X size={16}/></button></div>
            <small>{selected.category} · {selected.address}</small>
            <div className="date-map-inline"><button type="button" className={likes.includes(uid) ? 'date-map-like active' : 'date-map-like'} disabled={pending} onClick={() => void submit(() => setPlaceLike(coupleId, selected.id, uid, !likes.includes(uid)), likes.includes(uid) ? '가고 싶어요를 취소했어요.' : '가고 싶어요를 표시했어요.')}><Heart size={15} fill={likes.includes(uid) ? 'currentColor' : 'none'}/> 가고 싶어요 {likes.length}</button>
            <span><MessageCircle size={14}/> 의견 {opinions.length}</span></div>
            <label className="date-map-label">함께 쓰는 장소 메모<textarea value={editMemo} maxLength={1000} onChange={(e) => setEditMemo(e.target.value)}/></label>
            <div className="date-map-inline"><select aria-label="저장된 장소 분류" value={editCategory} onChange={(e) => setEditCategory(e.target.value as Category)}>{CATEGORIES.map((item) => <option key={item}>{item}</option>)}</select>
              <button type="button" disabled={pending} onClick={() => void submit(() => updateDatePlace(coupleId, selected, { memo: editMemo.trim(), category: editCategory }), '장소 메모를 수정했어요.')}>메모 저장</button></div>
            <div className="date-map-opinions">{opinions.map((item) => <div key={item.id}><span>{item.authorUid === uid ? '나' : '상대방'} · {item.text}</span>{item.authorUid === uid && <button type="button" aria-label="내 의견 삭제" onClick={() => void submit(() => deletePlaceOpinion(coupleId, selected.id, item.id), '의견을 삭제했어요.')}><X size={12}/></button>}</div>)}</div>
            <form onSubmit={(e) => { e.preventDefault(); if (!opinion.trim()) return; void submit(async () => { await addPlaceOpinion(coupleId, selected.id, uid, opinion.trim().slice(0, 500)); setOpinion(''); }, '의견을 등록했어요.'); }}>
              <input aria-label="상대방에게 남길 장소 의견" value={opinion} maxLength={500} onChange={(e) => setOpinion(e.target.value)} placeholder="이 장소에 대한 의견 남기기"/><button type="submit" disabled={!opinion.trim() || pending}>등록</button>
            </form>
            <div className="date-map-inline"><button type="button" onClick={() => {
              if (coursePlaceIds.includes(selected.id)) setMessage('이미 이 코스에 포함된 장소예요.');
              else if (coursePlaceIds.length >= 20) setMessage('하나의 코스에는 장소를 최대 20곳까지 추가할 수 있어요.');
              else { appendToCourse(selected.id); setMessage('장소를 추가했어요. 마지막에 코스 저장을 눌러 주세요.'); }
              setTab('courses');
            }}>{courseId || coursePlaceIds.length ? '현재 코스에 추가' : '코스에 넣기'}</button>
              <button type="button" className="date-map-delete" disabled={pending} onClick={() => { if (window.confirm('이 장소를 삭제할까요? 코스에서도 표시되지 않을 수 있어요.')) void submit(async () => { await deleteDatePlace(coupleId, selected.id); setSelectedId(''); }, '장소를 삭제했어요.'); }}><Trash2 size={14}/> 장소 삭제</button></div>
          </article>}
        </>}
        {tab === 'courses' && <>
          <div className="date-map-panel-header"><strong>함께 만드는 코스</strong><button type="button" onClick={newCourse}><Plus size={14}/> 새 코스</button></div>
          {courses.map((item) => <button key={item.id} type="button" className={courseId === item.id ? 'date-map-course-choice active' : 'date-map-course-choice'} onClick={() => chooseCourse(item)}><CalendarDays size={17}/><span><b>{item.title}</b><small>{item.date} · 장소 {item.placeIds.length}곳</small></span></button>)}
          {!courses.length && <p className="date-map-empty">아직 데이트 코스가 없어요. 저장한 장소들을 일정에 맞춰 묶어 보세요.</p>}
          <article className="date-map-detail">
            <strong>{courseId ? '데이트 코스 수정' : '새 데이트 코스'}</strong>
            <label className="date-map-label">코스 이름<input maxLength={100} placeholder="예: 강릉 주말 데이트" value={courseTitle} onChange={(e) => setCourseTitle(e.target.value)}/></label>
            <label className="date-map-label">데이트 날짜<input type="date" value={courseDate} onChange={(e) => setCourseDate(e.target.value)}/></label>
            <div className="date-map-panel-header"><strong>방문 예정 장소</strong><span>{coursePlaceIds.length} / 20곳</span></div>
            <p className="date-map-add-hint">저장된 장소를 선택하거나 화면 상단에서 새 장소를 검색해 ‘이 코스에 추가’를 눌러 주세요. 기존 코스와 날짜는 유지돼요.</p>
            {coursePlaceIds.map((id, index) => { const place = places.find((item) => item.id === id); return <div className="date-map-course-row" key={id}><span>{index + 1}. {place?.name ?? '삭제된 장소'}</span>
              <button type="button" aria-label="위로 이동" disabled={index === 0} onClick={() => changeOrder(index,-1)}><ChevronUp size={16}/></button>
              <button type="button" aria-label="아래로 이동" disabled={index === coursePlaceIds.length - 1} onClick={() => changeOrder(index,1)}><ChevronDown size={16}/></button>
              <button type="button" aria-label="코스에서 제거" onClick={() => setCoursePlaceIds((ids) => ids.filter((placeId) => placeId !== id))}><X size={16}/></button></div>; })}
            <div className="date-map-inline"><select aria-label="코스에 추가할 장소" value={choiceId} onChange={(e) => setChoiceId(e.target.value)}><option value="">장소 선택</option>{places.filter((item) => !coursePlaceIds.includes(item.id)).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
              <button type="button" disabled={!choiceId || coursePlaceIds.length >= 20} onClick={() => {
                if (!choiceId) return;
                appendToCourse(choiceId); setChoiceId('');
                setMessage('장소를 추가했어요. 마지막에 코스 저장을 눌러 주세요.');
              }}><Plus size={14}/> 추가</button></div>
            <button type="button" className="date-map-primary" disabled={pending || !connection} onClick={() => void saveCourse()}>두 사람의 코스로 저장</button>
            {courseId && <button type="button" className="date-map-delete" disabled={pending} onClick={() => { if (window.confirm('이 데이트 코스를 삭제할까요?')) void submit(async () => { await deleteDateCourse(coupleId, courseId); newCourse(); }, '코스를 삭제했어요.'); }}><Trash2 size={14}/> 코스 삭제</button>}
          </article>
        </>}
      </section>
    </div>
    <p className="date-map-disclaimer">이 화면은 앞으로 갈 장소와 코스를 계획하는 공간이에요. 저장한 장소가 방문 완료로 자동 처리되지는 않으며, 기존 GPS 발자취는 홈 또는 앨범에서 확인할 수 있어요.</p>
  </div>;
}
