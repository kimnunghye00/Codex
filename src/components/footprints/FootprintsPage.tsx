import { useEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';
import {
  ArrowLeft,
  CalendarDays,
  ChevronRight,
  Download,
  Image as ImageIcon,
  MapPin,
  Navigation,
  PauseCircle,
  Play,
  ShieldCheck,
  Share2,
  Square,
  UsersRound,
  Video,
  X,
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
import { ensureLocationPermission, isNativePlatform, nativePlatform } from '../../lib/native';
import { buildFootprintVideoMemoryMoments } from '../../lib/footprintVideoMemories';
import {
  exportFootprintVideo,
  prepareFootprintVideoShare,
  shareFootprintVideo,
  sharePreparedFootprintVideo,
  type FootprintVideoOrientation,
  type PreparedFootprintVideoShare,
} from '../../lib/footprintVideoExport';
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
const MAP_URL = MAP_ORIGIN + '/naver-map-host.html?v=15';
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

function distanceLabel(meters: number) {
  if (!Number.isFinite(meters) || meters <= 0) return '0m';
  if (meters >= 10_000) return Math.round(meters / 1000) + 'km';
  if (meters >= 1000) return (meters / 1000).toFixed(1) + 'km';
  return Math.round(meters) + 'm';
}

function videoExportErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? '');
  if (message.includes('VIDEO_ROUTE_TOO_SHORT')) return '영상으로 만들 GPS 경로가 너무 짧아요.';
  if (message.includes('VIDEO_RECORDING_UNSUPPORTED') || message.includes('VIDEO_CANVAS_UNSUPPORTED')) {
    return '이 기기에서는 영상 렌더링 기능을 사용할 수 없어요.';
  }
  if (message.includes('VIDEO_FORMAT_UNSUPPORTED')) return '이 기기에서 저장 가능한 영상 형식을 찾지 못했어요.';
  if (message.includes('VIDEO_SAVE_REQUIRES_ANDROID_10')) return 'Android 10 이상에서 갤러리 영상 저장을 지원해요.';
  if (message.includes('VIDEO_SHARE_CANCELLED')) return '영상 공유를 취소했어요.';
  if (message.includes('VIDEO_SHARE')) return '영상 공유 화면을 열지 못했어요.';
  if (message.includes('VIDEO_SAVE') || message.includes('VIDEO_NATIVE_SAVE')) return '영상 파일을 저장하지 못했어요.';
  return '영상 생성 중 오류가 발생했어요. 다시 시도해 주세요.';
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
  const [videoExportOpen, setVideoExportOpen] = useState(false);
  const [videoOrientation, setVideoOrientation] = useState<FootprintVideoOrientation>('portrait');
  const [videoExportBusy, setVideoExportBusy] = useState(false);
  const [videoExportProgress, setVideoExportProgress] = useState(0);
  const [videoExportStatus, setVideoExportStatus] = useState('세로 또는 가로 형식을 선택해 주세요.');
  const [videoShareReady, setVideoShareReady] = useState(false);
  const preparedVideoShare = useRef<PreparedFootprintVideoShare | undefined>(undefined);
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
  const videoMemoryMoments = useMemo(
    () => selectedSession
      ? buildFootprintVideoMemoryMoments(selectedSessionRoutePoints, jointVisits, memories)
      : [],
    [jointVisits, memories, selectedSession, selectedSessionRoutePoints],
  );
  const videoMemoryPhotoCount = videoMemoryMoments.filter((item) => item.kind === 'photo').length;
  const videoMemoryClipCount = videoMemoryMoments.filter((item) => item.kind === 'video').length;

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
    if (!mapReady || playbackState === 'playing') return;
    frame.current?.contentWindow?.postMessage({
      source: 'route-map-parent',
      type: 'render',
      visits: mapVisits,
      mode: 'footprints',
      numbered: mapVisits.length <= 20,
      routeOnly: mapVisits.length > 20,
    }, MAP_ORIGIN);
  }, [mapReady, mapVisits, playbackState]);

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
    if (videoExportBusy) return;
    setVideoExportOpen(false);
    clearSessionSelection();
  };

  const changeScope = (nextScope: FootprintScope) => {
    if (videoExportBusy) return;
    stopPlayback();
    sessionPlaybackRequest.current = undefined;
    setSelectedSessionAnchorId(undefined);
    setVideoExportOpen(false);
    setScope(nextScope);
  };

  const changeDay = (nextDay: string) => {
    if (!nextDay || nextDay > todayKey() || videoExportBusy) return;
    stopPlayback();
    sessionPlaybackRequest.current = undefined;
    setSelectedSessionAnchorId(undefined);
    setVideoExportOpen(false);
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

  const clearPreparedVideoShare = () => {
    preparedVideoShare.current = undefined;
    setVideoShareReady(false);
  };

  const openVideoExporter = () => {
    if (!selectedSession || selectedSessionRoutePoints.length < 2) return;
    stopPlayback();
    clearPreparedVideoShare();
    setVideoExportProgress(0);
    setVideoExportStatus('세로 또는 가로 형식을 선택해 주세요.');
    setVideoExportOpen(true);
  };

  const closeVideoExporter = () => {
    if (videoExportBusy) return;
    clearPreparedVideoShare();
    setVideoExportOpen(false);
    setVideoExportProgress(0);
  };

  const changeVideoOrientation = (orientation: FootprintVideoOrientation) => {
    if (videoExportBusy || orientation === videoOrientation) return;
    clearPreparedVideoShare();
    setVideoExportProgress(0);
    setVideoExportStatus('영상 비율을 바꿨어요. 공유 영상은 다시 준비해 주세요.');
    setVideoOrientation(orientation);
  };

  const saveSelectedSessionVideo = async () => {
    if (!selectedSession || selectedSessionIndex < 0 || selectedSessionRoutePoints.length < 2 || videoExportBusy) return;
    setVideoExportBusy(true);
    setVideoExportProgress(0);
    setVideoExportStatus('영상 렌더링을 준비하고 있어요.');
    try {
      const result = await exportFootprintVideo({
        points: selectedSessionRoutePoints,
        orientation: videoOrientation,
        title: selectedDate + ' 우리 데이트',
        subtitle: '데이트 ' + (selectedSessionIndex + 1),
        durationMinutes: selectedSession.durationMinutes,
        fileBaseName: 'DANDULI-' + day + '-date-' + (selectedSessionIndex + 1) + '-' + videoOrientation,
        hideSensitiveLocations: true,
        memoryMoments: videoMemoryMoments,
        onProgress: (progress) => {
          setVideoExportProgress(progress);
          if (progress < 0.98) setVideoExportStatus('영상 만드는 중 · ' + Math.round(progress * 100) + '%');
        },
      });
      setVideoExportProgress(1);
      const privacyText = result.privacyProtected
        ? ' · 민감 위치 보호 적용' + (result.hiddenPointCount ? ' (' + result.hiddenPointCount + '개 경로점 제외)' : '')
        : '';
      const memoryText = result.includedMemoryCount
        ? ' · 추억 미디어 ' + result.includedMemoryCount + '개 포함'
        : '';
      setVideoExportStatus(result.savedTo === 'gallery'
        ? result.fileName + ' · 갤러리 Movies/DANDULI에 저장했어요.' + privacyText + memoryText
        : result.fileName + ' · 다운로드를 시작했어요.' + privacyText + memoryText);
    } catch (error) {
      setVideoExportProgress(0);
      setVideoExportStatus(videoExportErrorMessage(error));
    } finally {
      setVideoExportBusy(false);
    }
  };

  const shareSelectedSessionVideo = async () => {
    if (!selectedSession || selectedSessionIndex < 0 || selectedSessionRoutePoints.length < 2 || videoExportBusy) return;
    const title = selectedDate + ' 우리 데이트';
    const nativeAndroid = isNativePlatform() && nativePlatform() === 'android';

    if (!nativeAndroid && preparedVideoShare.current && videoShareReady) {
      setVideoExportBusy(true);
      // Web Share requires transient user activation. Invoke the share API
      // synchronously from this fresh second click, before awaiting anything.
      const sharePromise = sharePreparedFootprintVideo(preparedVideoShare.current, title);
      try {
        const result = await sharePromise;
        setVideoExportProgress(1);
        const privacyText = result.hiddenPointCount
          ? ' 민감 위치 주변 경로점 ' + result.hiddenPointCount + '개를 제외했어요.'
          : ' 시작·종료 위치 정보는 보호했어요.';
        const memoryText = result.includedMemoryCount
          ? ' 추억 미디어 ' + result.includedMemoryCount + '개도 포함됐어요.'
          : '';
        if (result.shared) {
          setVideoExportStatus('공유 화면을 열었어요.' + privacyText + memoryText);
        } else {
          setVideoExportStatus('이 브라우저는 파일 공유를 지원하지 않아 대신 영상을 다운로드했어요.' + privacyText + memoryText);
        }
      } catch (error) {
        setVideoExportStatus(videoExportErrorMessage(error));
      } finally {
        setVideoExportBusy(false);
      }
      return;
    }

    setVideoExportBusy(true);
    setVideoExportProgress(0);
    setVideoExportStatus('민감 위치를 보호한 공유 영상을 준비하고 있어요.');
    try {
      const options = {
        points: selectedSessionRoutePoints,
        orientation: videoOrientation,
        title,
        subtitle: '데이트 ' + (selectedSessionIndex + 1),
        durationMinutes: selectedSession.durationMinutes,
        fileBaseName: 'DANDULI-' + day + '-date-' + (selectedSessionIndex + 1) + '-' + videoOrientation,
        hideSensitiveLocations: true,
        memoryMoments: videoMemoryMoments,
        onProgress: (progress: number) => {
          setVideoExportProgress(progress);
          if (progress < 0.98) setVideoExportStatus('공유 영상 만드는 중 · ' + Math.round(progress * 100) + '%');
        },
      };

      if (nativeAndroid) {
        const result = await shareFootprintVideo(options);
        setVideoExportProgress(1);
        const privacyText = result.hiddenPointCount
          ? ' 민감 위치 주변 경로점 ' + result.hiddenPointCount + '개를 제외했어요.'
          : ' 시작·종료 위치 정보는 보호했어요.';
        const memoryText = result.includedMemoryCount
          ? ' 추억 미디어 ' + result.includedMemoryCount + '개도 함께 넣었어요.'
          : '';
        setVideoExportStatus(result.shared
          ? '공유 화면을 열었어요.' + privacyText + memoryText
          : '공유 영상을 갤러리에 저장했어요.' + privacyText + memoryText);
        return;
      }

      const prepared = await prepareFootprintVideoShare(options);
      preparedVideoShare.current = prepared;
      setVideoShareReady(true);
      setVideoExportProgress(1);
      const privacyText = prepared.hiddenPointCount
        ? ' 민감 위치 주변 경로점 ' + prepared.hiddenPointCount + '개를 제외했어요.'
        : ' 시작·종료 위치 정보는 보호했어요.';
      const memoryText = prepared.includedMemoryCount
        ? ' 추억 미디어 ' + prepared.includedMemoryCount + '개도 함께 넣었어요.'
        : '';
      setVideoExportStatus('공유 영상이 준비됐어요. 아래의 ‘공유 화면 열기’를 눌러 주세요.' + privacyText + memoryText);
    } catch (error) {
      setVideoExportProgress(0);
      clearPreparedVideoShare();
      setVideoExportStatus(videoExportErrorMessage(error));
    } finally {
      setVideoExportBusy(false);
    }
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
              ? '데이트 ' + (selectedSessionIndex + 1) + ' · ' + distanceLabel(selectedSession.distanceMeters) + ' · 교차검증 ' + selectedSession.verifiedPointCount + '개 지점'
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
            {selectedSession && <div className="footprints-session-toolbar-actions">
              <button type="button" className="video" onClick={openVideoExporter}>
                <Video size={12} />영상 만들기
              </button>
              <button type="button" onClick={showWholeDay}>하루 전체 보기</button>
            </div>}
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
                <small>{timeLabel(session.startedAt)} ~ {timeLabel(session.endedAt)} · 약 {session.durationMinutes}분 · {distanceLabel(session.distanceMeters)} · 검증 {session.verifiedPointCount}개</small>
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

    {videoExportOpen && selectedSession && <div
      className="footprints-video-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) closeVideoExporter();
      }}
    >
      <section className="footprints-video-dialog" role="dialog" aria-modal="true" aria-labelledby="footprints-video-title">
        <header>
          <div>
            <small>FOOTPRINT VIDEO</small>
            <h2 id="footprints-video-title">데이트 영상 만들기</h2>
            <p>{selectedDate} · 데이트 {selectedSessionIndex + 1} · {distanceLabel(selectedSession.distanceMeters)}</p>
          </div>
          <button type="button" aria-label="영상 만들기 닫기" disabled={videoExportBusy} onClick={closeVideoExporter}>
            <X size={18} />
          </button>
        </header>

        <div className="footprints-video-body">
          <div className={'footprints-video-preview ' + videoOrientation}>
            <div className="footprints-video-preview-title">우리의 발자취 ♡</div>
            <svg viewBox="0 0 100 100" role="img" aria-label="발자취 영상 레이아웃 미리보기">
              <path className="road" d="M4 77 C22 62 24 28 47 42 S72 82 96 30" />
              <path className="route" d="M12 74 C25 62 28 35 47 44 S68 73 88 38" />
              <circle className="start" cx="12" cy="74" r="3" />
              <circle className="end" cx="88" cy="38" r="3" />
            </svg>
            <div className="footprints-video-preview-duo">♡♡</div>
            <div className="footprints-video-preview-hud">
              <span>함께 이동 중</span>
              <b>{timeLabel(selectedSession.startedAt)}</b>
              <strong>{distanceLabel(selectedSession.distanceMeters)}</strong>
            </div>
          </div>

          <div className="footprints-video-controls">
            <div className="footprints-video-orientation" role="radiogroup" aria-label="영상 비율">
              <button
                type="button"
                role="radio"
                aria-checked={videoOrientation === 'portrait'}
                className={videoOrientation === 'portrait' ? 'active' : ''}
                disabled={videoExportBusy}
                onClick={() => changeVideoOrientation('portrait')}
              >
                <span className="portrait-shape" />
                <b>세로 9:16</b>
                <small>쇼츠·릴스용 · 720×1280</small>
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={videoOrientation === 'landscape'}
                className={videoOrientation === 'landscape' ? 'active' : ''}
                disabled={videoExportBusy}
                onClick={() => changeVideoOrientation('landscape')}
              >
                <span className="landscape-shape" />
                <b>가로 16:9</b>
                <small>일반 영상용 · 1280×720</small>
              </button>
            </div>

            <div className="footprints-video-summary">
              <span><b>영상 내용</b><small>GPS 교차검증 경로 · 시간 · 누적 이동거리 · 정차/재연결 · 엔딩 카드</small></span>
              <span className="memory"><b><ImageIcon size={13} />앨범 추억 자동 삽입</b><small>{videoMemoryMoments.length
                ? '같은 날짜·장소가 확인된 사진 ' + videoMemoryPhotoCount + '장'
                  + (videoMemoryClipCount ? ' · 짧은 영상 ' + videoMemoryClipCount + '개' : '')
                  + '를 도착 지점 사이에 자동으로 보여줘요. 영상 클립은 최대 약 3초, 무음으로 넣어요.'
                : '같은 날짜와 장소가 모두 일치한 앨범 미디어가 없어 이번 영상은 경로 중심으로 만들어요.'}</small></span>
              <span className="privacy"><b><ShieldCheck size={13} />민감 위치 자동 보호</b><small>저장·공유 영상은 첫·마지막 약 200m를 자동으로 제외해요. 경로가 너무 짧으면 시작·종료 장소명만 제거해 영상을 유지해요.</small></span>
              <span><b>지도 개인정보</b><small>원본 좌표 숫자와 지도 타일은 영상에 넣지 않아요. 발자취 전용 그래픽만 사용해요.</small></span>
            </div>

            {(videoExportBusy || videoExportProgress > 0) && <div className="footprints-video-progress" aria-label="영상 생성 진행률">
              <span style={{ width: Math.round(videoExportProgress * 100) + '%' }} />
            </div>}
            <p className={'footprints-video-status ' + (videoExportProgress >= 1 ? 'done' : '')}>{videoExportStatus}</p>

            <div className="footprints-video-actions">
              <button
                type="button"
                className="footprints-video-share"
                disabled={videoExportBusy}
                onClick={() => void shareSelectedSessionVideo()}
              >
                {videoExportBusy
                  ? <><Video size={16} />영상 만드는 중…</>
                  : <><Share2 size={16} />{videoShareReady ? '공유 화면 열기' : '바로 공유'}</>}
              </button>
              <button
                type="button"
                className="footprints-video-save"
                disabled={videoExportBusy}
                onClick={() => void saveSelectedSessionVideo()}
              >
                <Download size={16} />{videoExportProgress >= 1 ? '다시 저장' : '파일 저장'}
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>}

    <p className="footprints-footnote">
      우리의 장소 기록은 두 사람의 GPS가 약 120m 이내에서 2분 이상 겹칠 때만 생성해요. 원본 GPS 샘플은 서버에 각자 소유 기록으로 저장되고, 반복해서 두 GPS가 일치한 구간만 공동 경로로 계산해요. 30분 이내 잠깐 떨어졌다 다시 확인되면 같은 데이트로 묶어요.
    </p>
  </div>;
}
