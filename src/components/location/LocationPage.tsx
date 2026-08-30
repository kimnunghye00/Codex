import { Clock3, LocateFixed, MapPin, Navigation, PauseCircle, ShieldCheck } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type React from 'react';
import { auth } from '../../lib/firebase';
import {
  distanceMeters,
  loadLocationSharing,
  loadLocationVisits,
  reverseGeocode,
  saveLocationSharing,
  saveLocationVisits,
  type LocationVisit,
} from '../../utils/location';

const MIN_MOVE_METERS = 120;
const LEAFLET_SCRIPT_ID = 'meluni-leaflet-script';
const LEAFLET_STYLE_ID = 'meluni-leaflet-style';

type LeafletMap = {
  remove: () => void;
  invalidateSize: () => void;
  fitBounds: (bounds: unknown, options?: unknown) => void;
  setView: (latLng: [number, number], zoom: number) => void;
};

type LeafletLayerGroup = {
  clearLayers: () => void;
  addTo: (map: LeafletMap) => LeafletLayerGroup;
};

type LeafletApi = {
  map: (element: HTMLElement, options?: unknown) => LeafletMap;
  tileLayer: (url: string, options?: unknown) => { addTo: (map: LeafletMap) => unknown };
  layerGroup: () => LeafletLayerGroup;
  marker: (latLng: [number, number], options?: unknown) => { addTo: (group: LeafletLayerGroup) => unknown; bindPopup: (html: string) => unknown };
  circleMarker: (latLng: [number, number], options?: unknown) => { addTo: (group: LeafletLayerGroup) => { bindPopup: (html: string) => unknown } };
  polyline: (latLngs: [number, number][], options?: unknown) => { addTo: (group: LeafletLayerGroup) => unknown };
  latLngBounds: (latLngs: [number, number][]) => unknown;
};

function leafletApi() {
  return (window as typeof window & { L?: LeafletApi }).L;
}

function loadLeaflet() {
  return new Promise<LeafletApi>((resolve, reject) => {
    const ready = leafletApi();
    if (ready) return resolve(ready);

    if (!document.getElementById(LEAFLET_STYLE_ID)) {
      const link = document.createElement('link');
      link.id = LEAFLET_STYLE_ID;
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      link.crossOrigin = '';
      document.head.appendChild(link);
    }

    const existing = document.getElementById(LEAFLET_SCRIPT_ID) as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener('load', () => {
        const loaded = leafletApi();
        if (loaded) resolve(loaded);
        else reject(new Error('Leaflet failed to initialize'));
      }, { once: true });
      existing.addEventListener('error', () => reject(new Error('Leaflet failed to load')), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.id = LEAFLET_SCRIPT_ID;
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    script.crossOrigin = '';
    script.onload = () => {
      const loaded = leafletApi();
      if (loaded) resolve(loaded);
      else reject(new Error('Leaflet failed to initialize'));
    };
    script.onerror = () => reject(new Error('Leaflet failed to load'));
    document.body.appendChild(script);
  });
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

export function LocationPage({ Header, onActivity }: {
  Header: ({ title }: { title?: string }) => React.ReactNode;
  onActivity?: (title: string, detail?: string) => void;
}) {
  const uid = auth.currentUser?.uid ?? '';
  const [sharing, setSharing] = useState(() => uid ? loadLocationSharing(uid).enabled : false);
  const [visits, setVisits] = useState<LocationVisit[]>(() => uid ? loadLocationVisits(uid) : []);
  const [status, setStatus] = useState('위치 공유를 켜면 이동 기록을 만들어요.');
  const [tracking, setTracking] = useState(false);
  const [mapStatus, setMapStatus] = useState('지도를 불러오는 중이에요…');
  const watchId = useRef<number>();
  const mapElement = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap>();
  const visitLayerRef = useRef<LeafletLayerGroup>();

  const stopWatching = (announce = true) => {
    if (watchId.current !== undefined) navigator.geolocation.clearWatch(watchId.current);
    watchId.current = undefined;
    setTracking(false);
    if (announce) setStatus('위치 공유가 일시 정지됐어요.');
  };

  useEffect(() => () => stopWatching(false), []);

  useEffect(() => {
    let cancelled = false;
    let resizeObserver: ResizeObserver | undefined;

    void loadLeaflet().then((L) => {
      if (cancelled || !mapElement.current) return;
      if (!mapRef.current) {
        const map = L.map(mapElement.current, { zoomControl: true, attributionControl: true });
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19,
          attribution: '&copy; OpenStreetMap contributors',
        }).addTo(map);
        map.setView([37.5665, 126.978], 12);
        mapRef.current = map;
        visitLayerRef.current = L.layerGroup().addTo(map);
        resizeObserver = new ResizeObserver(() => map.invalidateSize());
        resizeObserver.observe(mapElement.current);
      }
      setMapStatus(visits.length ? '' : '위치 기록이 생기면 방문한 장소가 지도에 표시돼요.');
    }).catch(() => {
      if (!cancelled) setMapStatus('지도를 불러오지 못했어요. 인터넷 연결을 확인해 주세요.');
    });

    return () => {
      cancelled = true;
      resizeObserver?.disconnect();
    };
  }, []);

  useEffect(() => {
    const L = leafletApi();
    const map = mapRef.current;
    const layer = visitLayerRef.current;
    if (!L || !map || !layer) return;

    layer.clearLayers();
    if (!visits.length) {
      map.setView([37.5665, 126.978], 12);
      setMapStatus('위치 기록이 생기면 방문한 장소가 지도에 표시돼요.');
      return;
    }

    const points = visits.map((visit) => [visit.latitude, visit.longitude] as [number, number]);
    if (points.length > 1) L.polyline(points, { color: '#6f63df', weight: 4, opacity: 0.55 }).addTo(layer);

    visits.forEach((visit, index) => {
      const popup = `<strong>${escapeHtml(visit.placeName || '위치 기록')}</strong><br>${escapeHtml(dayText(visit.arrivedAt))} · ${escapeHtml(timeText(visit.arrivedAt))}`;
      L.circleMarker([visit.latitude, visit.longitude], {
        radius: index === 0 && !visit.leftAt ? 9 : 7,
        color: index === 0 && !visit.leftAt ? '#5b5bd6' : '#ffffff',
        weight: 3,
        fillColor: index === 0 && !visit.leftAt ? '#5b5bd6' : '#8b86d9',
        fillOpacity: 1,
      }).addTo(layer).bindPopup(popup);
    });

    if (points.length === 1) map.setView(points[0], 16);
    else map.fitBounds(L.latLngBounds(points), { padding: [28, 28], maxZoom: 16 });
    setMapStatus('');
    window.setTimeout(() => map.invalidateSize(), 50);
  }, [visits, mapRef.current]);

  const persistVisits = (next: LocationVisit[]) => {
    setVisits(next);
    if (uid) saveLocationVisits(uid, next);
  };

  const recordPosition = async (position: GeolocationPosition) => {
    const point = {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracy: position.coords.accuracy,
    };
    const now = new Date().toISOString();
    const current = visits[0];

    if (current && !current.leftAt && distanceMeters(current, point) < MIN_MOVE_METERS) {
      setStatus(`현재 위치 확인됨 · 오차 약 ${Math.round(position.coords.accuracy)}m`);
      return;
    }

    const placeName = await reverseGeocode(point.latitude, point.longitude);
    const closed = current && !current.leftAt ? { ...current, leftAt: now } : current;
    const rest = current ? visits.slice(1) : visits;
    const nextVisit: LocationVisit = {
      id: `${Date.now()}`,
      ...point,
      placeName,
      arrivedAt: now,
    };
    persistVisits([nextVisit, ...(closed ? [closed] : []), ...rest].slice(0, 300));
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
          saveLocationSharing(uid, false);
          setSharing(false);
          setStatus('위치 권한이 거부됐어요. 브라우저의 사이트 권한에서 위치를 허용해 주세요.');
        } else {
          setStatus('현재 위치를 가져오지 못했어요. 잠시 뒤 다시 시도해 주세요.');
        }
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
    mapRef.current?.setView([visit.latitude, visit.longitude], 16);
  };

  return <div className="page location-page">
    <Header title="위치" />

    <section className="location-map-card" aria-label="실제 이동 지도">
      <div ref={mapElement} className="location-real-map" />
      {mapStatus && <div className="location-map-status"><MapPin size={18} /><span>{mapStatus}</span></div>}
      <div className="location-map-caption"><strong>우리의 이동 지도</strong><span>{visits.length ? `${visits.length}개의 위치 기록` : '아직 기록 없음'}</span></div>
    </section>

    <section className={`location-share-card ${sharing ? 'active' : ''}`}>
      <div className="location-share-head"><span><LocateFixed size={21} /></span><div><strong>{sharing ? '내 위치 공유 중' : '내 위치 공유 꺼짐'}</strong><small>{tracking ? '현재 MELUNI가 위치 변화를 확인하고 있어요.' : status}</small></div></div>
      <div className="location-actions">
        {!sharing ? <button className="primary" type="button" onClick={startWatching}><Navigation size={16} />위치 공유 시작</button> : <>
          {!tracking && <button className="primary" type="button" onClick={startWatching}><LocateFixed size={16} />다시 추적</button>}
          <button className="location-stop" type="button" onClick={disableSharing}><PauseCircle size={16} />공유 끄기</button>
        </>}
      </div>
      <p className="location-privacy"><ShieldCheck size={14} /> 위치 공유는 직접 켠 경우에만 동작하고, 기존 방문 기록은 기기에 저장돼요.</p>
    </section>

    <section className="location-history">
      <div className="location-section-head"><div><small>TIMELINE</small><h2>최근 다녀온 곳</h2></div><span>{visits.length}곳</span></div>
      {!visits.length ? <div className="location-empty"><MapPin size={24} /><strong>아직 위치 기록이 없어요</strong><p>위치 공유를 시작하고 이동하면 실제 지도 위에 방문 장소가 자동으로 쌓여요.</p></div> : <div className="location-list">{visits.map((visit, index) => <button type="button" key={visit.id} className="location-visit" onClick={() => focusVisit(visit)}>
        <div className="location-rail"><i className={index === 0 && !visit.leftAt ? 'live' : ''} />{index < visits.length - 1 && <span />}</div>
        <div className="location-visit-copy"><small>{dayText(visit.arrivedAt)}</small><strong>{visit.placeName || '위치 기록'}</strong><p><Clock3 size={13} /> {timeText(visit.arrivedAt)} 도착 · {visit.leftAt ? `${timeText(visit.leftAt)} 이동` : '현재 머무는 중'}</p><em>정확도 약 {Math.round(visit.accuracy)}m · 눌러서 지도에서 보기</em></div>
      </button>)}</div>}
    </section>
  </div>;
}
