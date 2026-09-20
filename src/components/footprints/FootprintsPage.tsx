import { useEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';
import { ArrowLeft, CalendarDays, ChevronRight, Image as ImageIcon, MapPin, ShieldCheck } from 'lucide-react';
import type { Memory } from '../../types';
import { previewLegacyFootprints, suggestLegacyMemoryLinks } from '../../lib/footprintFoundation';
import { loadLocationVisits } from '../../utils/location';
import './FootprintsPage.css';

const MAP_ORIGIN = typeof window !== 'undefined' && window.location.hostname === 'danduli.web.app'
  ? 'https://danduli.web.app' : 'https://meluni-f4e00.web.app';
const MAP_URL = `${MAP_ORIGIN}/naver-map-host.html?v=12`;
const DISPLAY_DATE = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: 'long', day: 'numeric' });
const KOREAN_DATE = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' });

function dayKey(iso: string) {
  const parts = KOREAN_DATE.formatToParts(new Date(iso));
  const part = (key: string) => parts.find((item) => item.type === key)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function timeLabel(iso: string) {
  return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

type Props = {
  uid: string;
  memories: Memory[];
  initialMemoryId?: number;
  onOpenMemory: (id: number) => void;
  onBack: () => void;
  Header: ({ title }: { title?: string }) => React.ReactNode;
};

/**
 * First usable footprint screen. Existing GPS points remain PERSONAL and
 * UNREVIEWED. Joint visits, automatic confirmation, and export are deliberately
 * unavailable until their access rules and review flow have been implemented.
 */
export function FootprintsPage({ uid, memories, initialMemoryId, onOpenMemory, onBack, Header }: Props) {
  const original = useMemo(() => uid ? loadLocationVisits(uid) : [], [uid]);
  const footprints = useMemo(() => previewLegacyFootprints(uid, original), [uid, original]);
  const linked = useMemo(() => suggestLegacyMemoryLinks(footprints, memories), [footprints, memories]);
  const focusMemory = memories.find((memory) => memory.id === initialMemoryId);
  const [view, setView] = useState<'all' | 'day'>(focusMemory ? 'day' : 'all');
  const [day, setDay] = useState(focusMemory?.date ?? '');
  const [mapReady, setMapReady] = useState(false);
  const [mapFailed, setMapFailed] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);
  const days = useMemo(() => Array.from(new Set(footprints.map((visit) => dayKey(visit.arrivedAt)))).sort().reverse(), [footprints]);

  useEffect(() => {
    if (!focusMemory) return;
    setDay(focusMemory.date);
    setView('day');
  }, [focusMemory?.date, focusMemory?.id]);

  const visible = useMemo(() => view === 'all'
    ? footprints
    : footprints.filter((visit) => dayKey(visit.arrivedAt) === day), [day, footprints, view]);
  const mapVisits = useMemo(() => visible.map((visit) => ({
    id: visit.id, latitude: visit.latitude, longitude: visit.longitude, accuracy: visit.accuracy,
    placeName: visit.placeName, arrivedAt: visit.arrivedAt, leftAt: visit.leftAt,
  })), [visible]);

  useEffect(() => {
    setMapReady(false);
    setMapFailed(false);
    const timeout = window.setTimeout(() => setMapFailed(true), 12_000);
    const receive = (event: MessageEvent<{ source?: string; type?: string }>) => {
      if (event.origin !== MAP_ORIGIN || event.source !== frame.current?.contentWindow
        || event.data?.source !== 'route-map-host') return;
      if (event.data.type === 'ready') {
        window.clearTimeout(timeout);
        setMapReady(true);
      }
      if (event.data.type === 'auth-error' || event.data.type === 'sdk-error' || event.data.type === 'render-error') {
        window.clearTimeout(timeout);
        setMapFailed(true);
      }
    };
    window.addEventListener('message', receive);
    return () => { window.clearTimeout(timeout); window.removeEventListener('message', receive); };
  }, []);

  useEffect(() => {
    if (!mapReady) return;
    frame.current?.contentWindow?.postMessage({
      source: 'route-map-parent', type: 'render', visits: mapVisits,
      // "all" is pins-only: separate dates must never be connected as a route.
      mode: view === 'all' ? 'footprint-pins' : 'footprints',
    }, MAP_ORIGIN);
  }, [mapReady, mapVisits, view]);

  const shown = [...visible].reverse();
  const suggested = new Map(linked.map((item) => [item.footprintId, item.memoryIds]));

  return <div className="page footprints-page">
    <Header title="발자취" />
    <div className="footprints-heading">
      <button type="button" onClick={onBack} aria-label="이전 화면으로"><ArrowLeft size={20} /></button>
      <div><small>OUR FOOTPRINTS</small><h1>우리의 발자취 ♡</h1><p>함께한 시간을 여행별로 모아갈 공간이에요.</p></div>
    </div>
    <div className="footprints-privacy"><ShieldCheck size={19} />
      <span><b>기존 방문 기록 · 나에게만 표시</b><small>이전 GPS 위치는 아직 공동 방문으로 확정되지 않았어요. 상대방에게 자동 공개되거나 공유 발자취에 추가되지 않아요.</small></span>
    </div>
    <div className="footprints-tabs" role="tablist" aria-label="발자취 보기">
      <button type="button" role="tab" aria-selected={view === 'all'} className={view === 'all' ? 'active' : ''} onClick={() => setView('all')}>전체 지도</button>
      <button type="button" role="tab" aria-selected={view === 'day'} className={view === 'day' ? 'active' : ''} onClick={() => { if (!day) setDay(days[0] ?? ''); setView('day'); }}>날짜별 기록</button>
    </div>
    {view === 'day' && <div className="footprints-dates"><CalendarDays size={16} /><select aria-label="방문 날짜" value={day} onChange={(event) => setDay(event.target.value)}>
      {!days.includes(day) && <option value={day}>{day || '날짜 선택'}</option>}
      {days.map((value) => <option key={value} value={value}>{value}</option>)}
    </select></div>}
    <div className="footprints-workspace">
      <section className="footprints-map" aria-label="발자취 지도">
        <iframe ref={frame} title="네이버 발자취 지도" src={MAP_URL} referrerPolicy="strict-origin-when-cross-origin" onError={() => setMapFailed(true)} />
        {!mapReady && <div className="footprints-map-status" role="status">{mapFailed ? '지도를 불러오지 못했어요. 네트워크와 지도 인증을 확인해 주세요.' : '네이버 지도를 불러오는 중이에요…'}</div>}
        <div className="footprints-map-badge">{view === 'all' ? '전체 방문 핀 · 이동 경로 연결 없음' : '선택한 날짜 · 방문 지점 기준 경로'}</div>
      </section>
      <section className="footprints-list">
        <div className="footprints-list-header"><div><small>{view === 'all' ? 'ALL PLACES' : 'OUR DAY'}</small><h2>{view === 'all' ? '내 이전 방문 기록' : day ? DISPLAY_DATE.format(new Date(`${day}T12:00:00+09:00`)) : '날짜별 발자취'}</h2></div><span>{shown.length}곳</span></div>
        {!shown.length && <div className="footprints-empty"><MapPin size={26} /><strong>표시할 방문 기록이 없어요</strong><p>지금은 이전 GPS 기록만 볼 수 있어요. 새 공동 발자취는 방문 확인 기능이 준비된 후 추가할 수 있어요.</p></div>}
        {shown.map((visit) => <article className="footprints-visit" key={visit.id}>
          <div className="footprints-pin"><MapPin size={17} /></div>
          <div className="footprints-visit-text">
            <small>{dayKey(visit.arrivedAt)} · {timeLabel(visit.arrivedAt)}</small>
            <strong>{visit.placeName || '이름 없는 방문 지점'}</strong>
            <span>GPS 오차 약 {Math.round(visit.accuracy)}m · 개인 기록</span>
            {Boolean(suggested.get(visit.id)?.length) && <div className="footprints-related">
              {suggested.get(visit.id)?.map((memoryId) => {
                const memory = memories.find((item) => item.id === memoryId);
                return memory && <button type="button" key={memoryId} onClick={() => onOpenMemory(memoryId)}>
                  <ImageIcon size={14} /> {memory.title} <ChevronRight size={13} />
                </button>;
              })}
            </div>}
          </div>
        </article>)}
      </section>
    </div>
    <p className="footprints-footnote">현재는 개인 GPS 기록을 읽기 전용으로 보여줘요. 날짜별 선은 방문 지점을 연결한 것이며 실제 도로 주행 경로와 다를 수 있어요.</p>
  </div>;
}
