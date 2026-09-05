import { CalendarDays, ChevronLeft, Clock3, Heart, MapPin, MapPinned, Navigation } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { Memory } from '../../types';
import type { LocationVisit } from '../../utils/location';

type TimelineSchedule = {
  id: string;
  title: string;
  date: string;
  startTime: string;
  location?: string;
  source?: 'date-plan';
};

type TimelineDatePlan = {
  id: number;
  title: string;
  date: string;
  time: string;
  location: string;
};

type PlaceEventKind = 'visit' | 'memory' | 'date' | 'schedule';

type PlaceEvent = {
  id: string;
  kind: PlaceEventKind;
  place: string;
  at: string;
  title: string;
  detail?: string;
  memoryId?: number;
};

type PlaceGroup = {
  name: string;
  events: PlaceEvent[];
};

function normalizePlace(value?: string) {
  return (value ?? '').trim().toLocaleLowerCase('ko-KR').replace(/[\s.,()\-_/·]+/g, '');
}

function samePlace(a?: string, b?: string) {
  const left = normalizePlace(a);
  const right = normalizePlace(b);
  if (!left || !right) return false;
  if (left === right) return true;
  const shorter = left.length <= right.length ? left : right;
  const longer = left.length > right.length ? left : right;
  return shorter.length >= 3 && longer.includes(shorter) && longer.length - shorter.length <= 5;
}

function timestamp(value: string) {
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

function shortDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10).replaceAll('-', '.');
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`;
}

function timeLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit' }).format(date);
}

function labelFor(kind: PlaceEventKind) {
  if (kind === 'visit') return '방문';
  if (kind === 'memory') return '추억';
  if (kind === 'date') return '데이트';
  return '일정';
}

function iconFor(kind: PlaceEventKind) {
  if (kind === 'visit') return <MapPin size={15} />;
  if (kind === 'memory') return <Heart size={15} />;
  if (kind === 'date') return <Navigation size={15} />;
  return <CalendarDays size={15} />;
}

export function PlaceTimeline({ memories, visits, schedules, datePlans, initialPlace, onConsumeInitialPlace, onOpenMemory, onOpenLocation }: {
  memories: Memory[];
  visits: LocationVisit[];
  schedules: TimelineSchedule[];
  datePlans: TimelineDatePlan[];
  initialPlace?: string;
  onConsumeInitialPlace?: () => void;
  onOpenMemory: (id: number) => void;
  onOpenLocation?: (place: string) => void;
}) {
  const [selectedPlace, setSelectedPlace] = useState<string>();

  const groups = useMemo(() => {
    const events: PlaceEvent[] = [];

    visits.forEach((visit) => {
      const place = visit.placeName?.trim();
      if (!place) return;
      const arrived = timeLabel(visit.arrivedAt);
      const left = visit.leftAt ? timeLabel(visit.leftAt) : '';
      events.push({
        id: `visit-${visit.id}`,
        kind: 'visit',
        place,
        at: visit.arrivedAt,
        title: `${place} 방문`,
        detail: left ? `${arrived} 도착 · ${left} 이동` : `${arrived} 도착 · 머문 기록`,
      });
    });

    memories.forEach((memory) => {
      const place = memory.location?.trim();
      if (!place) return;
      events.push({
        id: `memory-${memory.id}`,
        kind: 'memory',
        place,
        at: `${memory.date}T12:00:00`,
        title: memory.title,
        detail: memory.description || `${memory.images.length}개의 사진/영상`,
        memoryId: memory.id,
      });
    });

    datePlans.forEach((plan) => {
      const place = plan.location?.trim();
      if (!place) return;
      events.push({
        id: `date-${plan.id}`,
        kind: 'date',
        place,
        at: `${plan.date}T${plan.time || '12:00'}:00`,
        title: plan.title,
        detail: `${plan.time || '시간 미정'} 데이트 계획`,
      });
    });

    schedules.filter((schedule) => schedule.source !== 'date-plan').forEach((schedule) => {
      const place = schedule.location?.trim();
      if (!place) return;
      events.push({
        id: `schedule-${schedule.id}`,
        kind: 'schedule',
        place,
        at: `${schedule.date}T${schedule.startTime || '12:00'}:00`,
        title: schedule.title,
        detail: `${schedule.startTime || '시간 미정'} 일정`,
      });
    });

    const next: PlaceGroup[] = [];
    events.sort((a, b) => timestamp(a.at) - timestamp(b.at)).forEach((event) => {
      const group = next.find((item) => samePlace(item.name, event.place));
      if (group) {
        group.events.push(event);
        if (event.place.length > group.name.length && event.place.length - group.name.length <= 5) group.name = event.place;
      } else {
        next.push({ name: event.place, events: [event] });
      }
    });

    return next.sort((a, b) => timestamp(b.events[b.events.length - 1]?.at ?? '') - timestamp(a.events[a.events.length - 1]?.at ?? ''));
  }, [datePlans, memories, schedules, visits]);

  useEffect(() => {
    if (!initialPlace?.trim()) return;
    setSelectedPlace(initialPlace.trim());
    onConsumeInitialPlace?.();
  }, [initialPlace, onConsumeInitialPlace]);

  useEffect(() => {
    if (!selectedPlace) return;
    const handleBack = (event: Event) => {
      if (event.defaultPrevented) return;
      event.preventDefault();
      setSelectedPlace(undefined);
    };
    window.addEventListener('route-native-back', handleBack);
    return () => window.removeEventListener('route-native-back', handleBack);
  }, [selectedPlace]);

  const selected = selectedPlace ? groups.find((group) => samePlace(group.name, selectedPlace)) : undefined;
  const totalEvents = groups.reduce((sum, group) => sum + group.events.length, 0);

  if (selected) {
    const visitCount = selected.events.filter((event) => event.kind === 'visit').length;
    const memoryCount = selected.events.filter((event) => event.kind === 'memory').length;
    const dateCount = selected.events.filter((event) => event.kind === 'date').length;
    const scheduleCount = selected.events.filter((event) => event.kind === 'schedule').length;
    const first = selected.events[0];
    const latest = selected.events[selected.events.length - 1];

    return <section className="place-timeline place-timeline-detail">
      <header className="place-timeline-detail-head">
        <button type="button" className="place-timeline-back" onClick={() => setSelectedPlace(undefined)} aria-label="장소 목록으로"><ChevronLeft size={17} /></button>
        <div><small>OUR PLACE</small><h2>{selected.name}</h2><p>{first ? `${shortDate(first.at)}부터 이어진 우리 둘의 장소 기록` : '우리 둘의 장소 기록'}</p></div>
        {onOpenLocation && <button type="button" className="place-timeline-map" onClick={() => onOpenLocation(selected.name)}><MapPinned size={14} />지도</button>}
      </header>

      <div className="place-timeline-stats">
        <div><strong>{visitCount}</strong><span>방문</span></div>
        <div><strong>{memoryCount}</strong><span>추억</span></div>
        <div><strong>{dateCount}</strong><span>데이트</span></div>
        <div><strong>{scheduleCount}</strong><span>일정</span></div>
      </div>

      <div className="place-timeline-range"><Clock3 size={14} /><span><b>첫 기록 {first ? shortDate(first.at) : '-'}</b><small>최근 기록 {latest ? shortDate(latest.at) : '-'}</small></span></div>

      <ol className="place-timeline-events">
        {selected.events.map((event, index) => <li key={event.id} className={`place-timeline-event ${event.kind}`}>
          <div className="place-timeline-rail"><span>{iconFor(event.kind)}</span>{index < selected.events.length - 1 && <i />}</div>
          <div className="place-timeline-event-copy">
            <div><em>{labelFor(event.kind)}</em><time>{shortDate(event.at)}{event.kind === 'visit' ? ` · ${timeLabel(event.at)}` : ''}</time></div>
            {event.memoryId ? <button type="button" onClick={() => onOpenMemory(event.memoryId!)}>{event.title}</button> : <strong>{event.title}</strong>}
            {event.detail && <p>{event.detail}</p>}
          </div>
        </li>)}
      </ol>
    </section>;
  }

  return <section className="place-timeline">
    <header className="place-timeline-head"><div><small>OUR PLACES</small><h2>우리 둘의 장소 기록</h2><p>방문, 추억, 데이트와 일정을 장소별로 이어서 볼 수 있어요.</p></div><span><b>{groups.length}</b>곳 · {totalEvents}개 기록</span></header>

    {!groups.length ? <div className="place-timeline-empty"><MapPin size={22} /><strong>아직 연결된 장소 기록이 없어요</strong><p>위치 기록을 시작하거나 추억·데이트·일정에 장소를 입력하면 여기에 시간순으로 이어져요.</p></div> : <div className="place-timeline-grid">{groups.map((group) => {
      const first = group.events[0];
      const latest = group.events[group.events.length - 1];
      const visitsAtPlace = group.events.filter((event) => event.kind === 'visit').length;
      const memoriesAtPlace = group.events.filter((event) => event.kind === 'memory').length;
      const plansAtPlace = group.events.filter((event) => event.kind === 'date' || event.kind === 'schedule').length;
      return <button type="button" key={`${group.name}-${first?.id ?? ''}`} className="place-timeline-card" onClick={() => setSelectedPlace(group.name)}>
        <span className="place-timeline-card-icon"><MapPin size={17} /></span>
        <span className="place-timeline-card-copy"><b>{group.name}</b><small>{shortDate(first.at)} → {shortDate(latest.at)}</small><em>{visitsAtPlace}번 방문 · 추억 {memoriesAtPlace}개 · 계획 {plansAtPlace}개</em></span>
        <strong>{group.events.length}</strong>
      </button>;
    })}</div>}
  </section>;
}
