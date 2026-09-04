import { CalendarDays, Clock3, LocateFixed, MapPin, Navigation, PauseCircle, RefreshCw, ShieldCheck } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';
import { auth } from '../../lib/firebase';
import type { RealCoupleConnection } from '../../lib/coupleConnection';
import { saveCoupleLocationVisit, subscribePartnerLocationVisits } from '../../lib/locationRealtime';
import {
  distanceMeters,
  loadLocationSharing,
  loadLocationVisits,
  reverseGeocode,
  saveLocationSharing,
  saveLocationVisits,
  type LocationVisit,
} from '../../utils/location';
import { loadNaverMaps, naverApi, naverMapDiagnostic, type NaverMap, type NaverOverlay } from '../../utils/naverMaps';

const MIN_MOVE_METERS = 120;

type LocationTab = 'map' | 'footprints';

function todayKey() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function timeText(value?: string) {
  if (!value) return '현재';
  return new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

function dayText(value: string) {
  return new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' }).format(new Date(value));
}

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character] ?? character));
}

function markerHtml(current: boolean, index?: number) {
  const color = current ? '#FF6F61' : '#1F2A44';
  const size = current ? 24 : 20;
  const label = typeof index === 'number' ? `<span style="font-size:9px;color:#fff;font-weight:800">${index + 1}</span>` : '';
  return `<div style="width:${size}px;height:${size}px;border:3px solid #fff;border-radius:50%;background:${color};box-shadow:0 3px 10px #0003;display:grid;place-items:center">${label}</div>`;
}

function mapErrorMessage(error: unknown) {
  const code = error instanceof Error ? error.message : String(error);
  const diagnostic = naverMapDiagnostic();
  if (code === 'NAVER_MAP_AUTH_FAILED') return `네이버 지도 인증이 거부됐어요. NAVER Cloud의 Web 서비스 URL에 ${diagnostic.origin} 을 등록해 주세요.`;
  if (code === 'NAVER_MAP_LOAD_TIMEOUT') return '네이버 지도 서버 응답이 늦어요. 네트워크를 확인한 뒤 다시 시도해 주세요.';
  if (code === 'NAVER_MAP_SCRIPT_FAILED') return '네이버 지도 SDK를 불러오지 못했어요. 네트워크 또는 브라우저 차단 여부를 확인해 주세요.';
  if (code === 'NAVER_MAP_INIT_FAILED') return '네이버 지도 SDK는 받았지만 초기화에 실패했어요. 다시 불러오기를 눌러 주세요.';
  if (code === 'NAVER_CLIENT_ID_MISSING') return '네이버 지도 Client ID를 찾지 못했어요.';
  return `네이버 지도를 불러오지 못했어요. 현재 Web 서비스 URL: ${diagnostic.origin}`;
}

export function LocationPage({ Header, connection, onActivity }: {
  Header: ({ title }: { title?: string }) => React.ReactNode;
  connection: RealCoupleConnection | null;
  onActivity?: (title: string, detail?: string) => void;
}) {
  const uid = auth.currentUser?.uid ?? '';
  const [activeTab, setActiveTab] = useState<LocationTab>('map');
  const [sharing, setSharing] = useState(() => uid ? loadLocationSharing(uid).enabled : false);
  const [visits, setVisits] = useState<LocationVisit[]>(() => uid ? loadLocationVisits(uid) : []);
  const [partnerVisits, setPartnerVisits] = useState<LocationVisit[]>([]);
  const [selectedDay, setSelectedDay] = useState(todayKey());
  const [status, setStatus] = useState('위치 공유를 켜면 이동 기록을 만들어요.');
  const [partnerStatus, setPartnerStatus] = useState('상대방의 오늘 발자취를 불러오는 중이에요.');
  const [tracking, setTracking] = useState(false);
  const [mapStatus, setMapStatus] = useState('네이버 지도를 불러오는 중이에요…');
  const [mapFailed, setMapFailed] = useState(false);
  const [mapAttempt, setMapAttempt] = useState(0);
  const watchId = useRef<number | undefined>(undefined);
  const mapElement = useRef<HTMLDivElement>(null);
  const mapRef = useRef<NaverMap | undefined>(undefined);
  const overlaysRef = useRef<NaverOverlay[]>([]);
  const partnerName = connection?.partnerProfile?.name?.trim() || connection?.partnerProfile?.nickname?.trim() || '상대방';

  const stopWatching = (announce = true) => {
    if (watchId.current !== undefined) navigator.geolocation.clearWatch(watchId.current);
    watchId.current = undefined;
    setTracking(false);
    if (announce) setStatus('위치 공유가 일시 정지됐어요.');
  };

  useEffect(() => () => stopWatching(false), []);

  useEffect(() => {
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
  }, [connection?.coupleId, connection?.partnerUid, partnerName, selectedDay]);

  useEffect(() => {
    let cancelled = false;
    setMapFailed(false);
    setMapStatus('네이버 지도를 불러오는 중이에요…');
    void loadNaverMaps().then((naver) => {
      if (cancelled || !mapElement.current || mapRef.current) return;
      const rect = mapElement.current.getBoundingClientRect();
      if (rect.width < 20 || rect.height < 20) throw new Error('NAVER_MAP_CONTAINER_EMPTY');
      mapRef.current = new naver.maps.Map(mapElement.current, {
        center: new naver.maps.LatLng(37.5666103, 126.9783882),
        zoom: 15,
        zoomControl: true,
        zoomControlOptions: { position: naver.maps.Position.TOP_RIGHT },
      });
      const resize = () => {
        if (!mapRef.current) return;
        naver.maps.Event.trigger(mapRef.current, 'resize');
      };
      window.requestAnimationFrame(() => window.requestAnimationFrame(resize));
      window.setTimeout(resize, 350);
      setMapStatus('');
    }).catch((error) => {
      console.error('[ROUTE NAVER location map]', error, naverMapDiagnostic());
      if (!cancelled) { setMapFailed(true); setMapStatus(mapErrorMessage(error)); }
    });
    return () => {
      cancelled = true;
      overlaysRef.current.forEach((overlay) => overlay.setMap(null));
      overlaysRef.current = [];
      mapRef.current?.destroy?.();
      mapRef.current = undefined;
    };
  }, [mapAttempt]);

  const mapVisits = useMemo(() => activeTab === 'footprints' ? partnerVisits : [...visits].reverse(), [activeTab, partnerVisits, visits]);

  useEffect(() => {
    const naver = naverApi();
    const map = mapRef.current;
    if (!naver?.maps || !map) return;
    naver.maps.Event.trigger(map, 'resize');
    overlaysRef.current.forEach((overlay) => overlay.setMap(null));
    overlaysRef.current = [];

    if (!mapVisits.length) {
      map.setCenter(new naver.maps.LatLng(37.5666103, 126.9783882));
      map.setZoom(15);
      return;
    }

    const points = mapVisits.map((visit) => new naver.maps.LatLng(visit.latitude, visit.longitude));
    if (points.length > 1) overlaysRef.current.push(new naver.maps.Polyline({ map, path: points, strokeColor: '#FF6F61', strokeWeight: 5, strokeOpacity: 0.76 }));

    mapVisits.forEach((visit, index) => {
      const current = !visit.leftAt && index === mapVisits.length - 1;
      const marker = new naver.maps.Marker({ map, position: points[index], icon: { content: markerHtml(current, activeTab === 'footprints' ? index : undefined) } });
      const popup = new naver.maps.InfoWindow({
        content: `<div style="padding:10px 12px;font-size:12px;line-height:1.45"><strong>${escapeHtml(visit.placeName || '위치 기록')}</strong><br>${escapeHtml(dayText(visit.arrivedAt))} · ${escapeHtml(timeText(visit.arrivedAt))}${visit.leftAt ? ` ~ ${escapeHtml(timeText(visit.leftAt))}` : ' · 현재'}</div>`,
        borderWidth: 0,
        backgroundColor: '#fff',
      });
      naver.maps.Event.addListener(marker, 'click', () => popup.open(map, marker));
      overlaysRef.current.push(marker);
    });

    if (points.length === 1) { map.setCenter(points[0]); map.setZoom(17); }
    else {
      const bounds = new naver.maps.LatLngBounds();
      points.forEach((point) => bounds.extend(point));
      map.fitBounds(bounds, { top: 34, right: 34, bottom: 34, left: 34 });
    }
  }, [mapVisits, activeTab]);

  const persistVisits = (next: LocationVisit[]) => {
    setVisits(next);
    if (uid) saveLocationVisits(uid, next);
  };

  const syncVisit = (visit: LocationVisit) => {
    if (!connection?.coupleId || !uid) return;
    void saveCoupleLocationVisit(connection.coupleId, uid, visit).catch(() => setStatus('기기에는 저장됐지만 상대방과 위치 기록을 동기화하지 못했어요.'));
  };

  const recordPosition = async (position: GeolocationPosition) => {
    const point = { latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy: position.coords.accuracy };
    const now = new Date().toISOString();
    const current = visits[0];
    if (current && !current.leftAt && distanceMeters(current, point) < MIN_MOVE_METERS) {
      setStatus(`현재 위치 확인됨 · 오차 약 ${Math.round(position.coords.accuracy)}m`);
      return;
    }
    const placeName = await reverseGeocode(point.latitude, point.longitude);
    const closed = current && !current.leftAt ? { ...current, leftAt: now } : current;
    const rest = current ? visits.slice(1) : visits;
    const nextVisit: LocationVisit = { id: `${Date.now()}`, ...point, placeName, arrivedAt: now };
    const next = [nextVisit, ...(closed ? [closed] : []), ...rest].slice(0, 300);
    persistVisits(next);
    if (closed) syncVisit(closed);
    syncVisit(nextVisit);
    setStatus(placeName ? `${placeName}에서 위치가 확인됐어요.` : '새 위치가 기록됐어요.');
    onActivity?.('새 위치가 기록됐어요', placeName || `${point.latitude.toFixed(5)}, ${point.longitude.toFixed(5)}`);
  };

  const startWatching = () => {
    if (!uid) return;
    if (!('geolocation' in navigator)) return setStatus('이 기기에서는 위치 기능을 사용할 수 없어요.');
    setStatus('위치 권한을 확인하고 있어요…');
    const nextSharing = saveLocationSharing(uid, true);
    setSharing(nextSharing.enabled);
    onActivity?.('위치 공유를 시작했어요');
    watchId.current = navigator.geolocation.watchPosition(
      (position) => { setTracking(true); void recordPosition(position); },
      (error) => {
        stopWatching(false);
        if (error.code === error.PERMISSION_DENIED) {
          saveLocationSharing(uid, false); setSharing(false);
          setStatus('위치 권한이 거부됐어요. 브라우저의 사이트 권한에서 위치를 허용해 주세요.');
        } else setStatus('현재 위치를 가져오지 못했어요. 잠시 뒤 다시 시도해 주세요.');
      },
      { enableHighAccuracy: true, maximumAge: 45_000, timeout: 20_000 },
    );
  };

  const disableSharing = () => {
    if (!uid) return;
    stopWatching(false);
    saveLocationSharing(uid, false);
    setSharing(false);
    setStatus('위치 공유를 껐어요. 기존 이동 기록은 남아 있어요.');
    onActivity?.('위치 공유를 중지했어요');
  };

  const focusVisit = (visit: LocationVisit) => {
    const naver = naverApi();
    if (!naver?.maps || !mapRef.current) return;
    mapRef.current.setCenter(new naver.maps.LatLng(visit.latitude, visit.longitude));
    mapRef.current.setZoom(17);
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
      <button type="button" role="tab" aria-selected={activeTab === 'footprints'} className={activeTab === 'footprints' ? 'active' : ''} onClick={() => setActiveTab('footprints')}>발자취</button>
    </div>

    {activeTab === 'footprints' && <div className="footprint-daybar"><button type="button" onClick={() => moveDay(-1)}>‹</button><label><CalendarDays size={14} /><input type="date" value={selectedDay} max={todayKey()} onChange={(event) => setSelectedDay(event.target.value)} /></label><button type="button" disabled={selectedDay >= todayKey()} onClick={() => moveDay(1)}>›</button></div>}

    <section className="location-map-card" aria-label={activeTab === 'footprints' ? `${partnerName}의 발자취 지도` : '네이버 이동 지도'}>
      <div ref={mapElement} className="location-real-map" />
      {mapStatus && <div className={`location-map-status ${mapFailed ? 'failed' : ''}`}><MapPin size={18} /><span>{mapStatus}</span>{mapFailed && <button type="button" onClick={() => setMapAttempt((value) => value + 1)}><RefreshCw size={14} />다시 불러오기</button>}</div>}
      <div className="location-map-caption"><strong>{activeTab === 'footprints' ? `${partnerName}의 발자취` : '우리의 이동 지도'}</strong><span>{mapVisits.length ? `${mapVisits.length}개의 위치 기록` : '아직 기록 없음'}</span></div>
    </section>

    {activeTab === 'map' ? <>
      <section className={`location-share-card ${sharing ? 'active' : ''}`}>
        <div className="location-share-head"><span><LocateFixed size={21} /></span><div><strong>{sharing ? '내 위치 공유 중' : '내 위치 공유 꺼짐'}</strong><small>{tracking ? '현재 ROUTE가 위치 변화를 확인하고 있어요.' : status}</small></div></div>
        <div className="location-actions">{!sharing ? <button className="primary" type="button" onClick={startWatching}><Navigation size={16} />위치 공유 시작</button> : <>{!tracking && <button className="primary" type="button" onClick={startWatching}><LocateFixed size={16} />다시 추적</button>}<button className="location-stop" type="button" onClick={disableSharing}><PauseCircle size={16} />공유 끄기</button></>}</div>
        <p className="location-privacy"><ShieldCheck size={14} /> 위치 공유를 켠 동안의 방문 기록만 연결된 상대방과 공유돼요.</p>
      </section>
      <section className="location-history">
        <div className="location-section-head"><div><small>TIMELINE</small><h2>최근 다녀온 곳</h2></div><span>{visits.length}곳</span></div>
        {!visits.length ? <div className="location-empty"><MapPin size={24} /><strong>아직 위치 기록이 없어요</strong><p>위치 공유를 시작하고 이동하면 네이버 지도 위에 방문 장소가 자동으로 쌓여요.</p></div> : <div className="location-list">{visits.map((visit, index) => <button type="button" key={visit.id} className="location-visit" onClick={() => focusVisit(visit)}><div className="location-rail"><i className={index === 0 && !visit.leftAt ? 'live' : ''} />{index < visits.length - 1 && <span />}</div><div className="location-visit-copy"><small>{dayText(visit.arrivedAt)}</small><strong>{visit.placeName || '위치 기록'}</strong><p><Clock3 size={13} /> {timeText(visit.arrivedAt)} 도착 · {visit.leftAt ? `${timeText(visit.leftAt)} 이동` : '현재 머무는 중'}</p><em>정확도 약 {Math.round(visit.accuracy)}m · 눌러서 지도에서 보기</em></div></button>)}</div>}
      </section>
    </> : <section className="location-history footprints-history">
      <div className="location-section-head"><div><small>FOOTPRINTS</small><h2>{selectedDay === todayKey() ? `오늘 ${partnerName}의 발자취` : `${partnerName}의 발자취`}</h2></div><span>{partnerVisits.length}곳</span></div>
      {!connection ? <div className="location-empty"><MapPin size={24} /><strong>상대방 연결이 필요해요</strong><p>커플 연결을 완료하면 서로 위치 공유를 켠 시간의 발자취를 볼 수 있어요.</p></div> : !partnerVisits.length ? <div className="location-empty"><MapPin size={24} /><strong>아직 발자취가 없어요</strong><p>{partnerStatus || '상대방이 위치 공유를 켜고 이동하면 시간순으로 표시돼요.'}</p></div> : <div className="location-list footprint-list">{partnerVisits.map((visit, index) => <button type="button" key={visit.id} className="location-visit" onClick={() => focusVisit(visit)}><div className="location-rail footprint-rail"><i className={!visit.leftAt && index === partnerVisits.length - 1 ? 'live' : ''}>{index + 1}</i>{index < partnerVisits.length - 1 && <span />}</div><div className="location-visit-copy"><small>{timeText(visit.arrivedAt)}{visit.leftAt ? ` ~ ${timeText(visit.leftAt)}` : ' ~ 현재'}</small><strong>{visit.placeName || '위치 기록'}</strong><p><Clock3 size={13} /> {visit.leftAt ? '머문 뒤 다음 장소로 이동' : '현재 머무는 중'}</p><em>눌러서 지도에서 보기</em></div></button>)}</div>}
    </section>}
  </div>;
}
