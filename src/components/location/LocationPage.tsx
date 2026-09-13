import { CalendarDays, Clock3, ImagePlus, LocateFixed, MapPin, Navigation, PauseCircle, RefreshCw, ShieldCheck, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';
import type { MemoryDraft } from '../../types';
import { auth } from '../../lib/firebase';
import type { RealCoupleConnection } from '../../lib/coupleConnection';
import { saveCoupleLocationVisit, subscribePartnerLocationVisits } from '../../lib/locationRealtime';
import { startRouteLocationWatch, type RouteLocationError, type RouteLocationPosition, type RouteLocationWatch } from '../../lib/native';
import {
  distanceMeters,
  loadLocationSharing,
  loadLocationVisits,
  reverseGeocode,
  saveLocationSharing,
  saveLocationVisits,
  searchLocation,
  type LocationVisit,
} from '../../utils/location';

const MIN_MOVE_METERS = 120;
const ROUTE_MAP_ORIGIN = 'https://meluni-f4e00.web.app';
const ROUTE_MAP_HOST = `${ROUTE_MAP_ORIGIN}/naver-map-host.html`;
const LOCATION_FOCUS_KEY = 'route-pending-location-focus';
const MAP_READY_TIMEOUT_MS = 12_000;

export type LocationTabId = 'map' | 'footprints';
type MapHostMessage = { source?: string; type?: string; origin?: string; code?: string };
type FocusState = 'idle' | 'searching' | 'found' | 'failed';

function todayKey() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function dateKey(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return todayKey();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function normalizePlace(value: string) {
  return value.trim().toLocaleLowerCase('ko-KR').replace(/\s+/g, '');
}

function safeDate(value?: string) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function timeText(value?: string) {
  if (!value) return '현재';
  const date = safeDate(value);
  if (!date) return '시간 미상';
  try {
    return new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit' }).format(date);
  } catch {
    return '시간 미상';
  }
}

function dayText(value: string) {
  const date = safeDate(value);
  if (!date) return '날짜 미상';
  try {
    return new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' }).format(date);
  } catch {
    return '날짜 미상';
  }
}

function locationErrorMessage(error: RouteLocationError) {
  const code = String(error.code ?? '');
  if (code === '1' || code === 'OS-PLUG-GLOC-0003' || code.includes('PERMISSION')) {
    return { permissionDenied: true, message: '위치 권한이 거부됐어요. 휴대폰의 단둘이 앱 권한에서 위치를 허용해 주세요.' };
  }
  if (code === 'OS-PLUG-GLOC-0007' || code === 'OS-PLUG-GLOC-0017') {
    return { permissionDenied: false, message: '휴대폰의 위치 서비스가 꺼져 있어요. GPS/위치를 켠 뒤 다시 추적해 주세요.' };
  }
  if (code === '3' || code === 'OS-PLUG-GLOC-0010') {
    return { permissionDenied: false, message: '현재 위치 확인 시간이 초과됐어요. 실외나 창가에서 다시 시도해 주세요.' };
  }
  return { permissionDenied: false, message: '현재 위치를 가져오지 못했어요. 네트워크와 위치 서비스를 확인한 뒤 다시 시도해 주세요.' };
}

export function LocationPage({ requestedTab, Header, connection, focusPlace, onClearFocus, onCreateMemory, onActivity }: {
  requestedTab?: LocationTabId;
  Header: ({ title }: { title?: string }) => React.ReactNode;
  connection: RealCoupleConnection | null;
  focusPlace?: string;
  onClearFocus?: () => void;
  onCreateMemory?: (draft: MemoryDraft) => void;
  onActivity?: (title: string, detail?: string) => void;
}) {
  const uid = auth.currentUser?.uid ?? '';
  const [activeTab, setActiveTab] = useState<LocationTabId>(requestedTab ?? 'map');
  const [sharing, setSharing] = useState(() => uid ? loadLocationSharing(uid).enabled : false);
  const [visits, setVisits] = useState<LocationVisit[]>(() => uid ? loadLocationVisits(uid) : []);
  const [partnerVisits, setPartnerVisits] = useState<LocationVisit[]>([]);
  const [selectedDay, setSelectedDay] = useState(todayKey());
  const [status, setStatus] = useState('위치 공유를 켜면 이동 기록을 만들어요.');
  const [partnerStatus, setPartnerStatus] = useState('상대방의 오늘 발자취를 불러오는 중이에요.');
  const [tracking, setTracking] = useState(false);
  const [mapStatus, setMapStatus] = useState('네이버 지도를 불러오는 중이에요…');
  const [mapFailed, setMapFailed] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [mapAttempt, setMapAttempt] = useState(0);
  const [focusState, setFocusState] = useState<FocusState>('idle');
  const [focusStatus, setFocusStatus] = useState('');
  const [focusedVisit, setFocusedVisit] = useState<LocationVisit>();
  const [queuedFocus] = useState(() => { try { return sessionStorage.getItem(LOCATION_FOCUS_KEY)?.trim() || ''; } catch { return ''; } });

  const watchRef = useRef<RouteLocationWatch | null>(null);
  const watchStartingRef = useRef(false);
  const recordingRef = useRef(false);
  const visitsRef = useRef<LocationVisit[]>(visits);
  const loadedVisitsUidRef = useRef(uid);
  const mapFrame = useRef<HTMLIFrameElement>(null);
  const mapTimeoutRef = useRef<number | undefined>(undefined);
  const handledFocus = useRef('');
  const partnerName = connection?.partnerProfile?.name?.trim() || connection?.partnerProfile?.nickname?.trim() || '상대방';
  const mapVisits = useMemo(() => activeTab === 'footprints' ? partnerVisits : [...visits].reverse(), [activeTab, partnerVisits, visits]);

  const postMapMessage = (payload: Record<string, unknown>) => {
    mapFrame.current?.contentWindow?.postMessage({ source: 'route-map-parent', ...payload }, ROUTE_MAP_ORIGIN);
  };

  const clearMapTimeout = () => {
    if (mapTimeoutRef.current) window.clearTimeout(mapTimeoutRef.current);
    mapTimeoutRef.current = undefined;
  };

  const armMapTimeout = () => {
    clearMapTimeout();
    mapTimeoutRef.current = window.setTimeout(() => {
      setMapReady(false);
      setMapFailed(true);
      setMapStatus('네이버 지도 응답이 늦어지고 있어요. 네트워크를 확인한 뒤 다시 불러와 주세요.');
    }, MAP_READY_TIMEOUT_MS);
  };

  const stopWatching = async (announce = true) => {
    const current = watchRef.current;
    watchRef.current = null;
    if (current) await current.stop();
    setTracking(false);
    if (announce) setStatus('위치 공유가 일시 정지됐어요.');
  };

  useEffect(() => () => {
    clearMapTimeout();
    void stopWatching(false);
  }, []);

  useEffect(() => {
    if (!uid || loadedVisitsUidRef.current === uid) return;
    loadedVisitsUidRef.current = uid;
    const savedVisits = loadLocationVisits(uid);
    visitsRef.current = savedVisits;
    setVisits(savedVisits);
    setSharing(loadLocationSharing(uid).enabled);
  }, [uid]);

  useEffect(() => {
    if (activeTab !== 'footprints') {
      setPartnerVisits([]);
      return;
    }
    if (!connection?.coupleId || !connection.partnerUid) {
      setPartnerVisits([]);
      setPartnerStatus('상대방을 연결하면 발자취를 볼 수 있어요.');
      return;
    }
    setPartnerStatus(`${partnerName}의 발자취를 불러오는 중이에요.`);
    return subscribePartnerLocationVisits(connection.coupleId, connection.partnerUid, selectedDay, (items) => {
      setPartnerVisits(items);
      setPartnerStatus(items.length ? '' : selectedDay === todayKey() ? '아직 오늘 공유된 발자취가 없어요.' : '이 날짜에는 공유된 발자취가 없어요.');
    }, () => setPartnerStatus('발자취를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.'));
  }, [activeTab, connection?.coupleId, connection?.partnerUid, partnerName, selectedDay]);

  useEffect(() => {
    const requestedFocus = focusPlace?.trim() || queuedFocus;
    if (!requestedFocus || handledFocus.current === requestedFocus) return;
    handledFocus.current = requestedFocus;
    let cancelled = false;
    const query = requestedFocus;
    const normalized = normalizePlace(query);
    setActiveTab('map');
    setFocusState('searching');
    setFocusStatus(`‘${query}’ 위치를 찾는 중이에요…`);

    const clearRequest = () => {
      try { sessionStorage.removeItem(LOCATION_FOCUS_KEY); } catch {}
      onClearFocus?.();
    };

    const resolvePlace = async () => {
      const localMatch = visitsRef.current.find((visit) => {
        const place = normalizePlace(visit.placeName ?? '');
        return place && (place.includes(normalized) || normalized.includes(place));
      });
      if (localMatch) {
        if (cancelled) return;
        setFocusedVisit(localMatch);
        setFocusState('found');
        setFocusStatus(`‘${query}’를 최근 방문 기록에서 찾았어요.`);
        clearRequest();
        return;
      }

      const result = await searchLocation(query);
      if (cancelled) return;
      if (!result) {
        setFocusedVisit(undefined);
        setFocusState('failed');
        setFocusStatus(`‘${query}’ 위치를 찾지 못했어요. 장소명이나 주소를 조금 더 자세히 입력해 주세요.`);
        clearRequest();
        return;
      }

      setFocusedVisit({
        id: `linked-place-${Date.now()}`,
        latitude: result.latitude,
        longitude: result.longitude,
        accuracy: 0,
        placeName: result.placeName || query,
        arrivedAt: new Date().toISOString(),
      });
      setFocusState('found');
      setFocusStatus(`‘${query}’를 지도에서 열었어요.`);
      clearRequest();
    };

    void resolvePlace();
    return () => { cancelled = true; };
  }, [focusPlace, queuedFocus]);

  useEffect(() => {
    const receiveMapMessage = (event: MessageEvent<MapHostMessage>) => {
      if (event.origin !== ROUTE_MAP_ORIGIN) return;
      if (event.source !== mapFrame.current?.contentWindow) return;
      if (event.data?.source !== 'route-map-host') return;

      if (event.data.type === 'host-ready' || event.data.type === 'sdk-loading') {
        setMapFailed(false);
        setMapStatus('네이버 지도 인증을 확인하는 중이에요…');
        return;
      }

      if (event.data.type === 'ready') {
        clearMapTimeout();
        setMapReady(true);
        setMapFailed(false);
        setMapStatus('');
        return;
      }

      clearMapTimeout();
      if (event.data.type === 'auth-error') {
        setMapReady(false);
        setMapFailed(true);
        setMapStatus('네이버 지도 인증이 거부됐어요. NAVER Cloud Maps에서 Dynamic Map과 웹 서비스 URL meluni-f4e00.web.app 등록을 확인해 주세요.');
        return;
      }

      if (event.data.type === 'script-error') {
        setMapReady(false);
        setMapFailed(true);
        setMapStatus('네이버 지도 SDK에 연결하지 못했어요. 네트워크를 확인한 뒤 다시 불러와 주세요.');
        return;
      }

      if (event.data.type === 'init-error') {
        setMapReady(false);
        setMapFailed(true);
        setMapStatus('네이버 지도 초기화에 실패했어요. 다시 불러오기를 눌러 주세요.');
      }
    };

    window.addEventListener('message', receiveMapMessage);
    return () => window.removeEventListener('message', receiveMapMessage);
  }, [activeTab, mapVisits]);

  useEffect(() => {
    if (!mapReady) return;
    postMapMessage({ type: 'render', visits: mapVisits, mode: activeTab });
  }, [activeTab, mapReady, mapVisits]);

  useEffect(() => {
    if (!mapReady || !focusedVisit) return;
    const timer = window.setTimeout(() => postMapMessage({ type: 'focus', visit: focusedVisit, showPopup: true }), 80);
    return () => window.clearTimeout(timer);
  }, [focusedVisit, mapReady]);

  useEffect(() => {
    const resize = () => mapReady && postMapMessage({ type: 'resize' });
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [mapReady]);

  const retryMap = () => {
    clearMapTimeout();
    setMapFailed(false);
    setMapReady(false);
    setMapStatus('네이버 지도를 다시 불러오는 중이에요…');
    setMapAttempt((value) => value + 1);
  };

  const persistVisits = (next: LocationVisit[]) => {
    visitsRef.current = next;
    setVisits(next);
    if (uid) saveLocationVisits(uid, next);
  };

  const syncVisit = (visit: LocationVisit) => {
    if (!connection?.coupleId || !uid) return;
    void saveCoupleLocationVisit(connection.coupleId, uid, visit).catch(() => setStatus('기기에는 저장됐지만 상대방과 위치 기록을 동기화하지 못했어요.'));
  };

  const recordPosition = async (position: RouteLocationPosition) => {
    if (recordingRef.current) return;
    recordingRef.current = true;
    try {
      const point = { latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy: position.coords.accuracy };
      if (!Number.isFinite(point.latitude) || !Number.isFinite(point.longitude)) return;
      const now = new Date().toISOString();
      const currentVisits = visitsRef.current;
      const current = currentVisits[0];

      if (current && !current.leftAt && distanceMeters(current, point) < MIN_MOVE_METERS) {
        setStatus(`현재 위치 확인됨 · 오차 약 ${Math.round(position.coords.accuracy)}m`);
        return;
      }

      const placeName = await reverseGeocode(point.latitude, point.longitude);
      const closed = current && !current.leftAt ? { ...current, leftAt: now } : current;
      const rest = current ? currentVisits.slice(1) : currentVisits;
      const nextVisit: LocationVisit = { id: `${Date.now()}`, ...point, placeName, arrivedAt: now };
      const next = [nextVisit, ...(closed ? [closed] : []), ...rest].slice(0, 300);
      persistVisits(next);
      if (closed) syncVisit(closed);
      syncVisit(nextVisit);
      setStatus(placeName ? `${placeName}에서 위치가 확인됐어요.` : '새 위치가 기록됐어요.');
      onActivity?.('새 위치가 기록됐어요', placeName || `${point.latitude.toFixed(5)}, ${point.longitude.toFixed(5)}`);
    } finally {
      recordingRef.current = false;
    }
  };

  const handleLocationError = (error: RouteLocationError) => {
    const detail = locationErrorMessage(error);
    void stopWatching(false);
    if (detail.permissionDenied && uid) {
      saveLocationSharing(uid, false);
      setSharing(false);
    }
    setStatus(detail.message);
  };

  const startWatching = async () => {
    if (!uid || watchStartingRef.current) return;
    watchStartingRef.current = true;
    setStatus('위치 권한과 GPS 상태를 확인하고 있어요…');
    try {
      await stopWatching(false);
      const watch = await startRouteLocationWatch(
        (position) => { setTracking(true); void recordPosition(position); },
        handleLocationError,
      );
      watchRef.current = watch;
      const nextSharing = saveLocationSharing(uid, true);
      setSharing(nextSharing.enabled);
      setTracking(true);
      setStatus('위치 공유가 시작됐어요. 단둘이를 사용하는 동안 이동 변화를 확인해요.');
      onActivity?.('위치 공유를 시작했어요');
    } catch (cause) {
      const code = cause instanceof Error ? cause.message : '';
      const permissionDenied = code === 'route-location-permission-denied';
      saveLocationSharing(uid, false);
      setSharing(false);
      setTracking(false);
      setStatus(permissionDenied
        ? '위치 권한이 허용되지 않았어요. 휴대폰의 단둘이 앱 권한에서 위치를 허용해 주세요.'
        : '위치 추적을 시작하지 못했어요. 위치 서비스가 켜져 있는지 확인해 주세요.');
    } finally {
      watchStartingRef.current = false;
    }
  };

  const disableSharing = () => {
    if (!uid) return;
    void stopWatching(false);
    saveLocationSharing(uid, false);
    setSharing(false);
    setStatus('위치 공유를 껐어요. 기존 이동 기록은 남아 있어요.');
    onActivity?.('위치 공유를 중지했어요');
  };

  const focusVisit = (visit: LocationVisit) => {
    if (!mapReady) return;
    postMapMessage({ type: 'focus', visit, showPopup: true });
  };

  const clearFocusedPlace = () => {
    setFocusState('idle');
    setFocusStatus('');
    setFocusedVisit(undefined);
    if (mapReady) postMapMessage({ type: 'clear-focus' });
  };

  useEffect(() => {
    if (!requestedTab) return;
    if (requestedTab === 'footprints') clearFocusedPlace();
    setActiveTab(requestedTab);
  }, [requestedTab]);

  const createMemoryFromVisit = (visit: LocationVisit) => {
    if (!onCreateMemory) return;
    const place = visit.placeName?.trim() || '다녀온 곳';
    onCreateMemory({
      title: `${place}에서의 추억`,
      date: dateKey(visit.arrivedAt),
      description: `${dayText(visit.arrivedAt)} ${timeText(visit.arrivedAt)}에 다녀온 곳이에요. 사진이나 영상을 더해 이 순간을 남겨보세요.`,
      location: visit.placeName?.trim() || undefined,
      tags: ['위치', '방문'],
    });
  };

  const moveDay = (amount: number) => {
    const date = new Date(`${selectedDay}T12:00:00`);
    date.setDate(date.getDate() + amount);
    const next = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    if (next <= todayKey()) setSelectedDay(next);
  };

  return <div className="page location-page">
    <Header title="지도" />
    <div className="location-tabs" role="tablist" aria-label="지도 보기 방식">
      <button type="button" role="tab" aria-selected={activeTab === 'map'} className={activeTab === 'map' ? 'active' : ''} onClick={() => setActiveTab('map')}>지도</button>
      <button type="button" role="tab" aria-selected={activeTab === 'footprints'} className={activeTab === 'footprints' ? 'active' : ''} onClick={() => { clearFocusedPlace(); setActiveTab('footprints'); }}>발자취</button>
    </div>

    <div className="location-workspace">
    {activeTab === 'footprints' && <div className="footprint-daybar"><button type="button" onClick={() => moveDay(-1)}>‹</button><label><CalendarDays size={14} /><input type="date" value={selectedDay} max={todayKey()} onChange={(event) => setSelectedDay(event.target.value)} /></label><button type="button" disabled={selectedDay >= todayKey()} onClick={() => moveDay(1)}>›</button></div>}

    <section className="location-map-card" aria-label={activeTab === 'footprints' ? `${partnerName}의 발자취 지도` : '네이버 이동 지도'}>
      <iframe
        key={mapAttempt}
        ref={mapFrame}
        className="location-real-map route-map-frame"
        title="단둘이 네이버 지도"
        src={`${ROUTE_MAP_HOST}?v=5&attempt=${mapAttempt}`}
        onLoad={() => {
          setMapStatus('네이버 지도 인증을 확인하는 중이에요…');
          setMapFailed(false);
          armMapTimeout();
        }}
        onError={() => {
          clearMapTimeout();
          setMapReady(false);
          setMapFailed(true);
          setMapStatus('지도 호스트에 연결하지 못했어요. 네트워크를 확인한 뒤 다시 불러와 주세요.');
        }}
      />
      {mapStatus && <div className={`location-map-status ${mapFailed ? 'failed' : ''}`}><MapPin size={18} /><span>{mapStatus}</span>{mapFailed && <button type="button" onClick={retryMap}><RefreshCw size={14} />다시 불러오기</button>}</div>}
      {focusState !== 'idle' && <div className={`location-focus-banner ${focusState}`}><MapPin size={16} /><span><b>{focusState === 'searching' ? '연결된 장소 찾는 중' : focusState === 'found' ? '연결된 장소' : '장소를 찾지 못했어요'}</b><small>{focusStatus}</small></span><button type="button" aria-label="장소 안내 닫기" onClick={clearFocusedPlace}><X size={14} /></button></div>}
      <div className="location-map-caption"><strong>{activeTab === 'footprints' ? `${partnerName}의 발자취` : '우리의 이동 지도'}</strong><span>{mapVisits.length ? `${mapVisits.length}개의 위치 기록` : '아직 기록 없음'}</span></div>
    </section>

    {activeTab === 'map' ? <>
      <section className={`location-share-card ${sharing ? 'active' : ''}`}>
        <div className="location-share-head"><span><LocateFixed size={21} /></span><div><strong>{sharing ? '내 위치 공유 중' : '내 위치 공유 꺼짐'}</strong><small>{tracking ? status : status}</small></div></div>
        <div className="location-actions">{!sharing ? <button className="primary" type="button" onClick={() => void startWatching()}><Navigation size={16} />위치 공유 시작</button> : <>{!tracking && <button className="primary" type="button" onClick={() => void startWatching()}><LocateFixed size={16} />다시 추적</button>}<button className="location-stop" type="button" onClick={disableSharing}><PauseCircle size={16} />공유 끄기</button></>}</div>
        <p className="location-privacy"><ShieldCheck size={14} /> 단둘이를 사용하는 동안 기록된 방문 위치만 연결된 상대방과 공유돼요.</p>
      </section>
      <section className="location-history">
        <div className="location-section-head"><div><small>TIMELINE</small><h2>최근 다녀온 곳</h2></div><span>{visits.length}곳</span></div>
        {!visits.length ? <div className="location-empty"><MapPin size={24} /><strong>아직 위치 기록이 없어요</strong><p>위치 공유를 시작하고 이동하면 네이버 지도 위에 방문 장소가 자동으로 쌓여요.</p></div> : <div className="location-list">{visits.map((visit, index) => <div className="location-visit-row" key={visit.id}><button type="button" className="location-visit" onClick={() => focusVisit(visit)}><div className="location-rail"><i className={index === 0 && !visit.leftAt ? 'live' : ''} />{index < visits.length - 1 && <span />}</div><div className="location-visit-copy"><small>{dayText(visit.arrivedAt)}</small><strong>{visit.placeName || '위치 기록'}</strong><p><Clock3 size={13} /> {timeText(visit.arrivedAt)} 도착 · {visit.leftAt ? `${timeText(visit.leftAt)} 이동` : '현재 머무는 중'}</p><em>정확도 약 {Math.round(visit.accuracy)}m · 눌러서 지도에서 보기</em></div></button>{onCreateMemory && <button type="button" className="location-memory-button" onClick={() => createMemoryFromVisit(visit)}><ImagePlus size={14} /><span>추억</span></button>}</div>)}</div>}
      </section>
    </> : <section className="location-history footprints-history">
      <div className="location-section-head"><div><small>FOOTPRINTS</small><h2>{selectedDay === todayKey() ? `오늘 ${partnerName}의 발자취` : `${partnerName}의 발자취`}</h2></div><span>{partnerVisits.length}곳</span></div>
      {!connection ? <div className="location-empty"><MapPin size={24} /><strong>상대방 연결이 필요해요</strong><p>커플 연결을 완료하면 서로 위치 공유를 켠 시간의 발자취를 볼 수 있어요.</p></div> : !partnerVisits.length ? <div className="location-empty"><MapPin size={24} /><strong>아직 발자취가 없어요</strong><p>{partnerStatus || '상대방이 위치 공유를 켜고 이동하면 시간순으로 표시돼요.'}</p></div> : <div className="location-list footprint-list">{partnerVisits.map((visit, index) => <button type="button" key={visit.id} className="location-visit" onClick={() => focusVisit(visit)}><div className="location-rail footprint-rail"><i className={!visit.leftAt && index === partnerVisits.length - 1 ? 'live' : ''}>{index + 1}</i>{index < partnerVisits.length - 1 && <span />}</div><div className="location-visit-copy"><small>{timeText(visit.arrivedAt)}{visit.leftAt ? ` ~ ${timeText(visit.leftAt)}` : ' ~ 현재'}</small><strong>{visit.placeName || '위치 기록'}</strong><p><Clock3 size={13} /> {visit.leftAt ? '머문 뒤 다음 장소로 이동' : '현재 머무는 중'}</p><em>눌러서 지도에서 보기</em></div></button>)}</div>}
    </section>}
    </div>
  </div>;
}
