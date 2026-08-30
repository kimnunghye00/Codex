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

function timeText(value?: string) {
  if (!value) return '현재';
  return new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

function dayText(value: string) {
  return new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' }).format(new Date(value));
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
  const watchId = useRef<number>();

  const stopWatching = (announce = true) => {
    if (watchId.current !== undefined) navigator.geolocation.clearWatch(watchId.current);
    watchId.current = undefined;
    setTracking(false);
    if (announce) setStatus('위치 공유가 일시 정지됐어요.');
  };

  useEffect(() => () => stopWatching(false), []);

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

  return <div className="page location-page">
    <Header title="위치" />
    <div className="location-title"><small>BETWEEN US</small><h1>우리의 이동 기록</h1><p>서로 동의했을 때만 위치를 공유하고, 언제든 바로 끌 수 있어요.</p></div>

    <section className={`location-share-card ${sharing ? 'active' : ''}`}>
      <div className="location-share-head"><span><LocateFixed size={21} /></span><div><strong>{sharing ? '내 위치 공유 중' : '내 위치 공유 꺼짐'}</strong><small>{tracking ? '현재 MELUNI가 위치 변화를 확인하고 있어요.' : status}</small></div></div>
      <div className="location-actions">
        {!sharing ? <button className="primary" type="button" onClick={startWatching}><Navigation size={16} />위치 공유 시작</button> : <>
          {!tracking && <button className="primary" type="button" onClick={startWatching}><LocateFixed size={16} />다시 추적</button>}
          <button className="location-stop" type="button" onClick={disableSharing}><PauseCircle size={16} />공유 끄기</button>
        </>}
      </div>
      <p className="location-privacy"><ShieldCheck size={14} /> 위치 공유는 기본적으로 꺼져 있고, 직접 켠 경우에만 동작해요.</p>
    </section>

    <section className="partner-location-card">
      <div><MapPin size={18} /><span><strong>상대방 위치</strong><small>상대방도 위치 공유에 동의하면 여기에 현재 위치와 이동 기록이 함께 표시돼요.</small></span></div>
      <em>연결 준비 중</em>
    </section>

    <section className="location-history">
      <div className="location-section-head"><div><small>TIMELINE</small><h2>최근 다녀온 곳</h2></div><span>{visits.length}곳</span></div>
      {!visits.length ? <div className="location-empty"><MapPin size={24} /><strong>아직 위치 기록이 없어요</strong><p>위치 공유를 시작하고 이동하면 방문 시간이 자동으로 쌓여요.</p></div> : <div className="location-list">{visits.map((visit, index) => <article key={visit.id} className="location-visit">
        <div className="location-rail"><i className={index === 0 && !visit.leftAt ? 'live' : ''} />{index < visits.length - 1 && <span />}</div>
        <div className="location-visit-copy"><small>{dayText(visit.arrivedAt)}</small><strong>{visit.placeName || '위치 기록'}</strong><p><Clock3 size={13} /> {timeText(visit.arrivedAt)} 도착 · {visit.leftAt ? `${timeText(visit.leftAt)} 이동` : '현재 머무는 중'}</p><em>정확도 약 {Math.round(visit.accuracy)}m</em></div>
      </article>)}</div>}
    </section>

    <div className="location-web-note"><strong>현재 개발 버전 안내</strong><p>지금 MELUNI는 웹앱이라 앱을 완전히 닫거나 휴대폰이 백그라운드에서 웹페이지를 중지하면 위치 기록이 멈출 수 있어요. 스파이디 트래커처럼 하루 종일 안정적으로 기록하려면 추후 모바일 앱 버전에 백그라운드 위치 권한을 연결해야 해요.</p></div>
  </div>;
}
