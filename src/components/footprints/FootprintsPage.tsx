import { useEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';
import {
  ArrowLeft,
  CalendarDays,
  ChevronRight,
  Image as ImageIcon,
  MapPin,
  Navigation,
  PauseCircle,
  Play,
  ShieldCheck,
  Square,
  UsersRound,
} from 'lucide-react';
import type { Memory } from '../../types';
import type { RealCoupleConnection } from '../../lib/coupleConnection';
import {
  buildJointDateSessions,
  buildJointFootprints,
  buildJointRoutePoints,
  suggestLegacyMemoryLinks,
  type JointFootprint,
} from '../../lib/footprintFoundation';
import {
  subscribeMemberLocationSamples,
  subscribeMemberLocationVisits,
  type LocationSample,
} from '../../lib/locationRealtime';
import { ensureLocationPermission } from '../../lib/native';
import { PERSISTENT_STATE_CHANGE_EVENT } from '../../utils/persistenceSignal';
import {
  loadLocationSharing,
  loadLocationVisits,
  saveLocationSharing,
  type LocationVisit,
} from '../../utils/location';
import './FootprintsPage.css';

const MAP_ORIGIN = typeof window !== 'undefined' && window.location.hostname === 'danduli.web.app'
  ? 'https://danduli.web.app' : 'https://meluni-f4e00.web.app';
const MAP_URL = MAP_ORIGIN + '/naver-map-host.html?v=14';
const DISPLAY_DATE = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  weekday: 'short',
});
const KOREAN_DATE = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const EMPTY_VISITS: LocationVisit[] = [];
const EMPTY_SAMPLES: LocationSample[] = [];

type FootprintScope = 'partner' | 'together';
type SnapshotState = { key: string; visits: LocationVisit[]; error?: string };
type SampleSnapshotState = { key: string; samples: LocationSample[]; error?: string };

function dayKey(iso: string) {
  const parts = KOREAN_DATE.formatToParts(new Date(iso));
  const part = (key: string) => parts.find((item) => item.type === key)?.value ?? '';
  return part('year') + '-' + part('month') + '-' + part('day');
}

function todayKey() {
  return dayKey(new Date().toISOString());
}

function timeLabel(iso: string) {
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

function mergeVisits(cloud: readonly LocationVisit[], local: readonly LocationVisit[]) {
  const byId = new Map<string, LocationVisit>();
  for (const visit of [...local, ...cloud]) byId.set(visit.id, visit);
  return [...byId.values()].sort((a, b) => a.arrivedAt.localeCompare(b.arrivedAt));
}

function sameDayVisits(visits: readonly LocationVisit[], day: string) {
  return visits.filter((visit) => dayKey(visit.arrivedAt) === day);
}

function samplesAsVisits(samples: readonly LocationSample[]): LocationVisit[] {
  return samples.map((sample) => ({
    id: 'sample-' + sample.id,
    latitude: sample.latitude,
    longitude: sample.longitude,
    accuracy: sample.accuracy,
    arrivedAt: sample.recordedAt,
    lastSeenAt: sample.recordedAt,
  }));
}


type Props = {
  uid: string;
  connection: RealCoupleConnection | null;
  memories: Memory[];
  initialMemoryId?: number;
  onOpenMemory: (id: number) => void;
  onBack: () => void;
  Header: ({ title }: { title?: string }) => React.ReactNode;
};

/**
 * Partner footprint: partner GPS only.
 * Together footprint: derived only from independent GPS evidence from both phones.
 */
export function FootprintsPage({
  uid,
  connection,
  memories,
  initialMemoryId,
  onOpenMemory,
  onBack,
  Header,
}: Props) {
  const focusMemory = memories.find((memory) => memory.id === initialMemoryId);
  const [scope, setScope] = useState<FootprintScope>(focusMemory ? 'together' : 'partner');
  const [day, setDay] = useState(focusMemory?.date || todayKey());
  const [sharing, setSharing] = useState(() => loadLocationSharing(uid).enabled);
  const [sharingBusy, setSharingBusy] = useState(false);
  const [trackingStatus, setTrackingStatus] = useState(
    sharing ? '내 GPS 공유가 켜져 있어요.' : '내 GPS 공유가 꺼져 있어요.',
  );
  const [, setLocalRevision] = useState(0);
  const [mySnapshot, setMySnapshot] = useState<SnapshotState>();
  const [partnerSnapshot, setPartnerSnapshot] = useState<SnapshotState>();
  const [mySampleSnapshot, setMySampleSnapshot] = useState<SampleSnapshotState>();
  const [partnerSampleSnapshot, setPartnerSampleSnapshot] = useState<SampleSnapshotState>();
  const [mapReady, setMapReady] = useState(false);
  const [mapFailed, setMapFailed] = useState(false);
  const [playbackState, setPlaybackState] = useState<'idle' | 'playing'>('idle');
  const [selectedSessionAnchorId, setSelectedSessionAnchorId] = useState<string>();
  const sessionPlaybackRequest = useRef<string | undefined>(undefined);
  const frame = useRef<HTMLIFrameElement>(null);

  const partnerUid = connection?.partnerUid ?? '';
  const partnerName = connection?.partnerProfile?.name?.trim()
    || connection?.partnerProfile?.nickname?.trim()
    || '상대방';
  const snapshotKey = (connection?.coupleId ?? '') + ':' + day;
  const myCloudVisits = mySnapshot?.key === snapshotKey ? mySnapshot.visits : EMPTY_VISITS;
  const partnerVisits = partnerSnapshot?.key === snapshotKey ? partnerSnapshot.visits : EMPTY_VISITS;
  const mySamples = mySampleSnapshot?.key === snapshotKey ? mySampleSnapshot.samples : EMPTY_SAMPLES;
  const partnerSamples = partnerSampleSnapshot?.key === snapshotKey ? partnerSampleSnapshot.samples : EMPTY_SAMPLES;

  useEffect(() => {
    const syncLocalState = () => {
      setSharing(loadLocationSharing(uid).enabled);
      setLocalRevision((value) => value + 1);
    };
    const trackingEvent = (event: Event) => {
      const detail = (event as CustomEvent<{ message?: string }>).detail;
      if (detail?.message) setTrackingStatus(detail.message);
      syncLocalState();
    };
    window.addEventListener(PERSISTENT_STATE_CHANGE_EVENT, syncLocalState);
    window.addEventListener('storage', syncLocalState);
    window.addEventListener('route-location-tracking-status', trackingEvent);
    return () => {
      window.removeEventListener(PERSISTENT_STATE_CHANGE_EVENT, syncLocalState);
      window.removeEventListener('storage', syncLocalState);
      window.removeEventListener('route-location-tracking-status', trackingEvent);
    };
  }, [uid]);

  useEffect(() => {
    const coupleId = connection?.coupleId;
    if (!coupleId || !uid || !partnerUid) return;

    const key = coupleId + ':' + day;
    const stopMine = subscribeMemberLocationVisits(
      coupleId,
      uid,
      day,
      (visits) => setMySnapshot({ key, visits }),
      () => setMySnapshot({ key, visits: [], error: '내 GPS 기록을 불러오지 못했어요.' }),
    );
    const stopPartner = subscribeMemberLocationVisits(
      coupleId,
      partnerUid,
      day,
      (visits) => setPartnerSnapshot({ key, visits }),
      () => setPartnerSnapshot({ key, visits: [], error: partnerName + '의 GPS 기록을 불러오지 못했어요.' }),
    );
    const stopMySamples = subscribeMemberLocationSamples(
      coupleId,
      uid,
      day,
      (samples) => setMySampleSnapshot({ key, samples }),
      () => setMySampleSnapshot({ key, samples: [], error: '내 실시간 GPS 경로를 불러오지 못했어요.' }),
    );
    const stopPartnerSamples = subscribeMemberLocationSamples(
      coupleId,
      partnerUid,
      day,
      (samples) => setPartnerSampleSnapshot({ key, samples }),
      () => setPartnerSampleSnapshot({ key, samples: [], error: partnerName + '의 실시간 GPS 경로를 불러오지 못했어요.' }),
    );
    return () => {
      stopMine();
      stopPartner();
      stopMySamples();
      stopPartnerSamples();
    };
  }, [connection?.coupleId, day, partnerName, partnerUid, uid]);

  const localMine = sameDayVisits(loadLocationVisits(uid), day);
  const myVisits = useMemo(
    () => mergeVisits(myCloudVisits, localMine),
    [localMine, myCloudVisits],
  );
  const jointVisits = useMemo(
    () => buildJointFootprints(uid, partnerUid, myVisits, partnerVisits),
    [myVisits, partnerUid, partnerVisits, uid],
  );
  const myRouteSource = useMemo(
    () => mySamples.length ? samplesAsVisits(mySamples) : myVisits,
    [mySamples, myVisits],
  );
  const partnerRouteSource = useMemo(
    () => partnerSamples.length ? samplesAsVisits(partnerSamples) : partnerVisits,
    [partnerSamples, partnerVisits],
  );
  const jointRoutePoints = useMemo(
    () => buildJointRoutePoints(uid, partnerUid, myRouteSource, partnerRouteSource),
    [myRouteSource, partnerUid, partnerRouteSource, uid],
  );
  const dateSessions = useMemo(
    () => buildJointDateSessions(jointRoutePoints),
    [jointRoutePoints],
  );
  const selectedSessionIndex = selectedSessionAnchorId
    ? dateSessions.findIndex((session) => session.pointIds[0] === selectedSessionAnchorId)
    : -1;
  const selectedSession = selectedSessionIndex >= 0 ? dateSessions[selectedSessionIndex] : undefined;
  const selectedSessionRoutePoints = useMemo(() => {
    if (!selectedSession) return jointRoutePoints;
    const pointIds = new Set(selectedSession.pointIds);
    return jointRoutePoints.filter((point) => pointIds.has(point.id));
  }, [jointRoutePoints, selectedSession]);

  const jointById = useMemo(
    () => new Map(jointVisits.map((visit) => [visit.id, visit])),
    [jointVisits],
  );
  const visible = scope === 'partner' ? partnerVisits : jointVisits;
  const linked = useMemo(
    () => suggestLegacyMemoryLinks(jointVisits, memories),
    [jointVisits, memories],
  );
  const suggested = useMemo(
    () => new Map(linked.map((item) => [item.footprintId, item.memoryIds])),
    [linked],
  );
  const mapVisits = useMemo(() => {
    if (scope === 'partner' && partnerSamples.length) {
      return partnerSamples.map((sample) => ({
        id: 'partner-sample-' + sample.id,
        latitude: sample.latitude,
        longitude: sample.longitude,
        accuracy: sample.accuracy,
        arrivedAt: sample.recordedAt,
      }));
    }
    const source = scope === 'together' && selectedSessionRoutePoints.length ? selectedSessionRoutePoints : visible;
    return source.map((visit) => ({
      id: visit.id,
      latitude: visit.latitude,
      longitude: visit.longitude,
      accuracy: visit.accuracy,
      placeName: 'placeName' in visit ? visit.placeName : undefined,
      arrivedAt: visit.arrivedAt,
      leftAt: 'leftAt' in visit ? visit.leftAt : undefined,
    }));
  }, [partnerSamples, scope, selectedSessionRoutePoints, visible]);

  useEffect(() => {
    const timeout = window.setTimeout(() => setMapFailed(true), 12_000);
    const receive = (event: MessageEvent<{ source?: string; type?: string; state?: string }>) => {
      if (event.origin !== MAP_ORIGIN || event.source !== frame.current?.contentWindow
        || event.data?.source !== 'route-map-host') return;
      if (event.data.type === 'ready') {
        window.clearTimeout(timeout);
        setMapReady(true);
        setMapFailed(false);
      }
      if (event.data.type === 'playback-state') {
        setPlaybackState(event.data.state === 'playing' ? 'playing' : 'idle');
      }
      if (event.data.type === 'auth-error' || event.data.type === 'sdk-error'
        || event.data.type === 'script-error' || event.data.type === 'render-error') {
        window.clearTimeout(timeout);
        setMapFailed(true);
      }
    };
    window.addEventListener('message', receive);
    return () => {
      window.clearTimeout(timeout);
      window.removeEventListener('message', receive);
    };
  }, []);

  useEffect(() => {
    if (!mapReady) return;
    frame.current?.contentWindow?.postMessage({
      source: 'route-map-parent',
      type: 'render',
      visits: mapVisits,
      mode: 'footprints',
      numbered: mapVisits.length <= 20,
      routeOnly: mapVisits.length > 20,
    }, MAP_ORIGIN);
  }, [mapReady, mapVisits]);

  useEffect(() => {
    const requestedSessionAnchorId = sessionPlaybackRequest.current;
    if (!requestedSessionAnchorId || !mapReady || !selectedSession
      || selectedSession.pointIds[0] !== requestedSessionAnchorId) return;
    if (mapVisits.length < 2) {
      sessionPlaybackRequest.current = undefined;
      return;
    }
    frame.current?.contentWindow?.postMessage({
      source: 'route-map-parent',
      type: 'play-route',
      visits: mapVisits,
      follow: true,
    }, MAP_ORIGIN);
    sessionPlaybackRequest.current = undefined;
  }, [mapReady, mapVisits, selectedSession]);

  const stopPlayback = () => {
    if (playbackState !== 'playing') return;
    frame.current?.contentWindow?.postMessage({
      source: 'route-map-parent',
      type: 'stop-route-playback',
    }, MAP_ORIGIN);
  };

  const playSession = (sessionAnchorId: string) => {
    if (!dateSessions.some((session) => session.pointIds[0] === sessionAnchorId)) return;
    if (selectedSessionAnchorId === sessionAnchorId && mapReady && mapVisits.length >= 2) {
      frame.current?.contentWindow?.postMessage({
        source: 'route-map-parent',
        type: 'play-route',
        visits: mapVisits,
        follow: true,
      }, MAP_ORIGIN);
      return;
    }
    sessionPlaybackRequest.current = sessionAnchorId;
    setSelectedSessionAnchorId(sessionAnchorId);
  };

  const clearSessionSelection = () => {
    stopPlayback();
    sessionPlaybackRequest.current = undefined;
    setSelectedSessionAnchorId(undefined);
  };

  const showWholeDay = () => {
    clearSessionSelection();
  };

  const changeScope = (nextScope: FootprintScope) => {
    stopPlayback();
    sessionPlaybackRequest.current = undefined;
    setSelectedSessionAnchorId(undefined);
    setScope(nextScope);
  };

  const changeDay = (nextDay: string) => {
    if (!nextDay || nextDay > todayKey()) return;
    stopPlayback();
    sessionPlaybackRequest.current = undefined;
    setSelectedSessionAnchorId(undefined);
    setDay(nextDay);
  };

  const togglePlayback = () => {
    if (!mapReady || mapVisits.length < 2) return;
    frame.current?.contentWindow?.postMessage({
      source: 'route-map-parent',
      type: playbackState === 'playing' ? 'stop-route-playback' : 'play-route',
      visits: mapVisits,
      follow: true,
    }, MAP_ORIGIN);
  };

  const setLocationSharing = async (enabled: boolean) => {
    if (!uid || sharingBusy) return;
    if (enabled && !connection?.coupleId) {
      setTrackingStatus('상대방과 연결한 뒤 위치 공유를 켤 수 있어요.');
      return;
    }
    setSharingBusy(true);
    try {
      if (enabled) {
        const allowed = await ensureLocationPermission();
        if (!allowed) {
          setTrackingStatus('위치 권한이 필요해요. 휴대폰 설정에서 단둘이의 위치 권한을 허용해 주세요.');
          return;
        }
      }
      saveLocationSharing(uid, enabled);
      setSharing(enabled);
      setTrackingStatus(enabled
        ? '내 GPS 공유를 시작했어요. Android 앱에서는 화면을 내려도 발자취 기록을 이어가요.'
        : '내 GPS 공유를 껐어요. 새 위치 기록만 중지되고 기존 기록은 남아 있어요.');
    } finally {
      setSharingBusy(false);
    }
  };

  const moveDay = (amount: number) => {
    const current = new Date(day + 'T12:00:00+09:00');
    current.setDate(current.getDate() + amount);
    const next = dayKey(current.toISOString());
    if (next <= todayKey()) changeDay(next);
  };

  const shown = [...visible].reverse();
  const partnerError = partnerSnapshot?.key === snapshotKey ? partnerSnapshot.error : undefined;
  const myError = mySnapshot?.key === snapshotKey ? mySnapshot.error : undefined;
  const partnerSampleError = partnerSampleSnapshot?.key === snapshotKey ? partnerSampleSnapshot.error : undefined;
  const mySampleError = mySampleSnapshot?.key === snapshotKey ? mySampleSnapshot.error : undefined;
  const latestPartnerSample = partnerSamples[partnerSamples.length - 1];
  const selectedDate = DISPLAY_DATE.format(new Date(day + 'T12:00:00+09:00'));

  return <div className="page footprints-page">
    <Header title="발자취" />
    <div className="footprints-heading">
      <button type="button" onClick={onBack} aria-label="이전 화면으로"><ArrowLeft size={20} /></button>
      <div>
        <small>COUPLE FOOTPRINTS</small>
        <h1>우리의 발자취 ♡</h1>
        <p>상대방의 이동과 둘이 실제로 함께 있었던 시간을 구분해서 확인해요.</p>
      </div>
    </div>

    <section className={'footprints-sharing ' + (sharing ? 'active' : '')}>
      <div className="footprints-sharing-copy">
        <span className="footprints-sharing-icon"><Navigation size={18} /></span>
        <span>
          <b>{sharing ? '내 GPS 공유 중' : '내 GPS 공유 꺼짐'}</b>
          <small>{trackingStatus}</small>
        </span>
      </div>
      <button
        type="button"
        className={sharing ? 'stop' : 'start'}
        disabled={sharingBusy || !connection}
        onClick={() => void setLocationSharing(!sharing)}
      >
        {sharing ? <><PauseCircle size={15} />공유 끄기</> : <><Navigation size={15} />공유 시작</>}
      </button>
    </section>

    <div className="footprints-privacy"><ShieldCheck size={19} />
      <span>
        <b>발자취 판정 원칙</b>
        <small>{partnerName}의 발자취는 {partnerName}의 GPS만 사용해요. 우리의 발자취는 내 GPS와 {partnerName}의 GPS가 시간과 거리 기준을 모두 통과한 구간만 만들어요.</small>
      </span>
    </div>

    <div className="footprints-scope-tabs" role="tablist" aria-label="발자취 종류">
      <button type="button" role="tab" aria-selected={scope === 'partner'} className={scope === 'partner' ? 'active' : ''} onClick={() => changeScope('partner')}>
        <MapPin size={16} /><span><b>{partnerName} 발자취</b><small>상대방 GPS만</small></span>
      </button>
      <button type="button" role="tab" aria-selected={scope === 'together'} className={scope === 'together' ? 'active' : ''} onClick={() => changeScope('together')}>
        <UsersRound size={16} /><span><b>우리 둘의 발자취</b><small>두 GPS 교차검증</small></span>
      </button>
    </div>

    <div className="footprints-datebar">
      <button type="button" aria-label="이전 날짜" onClick={() => moveDay(-1)}>‹</button>
      <label><CalendarDays size={16} /><input type="date" value={day} max={todayKey()} onChange={(event) => changeDay(event.target.value)} /></label>
      <button type="button" aria-label="다음 날짜" disabled={day >= todayKey()} onClick={() => moveDay(1)}>›</button>
      <span>{selectedDate}</span>
    </div>

    <div className="footprints-workspace">
      <section className="footprints-map" aria-label="발자취 지도">
        <iframe ref={frame} title="네이버 발자취 지도" src={MAP_URL} referrerPolicy="strict-origin-when-cross-origin" onError={() => setMapFailed(true)} />
        {!mapReady && <div className="footprints-map-status" role="status">{mapFailed ? '지도를 불러오지 못했어요. 네트워크와 지도 인증을 확인해 주세요.' : '네이버 지도를 불러오는 중이에요…'}</div>}
        <button
          type="button"
          className={'footprints-playback ' + (playbackState === 'playing' ? 'playing' : '')}
          disabled={!mapReady || mapVisits.length < 2}
          onClick={togglePlayback}
        >
          {playbackState === 'playing'
            ? <><Square size={14} fill="currentColor" />재생 중지</>
            : <><Play size={15} fill="currentColor" />{selectedSession ? '선택 데이트 재생' : '발자취 재생'}</>}
        </button>
        <div className="footprints-map-badge">
          {scope === 'partner'
            ? partnerSamples.length
              ? partnerName + ' GPS · 서버 실시간 샘플 ' + partnerSamples.length + '개'
              : partnerName + '의 GPS 경로만 표시'
            : selectedSession
              ? '데이트 ' + (selectedSessionIndex + 1) + ' · 교차검증 ' + selectedSession.verifiedPointCount + '개 지점'
              : jointRoutePoints.length
                ? '반복 교차검증된 함께 이동 구간'
                : '두 사람 GPS 교차검증 완료 장소'}
        </div>
      </section>

      <section className="footprints-list">
        <div className="footprints-list-header">
          <div>
            <small>{scope === 'partner' ? 'PARTNER GPS' : 'CROSS-CHECKED'}</small>
            <h2>{scope === 'partner' ? partnerName + '의 발자취' : '함께 있었던 장소'}</h2>
          </div>
          <span>{scope === 'together' && selectedSession
            ? '데이트 ' + (selectedSessionIndex + 1) + ' 선택'
            : scope === 'together' && dateSessions.length
              ? dateSessions.length + '번 데이트'
              : shown.length + '곳'}</span>
        </div>

        {scope === 'partner' && latestPartnerSample && <div className="footprints-live">
          <span className="footprints-live-dot" />
          <div><b>최근 GPS 서버 반영</b><small>{timeLabel(latestPartnerSample.recordedAt)} · 오차 약 {Math.round(latestPartnerSample.accuracy)}m</small></div>
        </div>}

        {scope === 'together' && dateSessions.length > 0 && <div className="footprints-sessions">
          <div className="footprints-session-toolbar">
            <span>데이트를 누르면 해당 구간만 지도에 남기고 바로 재생해요.</span>
            {selectedSession && <button type="button" onClick={showWholeDay}>하루 전체 보기</button>}
          </div>
          {dateSessions.map((session, index) => {
            const sessionAnchorId = session.pointIds[0];
            const selected = sessionAnchorId === selectedSessionAnchorId;
            return <button
              type="button"
              key={session.id}
              className={'footprints-session-card ' + (selected ? 'selected' : '')}
              aria-pressed={selected}
              onClick={() => playSession(sessionAnchorId)}
            >
              <span className="footprints-session-icon"><UsersRound size={15} /></span>
              <span className="footprints-session-copy">
                <b>데이트 {index + 1}</b>
                <small>{timeLabel(session.startedAt)} ~ {timeLabel(session.endedAt)} · 약 {session.durationMinutes}분 · 검증 {session.verifiedPointCount}개</small>
                {session.reconnectCount > 0 && <em>잠깐 떨어졌다 다시 만난 구간 {session.reconnectCount}회 포함</em>}
              </span>
              <span className="footprints-session-action">
                <Play size={13} fill="currentColor" />
                {selected && playbackState === 'playing' ? '재생 중' : '재생'}
              </span>
            </button>;
          })}
        </div>}

        {!connection ? <div className="footprints-empty">
          <MapPin size={26} />
          <strong>상대방 연결이 필요해요</strong>
          <p>커플 연결을 완료하면 서로 동의해 공유한 GPS 발자취를 확인할 수 있어요.</p>
        </div> : (partnerError || partnerSampleError || (scope === 'together' && (myError || mySampleError))) ? <div className="footprints-empty">
          <ShieldCheck size={26} />
          <strong>GPS 기록을 불러오지 못했어요</strong>
          <p>{partnerError || partnerSampleError || myError || mySampleError}</p>
        </div> : !shown.length && !(scope === 'together' && dateSessions.length) ? <div className="footprints-empty">
          {scope === 'partner' ? <MapPin size={26} /> : <UsersRound size={26} />}
          <strong>{scope === 'partner' ? '이 날짜의 상대방 발자취가 없어요' : '함께 있었던 것으로 확인된 기록이 없어요'}</strong>
          <p>{scope === 'partner'
            ? partnerName + '이 위치 공유를 켠 상태에서 기록된 GPS가 있으면 여기에 표시돼요.'
            : '한 사람의 GPS만으로는 기록하지 않아요. 두 기기의 시간·거리·정확도 기준이 모두 맞아야 표시돼요.'}</p>
        </div> : shown.map((visit) => {
          const joint = jointById.get(visit.id) as JointFootprint | undefined;
          const verified = Boolean(joint);
          const leftAt = visit.leftAt;
          return <article className="footprints-visit" key={visit.id}>
            <div className={'footprints-pin ' + (verified ? 'verified' : '')}>{verified ? <UsersRound size={16} /> : <MapPin size={17} />}</div>
            <div className="footprints-visit-text">
              <small>{timeLabel(visit.arrivedAt)}{leftAt ? ' ~ ' + timeLabel(leftAt) : ' ~ 현재'}</small>
              <strong>{visit.placeName || (verified ? '함께 있었던 위치' : '위치 기록')}</strong>
              {joint
                ? <span className="footprints-verified-text"><ShieldCheck size={12} /> GPS 교차검증 · 두 기기 약 {joint.separationMeters}m · 함께 {joint.overlapMinutes}분</span>
                : <span>GPS 오차 약 {Math.round(visit.accuracy)}m · {partnerName} GPS 기록</span>}
              {joint && Boolean(suggested.get(visit.id)?.length) && <div className="footprints-related">
                {suggested.get(visit.id)?.map((memoryId) => {
                  const memory = memories.find((item) => item.id === memoryId);
                  return memory && <button type="button" key={memoryId} onClick={() => onOpenMemory(memoryId)}>
                    <ImageIcon size={14} /> {memory.title} <ChevronRight size={13} />
                  </button>;
                })}
              </div>}
            </div>
          </article>;
        })}
      </section>
    </div>

    <p className="footprints-footnote">
      우리의 장소 기록은 두 사람의 GPS가 약 120m 이내에서 2분 이상 겹칠 때만 생성해요. 원본 GPS 샘플은 서버에 각자 소유 기록으로 저장되고, 반복해서 두 GPS가 일치한 구간만 공동 경로로 계산해요. 30분 이내 잠깐 떨어졌다 다시 확인되면 같은 데이트로 묶어요.
    </p>
  </div>;
}
