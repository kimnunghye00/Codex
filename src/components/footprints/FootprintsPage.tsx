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
  ShieldCheck,
  UsersRound,
} from 'lucide-react';
import type { Memory } from '../../types';
import type { RealCoupleConnection } from '../../lib/coupleConnection';
import {
  buildJointFootprints,
  suggestLegacyMemoryLinks,
  type JointFootprint,
} from '../../lib/footprintFoundation';
import { subscribeMemberLocationVisits } from '../../lib/locationRealtime';
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
const MAP_URL = MAP_ORIGIN + '/naver-map-host.html?v=12';
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

type FootprintScope = 'partner' | 'together';
type SnapshotState = { key: string; visits: LocationVisit[]; error?: string };

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
  const [mapReady, setMapReady] = useState(false);
  const [mapFailed, setMapFailed] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);

  const partnerUid = connection?.partnerUid ?? '';
  const partnerName = connection?.partnerProfile?.name?.trim()
    || connection?.partnerProfile?.nickname?.trim()
    || '상대방';
  const snapshotKey = (connection?.coupleId ?? '') + ':' + day;
  const myCloudVisits = mySnapshot?.key === snapshotKey ? mySnapshot.visits : EMPTY_VISITS;
  const partnerVisits = partnerSnapshot?.key === snapshotKey ? partnerSnapshot.visits : EMPTY_VISITS;

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
    return () => {
      stopMine();
      stopPartner();
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
  const mapVisits = useMemo(() => visible.map((visit) => ({
    id: visit.id,
    latitude: visit.latitude,
    longitude: visit.longitude,
    accuracy: visit.accuracy,
    placeName: visit.placeName,
    arrivedAt: visit.arrivedAt,
    leftAt: visit.leftAt,
  })), [visible]);

  useEffect(() => {
    const timeout = window.setTimeout(() => setMapFailed(true), 12_000);
    const receive = (event: MessageEvent<{ source?: string; type?: string }>) => {
      if (event.origin !== MAP_ORIGIN || event.source !== frame.current?.contentWindow
        || event.data?.source !== 'route-map-host') return;
      if (event.data.type === 'ready') {
        window.clearTimeout(timeout);
        setMapReady(true);
        setMapFailed(false);
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
      numbered: true,
    }, MAP_ORIGIN);
  }, [mapReady, mapVisits]);

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
        ? '내 GPS 공유를 시작했어요. 앱을 사용하는 동안 발자취가 기록돼요.'
        : '내 GPS 공유를 껐어요. 새 위치 기록만 중지되고 기존 기록은 남아 있어요.');
    } finally {
      setSharingBusy(false);
    }
  };

  const moveDay = (amount: number) => {
    const current = new Date(day + 'T12:00:00+09:00');
    current.setDate(current.getDate() + amount);
    const next = dayKey(current.toISOString());
    if (next <= todayKey()) setDay(next);
  };

  const shown = [...visible].reverse();
  const partnerError = partnerSnapshot?.key === snapshotKey ? partnerSnapshot.error : undefined;
  const myError = mySnapshot?.key === snapshotKey ? mySnapshot.error : undefined;
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
      <button type="button" role="tab" aria-selected={scope === 'partner'} className={scope === 'partner' ? 'active' : ''} onClick={() => setScope('partner')}>
        <MapPin size={16} /><span><b>{partnerName} 발자취</b><small>상대방 GPS만</small></span>
      </button>
      <button type="button" role="tab" aria-selected={scope === 'together'} className={scope === 'together' ? 'active' : ''} onClick={() => setScope('together')}>
        <UsersRound size={16} /><span><b>우리 둘의 발자취</b><small>두 GPS 교차검증</small></span>
      </button>
    </div>

    <div className="footprints-datebar">
      <button type="button" aria-label="이전 날짜" onClick={() => moveDay(-1)}>‹</button>
      <label><CalendarDays size={16} /><input type="date" value={day} max={todayKey()} onChange={(event) => setDay(event.target.value)} /></label>
      <button type="button" aria-label="다음 날짜" disabled={day >= todayKey()} onClick={() => moveDay(1)}>›</button>
      <span>{selectedDate}</span>
    </div>

    <div className="footprints-workspace">
      <section className="footprints-map" aria-label="발자취 지도">
        <iframe ref={frame} title="네이버 발자취 지도" src={MAP_URL} referrerPolicy="strict-origin-when-cross-origin" onError={() => setMapFailed(true)} />
        {!mapReady && <div className="footprints-map-status" role="status">{mapFailed ? '지도를 불러오지 못했어요. 네트워크와 지도 인증을 확인해 주세요.' : '네이버 지도를 불러오는 중이에요…'}</div>}
        <div className="footprints-map-badge">
          {scope === 'partner' ? partnerName + '의 GPS 경로만 표시' : '두 사람 GPS 교차검증 완료 구간만 표시'}
        </div>
      </section>

      <section className="footprints-list">
        <div className="footprints-list-header">
          <div>
            <small>{scope === 'partner' ? 'PARTNER GPS' : 'CROSS-CHECKED'}</small>
            <h2>{scope === 'partner' ? partnerName + '의 발자취' : '함께 있었던 장소'}</h2>
          </div>
          <span>{shown.length}곳</span>
        </div>

        {!connection ? <div className="footprints-empty">
          <MapPin size={26} />
          <strong>상대방 연결이 필요해요</strong>
          <p>커플 연결을 완료하면 서로 동의해 공유한 GPS 발자취를 확인할 수 있어요.</p>
        </div> : (partnerError || (scope === 'together' && myError)) ? <div className="footprints-empty">
          <ShieldCheck size={26} />
          <strong>GPS 기록을 불러오지 못했어요</strong>
          <p>{partnerError || myError}</p>
        </div> : !shown.length ? <div className="footprints-empty">
          {scope === 'partner' ? <MapPin size={26} /> : <UsersRound size={26} />}
          <strong>{scope === 'partner' ? '이 날짜의 상대방 발자취가 없어요' : '함께 있었던 것으로 확인된 기록이 없어요'}</strong>
          <p>{scope === 'partner'
            ? partnerName + '이 위치 공유를 켠 상태에서 기록된 GPS가 있으면 여기에 표시돼요.'
            : '한 사람의 GPS만으로는 기록하지 않아요. 두 기기의 시간·거리·정확도 기준이 모두 맞아야 표시돼요.'}</p>
        </div> : shown.map((visit) => {
          const joint = jointById.get(visit.id) as JointFootprint | undefined;
          return <article className="footprints-visit" key={visit.id}>
            <div className={'footprints-pin ' + (joint ? 'verified' : '')}>{joint ? <UsersRound size={16} /> : <MapPin size={17} />}</div>
            <div className="footprints-visit-text">
              <small>{timeLabel(visit.arrivedAt)}{visit.leftAt ? ' ~ ' + timeLabel(visit.leftAt) : ' ~ 현재'}</small>
              <strong>{visit.placeName || (joint ? '함께 있었던 위치' : '위치 기록')}</strong>
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
      우리의 발자취는 두 사람의 GPS가 약 120m 이내에서 2분 이상 겹치고 양쪽 위치 정확도가 기준을 만족할 때만 생성해요. GPS 신호가 좋지 않은 실내에서는 실제로 함께 있어도 기록이 누락될 수 있어요.
    </p>
  </div>;
}
