import { useEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';
import { createPortal } from 'react-dom';
import { CalendarDays, ChevronDown, ChevronUp, GripVertical, Heart, MapPin, MessageCircle, Plus, Search, Trash2, X } from 'lucide-react';
import { auth } from '../../lib/firebase';
import { appendPlaceToCourse, courseTimesFromSaved, encodeCourseTimeSlot, MAX_DATE_COURSE_PLACES, placesForDateMap, validateCourseTimes, type CourseTimeSlot } from '../../lib/dateCourseDraft';
import type { RealCoupleConnection } from '../../lib/coupleConnection';
import { reverseGeocode, type LocationSearchResult } from '../../utils/location';
import {
  addDatePlace, addPlaceOpinion, deleteDateCourse, deleteDatePlace, deletePlaceOpinion,
  saveDateCourse, setPlaceLike, subscribeDateCourses, subscribeDatePlaces,
  subscribePlaceLikes, subscribePlaceOpinions, updateDatePlace,
  type DateCourse, type DatePlace, type PlaceOpinion,
} from '../../lib/dateMap';
import { insideMapBounds, searchLocationPage, validMapBounds, type MapBounds } from '../../utils/locationSearch';
import { fetchNaverDatePlaces } from '../../utils/naverLocalSearch';
import { groupSavedPlaces, placeRegion } from '../../utils/placeRegions';
import { matchesPlaceSearchIntent, parsePlaceSearchIntent } from '../../utils/placeSearchIntent.ts';
import { deduplicatePlaceResults } from '../../utils/placeSearchDedup.ts';
import { matchClickedSearchPlace } from '../../utils/dateMapClick.ts';
import { sameSearchPlace } from '../../utils/placeSearchDedup.ts';
import { addDatePlanCandidate, createDatePlanDraft, subscribeDatePlanCandidates, subscribeDatePlanDrafts, updateDatePlanDraft, deleteDatePlanCandidate } from '../../lib/datePlanDrafts';
import type { DatePlanCandidate, DatePlanDraft } from '../../lib/datePlanFoundation';
import { findPlanCandidateDuplicate } from '../../utils/datePlanCandidateMatch.ts';
import './DateMapPage.css';

type Category = DatePlace['category'];
const CATEGORIES: Category[] = ['맛집', '카페', '놀거리', '여행', '기타'];
const MAP_ORIGIN = typeof window !== 'undefined' && window.location.hostname === 'danduli.web.app'
  ? 'https://danduli.web.app' : 'https://meluni-f4e00.web.app';
const MAP_HOST = `${MAP_ORIGIN}/naver-map-host.html?v=16`;
const ALL = '전체';
// This URL is enabled only after the server has its own NAVER Search ID and secret.
const NAVER_LOCAL_SEARCH_URL = String(import.meta.env.VITE_NAVER_LOCAL_SEARCH_URL || '').trim();

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
  const [plans, setPlans] = useState<DatePlanDraft[]>([]);
  const [activePlanId, setActivePlanId] = useState('');
  const [planCandidates, setPlanCandidates] = useState<DatePlanCandidate[]>([]);
  const [selectedPlanCandidateId, setSelectedPlanCandidateId] = useState('');
  const [addingToPlan, setAddingToPlan] = useState(false);
  const [showSavedImport, setShowSavedImport] = useState(false);
  const [planMobileView, setPlanMobileView] = useState<'map' | 'list'>('list');
  const [planEditingName, setPlanEditingName] = useState(false);
  const [planEditingDate, setPlanEditingDate] = useState(false);
  const [planName, setPlanName] = useState('');
  const [planDate, setPlanDate] = useState('');
  const [tab, setTab] = useState<'search' | 'places' | 'courses'>('places');
  const [scope, setScope] = useState<'map' | 'nationwide'>('map');
  const [bounds, setBounds] = useState<MapBounds | null>(null);
  const [searchedBounds, setSearchedBounds] = useState<MapBounds | null>(null);
  const [searchedScope, setSearchedScope] = useState<'map' | 'nationwide'>('map');
  const [excludedIds, setExcludedIds] = useState<string[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [pickedIds, setPickedIds] = useState<string[]>([]);
  const [category, setCategory] = useState<string>(ALL);
  const [placeStatus, setPlaceStatus] = useState<'all' | 'unassigned' | 'in-course'>('all');
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [candidate, setCandidate] = useState<LocationSearchResult | null>(null);
  const [results, setResults] = useState<LocationSearchResult[]>([]);
  const [picking, setPicking] = useState(false);
  const [candidateName, setCandidateName] = useState('');
  const [candidateAddress, setCandidateAddress] = useState('');
  const [candidateSearch, setCandidateSearch] = useState('');
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
  const [courseDate, setCourseDate] = useState('');
  const [coursePlaceIds, setCoursePlaceIds] = useState<string[]>([]);
  const [courseTimes, setCourseTimes] = useState<Record<string, CourseTimeSlot>>({});
  const [coursePicking, setCoursePicking] = useState(false);
  const [courseEditorOpen, setCourseEditorOpen] = useState(false);
  const [addingToCourse, setAddingToCourse] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);
  const dragStopId = useRef('');
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);
  const queuedFocus = useRef<{ latitude: number; longitude: number; placeName: string; photoUrl?: string; address?: string } | null>(null);
  const panel = useRef<HTMLElement>(null);
  const candidateCard = useRef<HTMLElement>(null);
  const courseDialog = useRef<HTMLElement>(null);
  const planCandidatesRef = useRef(planCandidates);
  const searchSequence = useRef(0);
  const searchAbort = useRef<AbortController | null>(null);
  const lookupSequence = useRef(0);
  const resultsRef = useRef(results);
  const nationwideResults = useRef<{ query: string; results: LocationSearchResult[] } | null>(null);
  const regionLookup = useRef<{ key: string; expires: number; region: string } | null>(null);
  const queryRef = useRef(query);
  useEffect(() => () => {
    ++searchSequence.current;
    searchAbort.current?.abort();
  }, []);
  resultsRef.current = results;
  queryRef.current = query;
  planCandidatesRef.current = planCandidates;
  const selected = places.find((item) => item.id === selectedId);
  const course = courses.find((item) => item.id === courseId);
  const activePlan = plans.find((item) => item.id === activePlanId);
  const selectedPlanCandidate = planCandidates.find((item) => item.id === selectedPlanCandidateId);
  // A bookmarked place remains in the shared wishlist after it is added
  // to a course. A course only references its stable place ID.
  const courseUsage = useMemo(() => {
    const membership = new Map<string, number>();
    courses.forEach((item) => {
      new Set(item.placeIds).forEach((id) => membership.set(id, (membership.get(id) ?? 0) + 1));
    });
    return membership;
  }, [courses]);
  const categoryPlaces = useMemo(() => places.filter((item) => category === ALL || item.category === category), [places, category]);
  const statusCounts = useMemo(() => ({
    all: categoryPlaces.length,
    unassigned: categoryPlaces.filter((item) => !courseUsage.has(item.id)).length,
    inCourse: categoryPlaces.filter((item) => courseUsage.has(item.id)).length,
  }), [categoryPlaces, courseUsage]);
  const visible = useMemo(() => categoryPlaces.filter((item) =>
    placeStatus === 'all' || (placeStatus === 'unassigned' ? !courseUsage.has(item.id) : courseUsage.has(item.id))
  ), [categoryPlaces, courseUsage, placeStatus]);
  const regionGroups = useMemo(() => groupSavedPlaces(visible), [visible]);
  const courseRegions = useMemo(() => groupSavedPlaces(places), [places]);
  const picked = pickedIds.filter((id) => places.some((item) => item.id === id));
  const searchedRegion = parsePlaceSearchIntent(candidateSearch).regionLabel;
  const mappedPlaces = useMemo(() => tab === 'search' || (tab === 'courses' && activePlanId)
    ? [] : placesForDateMap(tab === 'courses' ? places : visible, tab, coursePlaceIds), [places, visible, tab, coursePlaceIds, activePlanId]);

  useEffect(() => {
    setPlaces([]); setCourses([]); setPlans([]); setActivePlanId(''); setPlanCandidates([]); setSelectedPlanCandidateId(''); setAddingToPlan(false); setPlanMobileView('list'); setShowSavedImport(false); setPickedIds([]); setCoursePlaceIds([]); setSelectedId(''); setCourseId(''); setCourseTimes({}); setCoursePicking(false); setCourseEditorOpen(false); setAddingToCourse(false); setShowSchedule(false); setLikes([]); setOpinions([]);
    if (!coupleId) return;
    const stopPlaces = subscribeDatePlaces(coupleId, setPlaces, (error) => setMessage(errorText(error)));
    const stopCourses = subscribeDateCourses(coupleId, setCourses, (error) => setMessage(errorText(error)));
    const stopPlans = subscribeDatePlanDrafts(coupleId, setPlans, (error) => setMessage(errorText(error)));
    return () => { stopPlaces(); stopCourses(); stopPlans(); };
  }, [coupleId]);

  useEffect(() => {
    setPlanCandidates([]); setSelectedPlanCandidateId('');
    if (!coupleId || !activePlanId) return;
    return subscribeDatePlanCandidates(coupleId, activePlanId, setPlanCandidates, (error) => setMessage(errorText(error)));
  }, [coupleId, activePlanId]);

  useEffect(() => {
    setPlanName(activePlan?.title ?? '');
    setPlanDate(activePlan?.date ?? '');
    setPlanEditingName(false); setPlanEditingDate(false);
  }, [activePlanId]);
  useEffect(() => {
    if (!planEditingName) setPlanName(activePlan?.title ?? '');
  }, [activePlan?.title, planEditingName]);
  useEffect(() => {
    if (!planEditingDate) setPlanDate(activePlan?.date ?? '');
  }, [activePlan?.date, planEditingDate]);

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
    setCourseTimes(courseTimesFromSaved(course.placeIds, course.timeSlots));
  }, [course?.id, course?.updatedAt]);

  const search = async (value: string, more = false, requestedScope = scope) => {
    const trimmed = more ? candidateSearch : value.trim();
    if (!trimmed) { setMessage('검색할 장소나 주소를 입력해 주세요.'); return; }
    const intent = parsePlaceSearchIntent(trimmed);
    // A specific branch request should not be silently restricted to an unrelated viewport.
    const activeScope = more ? searchedScope : intent.hasExplicitRegion ? 'nationwide' : requestedScope;
    const activeBounds = more ? searchedBounds : bounds;
    if (activeScope === 'map' && !activeBounds) { setMessage('지도가 준비되면 검색해 주세요. 다른 지역은 전국 검색으로 찾을 수 있어요.'); return; }
    searchAbort.current?.abort();
    const controller = new AbortController();
    searchAbort.current = controller;
    const sequence = ++searchSequence.current;
    ++lookupSequence.current;
    clearMapFocus(); setTab('search'); setSearching(true); setPicking(false); setMessage('');
    if (!more) {
      setCandidate(null); setResults([]); setHasMore(false); setExcludedIds([]);
      if (intent.hasExplicitRegion) setScope('nationwide');
      setCandidateSearch(trimmed); setSearchedBounds(activeScope === 'map' ? activeBounds : null); setSearchedScope(activeScope);
    }
    const currentBounds = activeScope === 'map' ? activeBounds! : undefined;
    const matchedSaved = places.filter((item) => matchesPlaceSearchIntent({
      latitude: item.latitude, longitude: item.longitude, placeName: item.name, address: item.address,
    }, intent) && (activeScope !== 'map' || insideMapBounds(item, activeBounds!)))
      .map((item) => ({ latitude: item.latitude, longitude: item.longitude, placeName: item.name, address: item.address }));
    const cached = activeScope === 'map' && nationwideResults.current?.query === trimmed
      ? nationwideResults.current.results.filter((item) => insideMapBounds(item, activeBounds!)) : [];

    const received: { osm: LocationSearchResult[]; naver: LocationSearchResult[] } = { osm: [], naver: [] };
    const unique = deduplicatePlaceResults;
    const combinedResults = () => unique([...matchedSaved, ...cached, ...received.naver, ...received.osm]);
    const publish = () => {
      if (sequence !== searchSequence.current) return;
      const combined = combinedResults();
      setResults((previous) => more ? unique([...previous, ...combined]) : combined);
      // Unlock the search form as soon as useful results are available.
      // The slower provider may still append additional branches afterwards.
      if (combined.length && !more) setSearching(false);
    };
    // Saved and cached results do not need an external network request.
    publish();
    try {
      const osmRequest = searchLocationPage(trimmed, {
        bounds: currentBounds, excludedIds: more ? excludedIds : [], signal: controller.signal, cache: !more,
      })
        .then((page) => {
          received.osm = page.results;
          if (sequence === searchSequence.current) {
            setExcludedIds(page.excludedIds); setHasMore(page.hasMore);
            publish();
          }
          return page;
        });
      const naverRequest = !more && NAVER_LOCAL_SEARCH_URL && auth.currentUser
        ? (async () => {
          const token = await auth.currentUser?.getIdToken();
          if (!token || controller.signal.aborted) return [] as LocationSearchResult[];
          let region = '';
          if (currentBounds && !intent.hasExplicitRegion) {
            const latitude = (currentBounds.south + currentBounds.north) / 2;
            const longitude = (currentBounds.west + currentBounds.east) / 2;
            const regionKey = latitude.toFixed(4) + ':' + longitude.toFixed(4);
            const memo = regionLookup.current;
            if (memo && memo.key === regionKey && memo.expires > Date.now()) {
              region = memo.region;
            } else {
              const address = await reverseGeocode(latitude, longitude);
              if (controller.signal.aborted) return [] as LocationSearchResult[];
              if (address) {
                const parsed = placeRegion(address);
                region = parsed.province !== '지역 미분류' ? parsed.province : '';
                if (parsed.district && parsed.district !== '시·군·구 미분류') region += ' ' + parsed.district;
                // Reverse geocoding also provides the neighbourhood. A district-wide
                // five-item API page often misses a branch in a small viewport.
                const locality = address.split('·')[0]?.trim().split(/\s+/).at(-1) ?? '';
                if (/^[가-힣]+(?:동|읍|면|리)$/.test(locality)) region += ' ' + locality;
                region = region.trim();
              }
              if (region) regionLookup.current = { key: regionKey, expires: Date.now() + 90_000, region };
            }
          }
          if (controller.signal.aborted) return [] as LocationSearchResult[];
          return fetchNaverDatePlaces(trimmed, { endpoint: NAVER_LOCAL_SEARCH_URL, token, region, bounds: currentBounds, signal: controller.signal });
        })().then((naverResults) => {
          received.naver = naverResults;
          publish();
          return naverResults;
        })
        : Promise.resolve([] as LocationSearchResult[]);
      const [osm, naver] = await Promise.allSettled([osmRequest, naverRequest]);
      if (sequence !== searchSequence.current) return;
      if (osm.status === 'rejected' && naver.status === 'rejected') throw osm.reason;
      const combined = combinedResults();
      if (activeScope === 'nationwide' && !more) nationwideResults.current = { query: trimmed, results: combined };

      if (!combined.length) setMessage(more ? '추가 검색 결과가 없어요.' : intent.hasExplicitRegion
        ? `${intent.regionLabel}와 일치하는 지점이 검색 데이터에 없어요. 다른 지역의 동명 지점은 표시하지 않았어요. 아래 버튼으로 ${intent.regionLabel} 지도에 이동해 직접 선택할 수 있어요.`
        : activeScope === 'map'
          ? '현재 검색 데이터에는 지도 안에 일치하는 장소가 없어요. 네이버 지도에 보이는 가게와 별도로 수집되는 데이터이므로 직접 위치를 선택하거나 상호명과 지역명을 함께 검색해 주세요.'
          : '정확한 검색 결과가 없어요. 지점명·지역명을 함께 입력하거나 지도에서 위치를 지정해 주세요.');

    } catch (error) {
      if (sequence === searchSequence.current) setMessage(errorText(error));
    } finally {
      if (sequence === searchSequence.current) {
        setSearching(false);
        if (searchAbort.current === controller) searchAbort.current = null;
      }
    }
  };

  const goToSearchedRegion = async () => {
    if (!searchedRegion || !mapReady) return;
    setSearching(true); setMessage('');
    try {
      // City/province geocoding locates the MAP, never invents a business marker.
      const response = await searchLocationPage(searchedRegion);
      const center = response.results[0];
      if (!center) { setMessage('지역 위치를 불러오지 못했어요. 지도를 직접 이동해 주세요.'); return; }
      clearMapFocus();
      frame.current?.contentWindow?.postMessage({
        source: 'route-map-parent', type: 'pan-to',
        latitude: center.latitude, longitude: center.longitude, zoom: 13,
      }, MAP_ORIGIN);
      setPicking(true);
      setMessage(`${searchedRegion} 중심으로 지도를 이동했어요. 정확한 지점을 확인하고 지도에서 위치를 눌러 주세요.`);
    } catch { setMessage('지역 위치를 불러오지 못했어요. 지도를 직접 이동해 주세요.'); }
    finally { setSearching(false); }
  };

  useEffect(() => {
    if (!focusPlace) return;
    setQuery(focusPlace);
    setScope('nationwide');
    void search(focusPlace, false, 'nationwide').finally(onClearFocus);
  // One-shot external navigation, not on each render.
  }, [focusPlace]);

  const mapVisits = useMemo(() => [
    ...(tab === 'courses' && activePlanId ? planCandidates.map((item) => ({
      id: 'plan-candidate-' + item.id, latitude: item.latitude, longitude: item.longitude,
      placeName: item.name, address: item.address,
      arrivedAt: '2026-01-01T00:00:00.000Z', leftAt: '2026-01-01T00:00:00.000Z',
    })) : []),
    ...mappedPlaces.map((item) => ({
      id: item.id, latitude: item.latitude, longitude: item.longitude, placeName: item.name,
      photoUrl: item.photoUrl, address: item.address,
      arrivedAt: '2026-01-01T00:00:00.000Z', leftAt: '2026-01-01T00:00:00.000Z',
    })),
    // When searching, show all returned branches (not only the first) on the map.
    ...(tab === 'search' ? results : []).map((item, index) => ({
      id: `search-${index}`, latitude: item.latitude, longitude: item.longitude, placeName: item.placeName,
      arrivedAt: '2026-01-01T00:00:00.000Z', leftAt: '2026-01-01T00:00:00.000Z',
    })),
    ...(tab === 'search' && candidate && !results.some((item) => item.latitude === candidate.latitude && item.longitude === candidate.longitude)
      ? [{ id: 'search-manual', latitude: candidate.latitude, longitude: candidate.longitude,
        placeName: candidateName || candidate.placeName, arrivedAt: '2026-01-01T00:00:00.000Z', leftAt: '2026-01-01T00:00:00.000Z' }]
      : []),
  ], [mappedPlaces, results, candidate, candidateName, tab, activePlanId, planCandidates]);
  useEffect(() => {
    const timer = window.setTimeout(() => { if (!mapReady) setMapError(true); }, 12000);
    const receive = (event: MessageEvent<{ source?: string; type?: string; id?: string; latitude?: number; longitude?: number; bounds?: MapBounds }>) => {
      if (event.origin !== MAP_ORIGIN || event.source !== frame.current?.contentWindow || event.data?.source !== 'route-map-host') return;
      if (event.data.type === 'ready') { setMapReady(true); setMapError(false); frame.current?.contentWindow?.postMessage({ source: 'route-map-parent', type: 'request-viewport' }, MAP_ORIGIN); }
      if (event.data.type === 'viewport-changed' && event.data.bounds && validMapBounds(event.data.bounds)) setBounds(event.data.bounds);
      if (event.data.type === 'saved-marker-selected' && typeof event.data.id === 'string') {
        if (event.data.id.startsWith('plan-candidate-')) {
          const chosen = planCandidatesRef.current.find((item) => item.id === event.data.id.slice('plan-candidate-'.length));
          if (chosen) { setSelectedPlanCandidateId(chosen.id); setPlanMobileView('list'); }
          panel.current?.scrollTo({ top: 0, behavior: 'smooth' });
          return;
        }
        setSelectedId(event.data.id); setTab((current) => current === 'search' ? 'places' : current);
        setCandidate(null);
        setMessage('');
        panel.current?.scrollTo({ top: 0, behavior: 'smooth' });
      }
      if (event.data.type === 'search-marker-selected' && typeof event.data.id === 'string') {
        const match = /^search-(\d+)$/.exec(event.data.id);
        const index = match ? Number(match[1]) : -1;
        const found = resultsRef.current[index];
        if (found) {
          ++lookupSequence.current;
          setCandidate(found); setCandidateName(found.placeName);
          setCandidateAddress(found.address ?? '');
          setCandidateSearch(queryRef.current.trim());
          setPicking(false); setMessage('');
          mapFocus(found);
          panel.current?.scrollTo({ top: 0, behavior: 'smooth' });
        }
      }
      if (event.data.type === 'map-point-selected' && Number.isFinite(event.data.latitude) && Number.isFinite(event.data.longitude)) {
        const latitude = Number(event.data.latitude);
        const longitude = Number(event.data.longitude);
        if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return;
        const searchName = queryRef.current.trim().slice(0, 120);
        const sequence = ++lookupSequence.current;
        const near = matchClickedSearchPlace({ latitude, longitude }, resultsRef.current);
        setPicking(false);
        if (near) {
          // An independently searched place can supply its verified name and
          // location. A base-map label cannot be read through this click event.
          setCandidate(near); setCandidateName(near.placeName);
          setCandidateAddress(near.address ?? ''); setCandidateSearch(searchName || near.placeName);
          setMessage('검색 결과의 지점을 선택했어요. 이름과 주소를 확인하고 추가해 주세요.');
          mapFocus(near);
        } else {
          setCandidate({ latitude, longitude, placeName: searchName || '선택한 위치' });
          setCandidateName(searchName); setCandidateAddress('');
          setCandidateSearch(searchName);
          setMessage('지도에서 위치를 선택했어요. 지도에 표시된 가게 이름은 자동으로 확인할 수 없으니 이름과 주소를 확인해 주세요.');
          mapFocus({ latitude, longitude, placeName: searchName || '선택한 위치' });
          void reverseGeocode(latitude, longitude).then((address) => {
            if (lookupSequence.current === sequence && address) setCandidateAddress((value) => value || address);
          });
        }
        panel.current?.scrollTo({ top: 0, behavior: 'smooth' });
      }
      if (['auth-error', 'sdk-error', 'render-error'].includes(event.data.type ?? '')) setMapError(true);
    };
    window.addEventListener('message', receive);
    return () => { window.clearTimeout(timer); window.removeEventListener('message', receive); };
  }, [mapReady]);

  useEffect(() => {
    if (!mapReady) return;
    const target = frame.current?.contentWindow;
    target?.postMessage({ source: 'route-map-parent', type: 'render', mode: 'date-plan', visits: mapVisits, keepViewport: true, connectStops: tab === 'courses' && !activePlanId, numbered: tab !== 'places' && !activePlanId }, MAP_ORIGIN);
    // If a result was selected before the iframe became ready, apply it after the initial render.
    if (queuedFocus.current && target) {
      target.postMessage({ source: 'route-map-parent', type: 'focus', showPopup: true, visit: queuedFocus.current }, MAP_ORIGIN);
      queuedFocus.current = null;
    }
  }, [mapReady, mapVisits, tab]);

  useEffect(() => {
    if (!mapReady) return;
    frame.current?.contentWindow?.postMessage({ source: 'route-map-parent', type: 'set-pick-mode', enabled: tab === 'search' }, MAP_ORIGIN);
  }, [mapReady, picking, tab]);

  useEffect(() => {
    if (tab !== 'search' || !candidate) return;
    // The confirmation form may sit below a long list of search results.
    // Bring it into view after a map tap so the add-to-course action is visible.
    const frame = window.requestAnimationFrame(() => {
      candidateCard.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [candidate, tab]);

  const chooseResult = (item: LocationSearchResult) => {
    ++lookupSequence.current;
    setCandidate(item); setCandidateName(item.placeName); setCandidateAddress(item.address ?? '');
    setCandidateSearch(query.trim()); setPicking(false); setMessage('');
    mapFocus(item);
  };

  const mapFocus = (place: { latitude: number; longitude: number; placeName: string; photoUrl?: string; address?: string }) => {
    if (!mapReady || !frame.current?.contentWindow) {
      queuedFocus.current = place;
      return;
    }
    queuedFocus.current = null;
    frame.current.contentWindow.postMessage({ source: 'route-map-parent', type: 'focus', showPopup: true,
      visit: { latitude: place.latitude, longitude: place.longitude, placeName: place.placeName, photoUrl: place.photoUrl, address: place.address } }, MAP_ORIGIN);
  };

  const clearMapFocus = () => {
    queuedFocus.current = null;
    if (mapReady) frame.current?.contentWindow?.postMessage({ source: 'route-map-parent', type: 'clear-focus' }, MAP_ORIGIN);
  };

  const submit = async (work: () => Promise<unknown>, success: string) => {
    setPending(true); setMessage('');
    try { await work(); setMessage(success); } catch (error) { setMessage(errorText(error)); }
    finally { setPending(false); }
  };

  const appendToCourse = (placeId: string) => {
    setCoursePlaceIds((ids) => appendPlaceToCourse(ids, placeId));
  };

  const createPlan = async () => {
    if (!uid || !coupleId || pending) return;
    await submit(async () => {
      const id = await createDatePlanDraft(coupleId, uid);
      setActivePlanId(id); setCourseEditorOpen(false); setShowSavedImport(false);
      setPlanMobileView('list'); setAddingToPlan(false); setTab('courses');
    }, '둘만의 데이트 초안을 만들었어요. 후보를 모아보세요.');
  };
  const addCandidateToPlan = async (input: Pick<DatePlanCandidate, 'name' | 'address' | 'latitude' | 'longitude' | 'category' | 'memo'> & { sourceSavedPlaceId?: string }) => {
    if (!activePlanId || !coupleId || !uid || pending) return;
    if (!input.name.trim() || !input.address.trim()) {
      setMessage('지점 이름과 주소를 확인한 후 후보에 담아 주세요.');
      return;
    }
    const duplicate = findPlanCandidateDuplicate(planCandidatesRef.current, input);
    if (duplicate) {
      setSelectedPlanCandidateId(duplicate.id); setTab('courses'); setPlanMobileView('list');
      setCandidate(null); setAddingToPlan(false); clearMapFocus();
      setMessage('이미 이번 데이트 후보에 있는 장소예요.');
      return;
    }
    await submit(async () => {
      const id = await addDatePlanCandidate(coupleId, activePlanId, uid, input);
      setSelectedPlanCandidateId(id);
      setPlanCandidates((current) => current.some((item) => item.id === id) ? current : [...current, {
        ...input, id, createdBy: uid,
      }]);
      setTab('courses'); setPlanMobileView('list'); setCandidate(null); setAddingToPlan(false);
      setShowSavedImport(false); clearMapFocus();
    }, '이번 데이트의 후보에 담았어요. 전체 가고 싶은 곳에는 저장되지 않아요.');
  };
  const addSelectedToPlan = () => {
    if (!candidate) return;
    void addCandidateToPlan({
      name: candidateName, address: candidateAddress,
      latitude: candidate.latitude, longitude: candidate.longitude, category: candidateCategory, memo: candidateMemo,
    });
  };
  const openPlanSearch = () => {
    if (!activePlanId) return;
    setAddingToPlan(true); setAddingToCourse(false); setCandidate(null); setPlanMobileView('map');
    clearMapFocus(); setTab('search'); setMessage('지도의 결과 핀이나 가게 위치를 눌러 이번 데이트 후보에 담아 주세요.');
  };
  const savePlanField = (field: 'title' | 'date') => {
    if (!activePlanId || !activePlan || !coupleId || pending) return;
    const changed = field === 'title' ? planName !== activePlan.title : planDate !== activePlan.date;
    if (!changed) {
      if (field === 'title') setPlanEditingName(false);
      else setPlanEditingDate(false);
      return;
    }
    const value = field === 'title' ? planName : planDate;
    void submit(() => updateDatePlanDraft(coupleId, activePlanId, { [field]: value }), '초안 정보를 저장했어요. 상대방에게도 표시돼요.');
    if (field === 'title') setPlanEditingName(false);
    else setPlanEditingDate(false);
  };

  const saveCandidate = async (addToCurrentCourse = false) => {
    if (!candidate || !uid || !coupleId || pending) return;
    if (!candidateName.trim() || !candidateAddress.trim()) {
      setMessage('선택한 지점의 이름과 주소를 확인하고 입력해 주세요.');
      return;
    }
    if (addToCurrentCourse && coursePlaceIds.length >= MAX_DATE_COURSE_PLACES) {
      setMessage('하나의 코스에는 장소를 최대 20곳까지 추가할 수 있어요.');
      return;
    }
    const duplicate = places.find((item) => item.name.trim().toLowerCase() === candidateName.trim().toLowerCase()
      && kmApprox(item, candidate) < 0.15);
    if (duplicate) {
      if (addToCurrentCourse) {
        if (coursePlaceIds.includes(duplicate.id)) {
          setMessage('이미 이 코스에 포함된 장소예요.');
          return;
        }
        appendToCourse(duplicate.id);
        if (!courseId) { const region = placeRegion(duplicate.address).province; setCourseTitle((current) => current.trim() || `${region === '지역 미분류' ? '우리의' : region} 데이트`); }
      } else {
        setSelectedId(duplicate.id);
      }
      setCandidate(null); setResults([]); clearMapFocus();
      if (addToCurrentCourse) { setTab('courses'); setCourseEditorOpen(true); setCoursePicking(true); setAddingToCourse(false); }
      else setTab('places');
      setMessage(addToCurrentCourse
        ? '기존에 저장된 장소를 코스에 추가했어요. 마지막에 코스 저장을 눌러 주세요.'
        : '이미 저장된 장소예요. 기존 장소를 선택했어요.');
      return;
    }
    // Save a shared place first, then append its stable ID to this unsaved
    // course draft. Never reset the selected course or erase earlier stops.
    await submit(async () => {
      const id = await addDatePlace(coupleId, uid, {
        name: candidateName.trim().slice(0, 120), address: candidateAddress.trim().slice(0, 240),
        latitude: candidate.latitude, longitude: candidate.longitude, category: candidateCategory, memo: candidateMemo.trim().slice(0, 1000),
      });
      if (addToCurrentCourse) {
        appendToCourse(id);
        if (!courseId) { const region = placeRegion(candidateAddress).province; setCourseTitle((current) => current.trim() || `${region === '지역 미분류' ? '우리의' : region} 데이트`); }
      }
      else setSelectedId(id);
      setCandidate(null); setResults([]); setCandidateMemo(''); clearMapFocus();
      if (addToCurrentCourse) { setTab('courses'); setCourseEditorOpen(true); setCoursePicking(true); setAddingToCourse(false); }
      else setTab('places');
    }, addToCurrentCourse
      ? '새 장소를 코스에 추가했어요. 마지막에 코스 저장을 눌러 주세요.'
      : '우리의 지도에 장소를 저장했어요.');
  };

  const resetCourseEditor = () => {
    clearMapFocus();
    setCourseId(''); setCourseTitle(''); setCourseDate(''); setCoursePlaceIds([]); setCourseTimes({});
    setCoursePicking(false); setCourseEditorOpen(false); setAddingToCourse(false); setShowSchedule(false);
  };
  const closeCourseEditor = () => {
    if ((courseTitle.trim() || coursePlaceIds.length || courseDate) &&
      !window.confirm('코스 편집을 닫을까요? 저장하지 않은 변경은 사라져요.')) return;
    resetCourseEditor();
  };
  useEffect(() => {
    if (!courseEditorOpen || tab !== 'courses') return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusTarget = courseDialog.current?.querySelector<HTMLInputElement>('input[aria-label="코스 이름"]')
      ?? courseDialog.current?.querySelector<HTMLButtonElement>('button[aria-label="코스 편집 닫기"]');
    focusTarget?.focus();
    return () => { document.body.style.overflow = previous; };
  }, [courseEditorOpen, tab]);

  const newCourse = () => {
    setActivePlanId(''); setAddingToPlan(false);
    clearMapFocus();
    setCourseId(''); setCourseTitle(''); setCourseDate(''); setCoursePlaceIds([]); setCourseTimes({});
    setCoursePicking(false); setCourseEditorOpen(true); setAddingToCourse(false); setShowSchedule(false); setTab('courses');
  };
  const chooseCourse = (item: DateCourse) => {
    setActivePlanId(''); setAddingToPlan(false);
    clearMapFocus();
    setCourseId(item.id); setCourseTitle(item.title); setCourseDate(item.date);
    setCoursePlaceIds([...item.placeIds]); setCourseTimes(courseTimesFromSaved(item.placeIds, item.timeSlots));
    setCoursePicking(false); setCourseEditorOpen(true); setAddingToCourse(false); setShowSchedule(Boolean(item.date || item.timeSlots?.some(Boolean))); setTab('courses');
  };
  const toggleCoursePlace = (item: DatePlace) => {
    if (coursePlaceIds.includes(item.id)) { removeStop(item.id); return; }
    if (coursePlaceIds.length >= MAX_DATE_COURSE_PLACES) { setMessage('하나의 코스에는 장소를 최대 20곳까지 추가할 수 있어요.'); return; }
    appendToCourse(item.id);
    if (!courseId) setCourseTitle((current) => current.trim() || `${placeRegion(item.address).province === '지역 미분류' ? '우리의' : placeRegion(item.address).province} 데이트`);
    mapFocus({ ...item, placeName: item.name });
    setMessage('');
  };
  const beginCourseSearch = () => {
    setAddingToCourse(true); setCandidate(null); setPicking(false); setTab('search');
    setMessage('검색한 장소를 선택하면 현재 코스에 추가할 수 있어요.');
  };
  const setStopTime = (id: string, field: keyof CourseTimeSlot, value: string) => {
    setCourseTimes((times) => ({
      ...times, [id]: { ...(times[id] ?? { start: '', end: '' }), [field]: value },
    }));
  };
  const removeStop = (id: string) => {
    clearMapFocus();
    setCoursePlaceIds((ids) => ids.filter((placeId) => placeId !== id));
    setCourseTimes((times) => {
      const next = { ...times };
      delete next[id];
      return next;
    });
  };
  const saveCourse = async () => {
    if (!coupleId || !uid || !courseTitle.trim() || (courseDate !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(courseDate))) {
      setMessage('데이트 코스 이름과 날짜를 확인해 주세요.'); return;
    }
    if (!coursePlaceIds.length) { setMessage('데이트 코스에 장소를 하나 이상 추가해 주세요.'); return; }
    const timeError = validateCourseTimes(coursePlaceIds, courseTimes);
    if (timeError) { setMessage(timeError); return; }
    const timeSlots = coursePlaceIds.map((id) => encodeCourseTimeSlot(courseTimes[id]));
    await submit(async () => {
      const id = await saveDateCourse(coupleId, uid, {
        title: courseTitle.trim().slice(0, 100), date: courseDate, placeIds: coursePlaceIds, timeSlots,
      }, courseId || undefined);
      setCourseId(id); setCoursePicking(false); setCourseEditorOpen(false); setAddingToCourse(false);
    }, '데이트 코스를 저장했어요. 상대방에게도 표시돼요.');
  };
  const changeOrder = (index: number, offset: number) => {
    clearMapFocus();
    setCoursePlaceIds((ids) => {
    const next = [...ids]; const target = index + offset;
    if (target < 0 || target >= next.length) return ids;
    [next[index], next[target]] = [next[target], next[index]];
    return next;
    });
  };

  const moveStopTo = (movingId: string, targetId: string) => {
    if (!movingId || movingId === targetId) return;
    setCoursePlaceIds((ids) => {
      const from = ids.indexOf(movingId), to = ids.indexOf(targetId);
      if (from < 0 || to < 0) return ids;
      const next = [...ids];
      next.splice(from, 1); next.splice(to, 0, movingId);
      return next;
    });
  };

  return <div className="page date-map-page">
    <Header title="지도" />
    <div className="date-map-heading"><div><small>OUR DATE MAP</small><h1>우리의 데이트 지도 ♡</h1><p>가고 싶은 곳을 모아두고, 함께 갈 순서로 데이트 코스를 만들어요.</p></div></div>
    <form className="date-map-search" onSubmit={(event) => { event.preventDefault(); if (tab === 'courses' && !activePlanId) setAddingToCourse(true); if (tab === 'courses' && activePlanId) setAddingToPlan(true); void search(query); }}>
      <Search size={19} aria-hidden="true"/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="가게 이름, 주소, 지역 검색" aria-label="데이트 장소 검색"/>
      <button type="submit" disabled={searching}>{searching ? '검색 중…' : '검색'}</button>
    </form>
    <div className="date-map-search-scope" aria-label="검색 범위">
      <button type="button" aria-pressed={scope === 'map'} onClick={() => setScope('map')}>현재 지도 안</button>
      <button type="button" aria-pressed={scope === 'nationwide'} onClick={() => setScope('nationwide')}>전국</button>
      <span>{scope === 'map' ? '지금 보이는 지도 안에서 찾아요' : '다른 지역도 이름으로 찾아요'}</span>
    </div>
    {message && <p className="date-map-feedback" role="status">{message}</p>}
    {!connection && <p className="date-map-connect">두 사람이 함께 사용할 장소·코스 저장은 커플 연결 후 이용할 수 있어요. 지도 검색은 먼저 사용해 볼 수 있어요.</p>}

    {tab === 'courses' && activePlanId && <div className="date-plan-mobile-switch" role="group" aria-label="데이트 계획 화면 전환">
      <button type="button" aria-pressed={planMobileView === 'map'} onClick={() => setPlanMobileView('map')}><MapPin size={15}/> 지도 보기</button>
      <button type="button" aria-pressed={planMobileView === 'list'} onClick={() => setPlanMobileView('list')}><CalendarDays size={15}/> 후보 목록</button>
    </div>}
    <div className={tab === 'courses' && activePlanId ? 'date-map-workspace date-plan-v2-workspace date-plan-mobile-' + planMobileView : 'date-map-workspace'}>
      <section className="date-map-map" aria-label="데이트 장소 지도">
        <iframe ref={frame} title="단둘이 데이트 지도" src={MAP_HOST} referrerPolicy="strict-origin-when-cross-origin" onError={() => setMapError(true)} />
        {!mapReady && <div className="date-map-loading">{mapError ? '지도를 불러오지 못했어요. 네트워크 또는 지도 인증을 확인해 주세요.' : '네이버 지도를 불러오는 중이에요…'}</div>}
        {mapReady && query.trim() && bounds && <button className="date-map-research" type="button" disabled={searching} onClick={() => { setScope('map'); void search(query, false, 'map'); }}>이 지역에서 다시 검색</button>}
        <div className="date-map-caption">📍 저장한 장소 {places.length}곳 · 방문 기록과 분리된 계획 지도</div>
      </section>
      <section className="date-map-panel" ref={panel}>
        <div className="date-map-tabs" role="tablist" aria-label="데이트 지도 보기">
          <button type="button" role="tab" aria-selected={tab === 'search'} className={tab === 'search' ? 'active' : ''} onClick={() => { clearMapFocus(); setAddingToCourse(false); setTab('search'); }}>검색 결과</button>
          <button type="button" role="tab" aria-selected={tab === 'places'} className={tab === 'places' ? 'active' : ''} onClick={() => { clearMapFocus(); setTab('places'); }}>가고 싶은 곳</button>
          <button type="button" role="tab" aria-selected={tab === 'courses'} className={tab === 'courses' ? 'active' : ''} onClick={() => { clearMapFocus(); setTab('courses'); }}>데이트 코스</button>
        </div>
        <button className="date-map-view-all" type="button" disabled={!mapReady || !mapVisits.length} onClick={() => { clearMapFocus(); frame.current?.contentWindow?.postMessage({ source: 'route-map-parent', type: 'fit-visits' }, MAP_ORIGIN); }}>{tab === 'courses' ? '코스 전체 지도에서 보기' : '목록 전체 지도에서 보기'}</button>
        {tab === 'search' && <div className="date-map-search-results">
          <div className="date-map-panel-header"><strong>검색 결과 {results.length}곳</strong><button type="button" onClick={() => { setPicking((v) => !v); setMessage(''); }} disabled={!mapReady}>{picking ? '선택 안내 닫기' : '지도에서 직접 위치 선택'}</button></div>
          {results.map((item, index) => <button key={`branch-${index}`} type="button" className={candidate === item ? 'date-map-branch active' : 'date-map-branch'} onClick={() => chooseResult(item)}>
            <span className="date-map-result-number">{index + 1}</span><span><b>{item.placeName}</b><small>{item.address || '상세 주소 정보 없음'}</small></span>
          </button>)}
          {candidateSearch && <small>{searchedRegion ? `지역 조건: ${searchedRegion} · 다른 지역 지점 제외` : searchedScope === 'map' ? '검색 당시 지도 영역' : '전국'} · “{candidateSearch}”</small>}
          {searchedRegion && !results.length && <button type="button" className="date-map-primary date-map-region-navigate" disabled={!mapReady || searching} onClick={() => void goToSearchedRegion()}>
            <MapPin size={15}/> {searchedRegion} 지도로 이동해 직접 선택
          </button>}
          {hasMore && <button type="button" className="date-map-primary" disabled={searching} onClick={() => void search(candidateSearch, true)}>{searching ? '불러오는 중…' : '검색 결과 더 보기'}</button>}
          <p className="date-map-add-hint">{NAVER_LOCAL_SEARCH_URL
            ? '네이버 지역 검색은 최대 5건씩 조회하므로 모든 지점이 포함되지는 않을 수 있어요. 지도 범위와 지점명을 함께 사용해 주세요.'
            : '현재 지도와 장소 검색은 별도 데이터예요. 네이버 지도에 보이는 모든 업체를 검색할 수 없어요. 지점은 “명륜진사갈비 삼척점”처럼 검색하고, 누락된 곳은 지도에서 직접 위치를 지정해 주세요.'}</p>
          <p className="date-map-pick-hint">지도에서 검색 결과 핀을 누르거나, 원하는 가게가 있는 위치를 직접 눌러 선택할 수 있어요. 검색 결과에 없는 가게는 상호명과 주소를 확인한 뒤 추가해 주세요.</p>
          {picking && <p className="date-map-add-hint" role="status">지도에 보이는 가게 글씨 자체에서 이름을 불러올 수는 없어요. 검색어를 입력한 뒤 해당 위치를 선택하면 편리해요.</p>}
          {!results.length && !candidate && !picking && <div className="date-map-empty date-map-empty-actions">
            <p>원하는 가게가 지도에 보이나요? 해당 위치를 눌러 이름과 주소를 확인한 다음 저장할 수 있어요.</p>
            <button type="button" className="date-map-primary" disabled={!mapReady} onClick={() => { setPicking(true); setMessage('지도에서 가게 위치를 눌러 주세요. 상호와 주소를 확인한 뒤 저장할 수 있어요.'); }}>
              <MapPin size={15}/> 지도에서 위치 선택하기
            </button>
          </div>}
        </div>}
        {tab === 'search' && candidate && <article ref={candidateCard} className="date-map-candidate" aria-label="선택한 장소 확인">
          <div className="date-map-candidate-header">
            <div><h2>선택한 장소</h2><p>{addingToPlan && activePlanId ? '이번 데이트 후보에 담아요. 전체 보관함에는 자동으로 저장되지 않아요.' : addingToCourse ? '위치를 확인하고 편집 중인 코스에 담아요.' : '가고 싶은 곳으로 보관한 뒤 언제든 코스에 담을 수 있어요.'}</p></div>
            <button type="button" className="date-map-candidate-close" aria-label="선택한 장소 닫기" onClick={() => { setCandidate(null); clearMapFocus(); }}><X size={18}/></button>
          </div>
          <div className="date-map-candidate-summary">
            <span className="date-map-candidate-pin"><MapPin size={19}/></span>
            <div className="date-map-candidate-summary-text">
              <strong>{candidateName || candidate.placeName}</strong>
              <span>{candidateAddress || '주소를 입력하거나 지도에서 위치를 확인해 주세요.'}</span>
            </div>
          </div>
          <div className="date-map-candidate-fields">
            <label className="date-map-candidate-field">선택한 지점 이름
              <input aria-label="선택한 지점 이름" value={candidateName} maxLength={120} onChange={(e) => setCandidateName(e.target.value)} placeholder="예: 이재모피자 서면점"/>
            </label>
            <label className="date-map-candidate-field">주소 또는 지점 설명
              <input aria-label="선택한 지점 주소" value={candidateAddress} maxLength={240} onChange={(e) => setCandidateAddress(e.target.value)} placeholder="지도 위치를 확인하고 주소를 입력해 주세요"/>
            </label>
          </div>
          <div className="date-map-candidate-actions">
            <label className="date-map-candidate-category"><span className="date-map-visually-hidden">장소 분류</span>
              <select aria-label="장소 분류" value={candidateCategory} onChange={(e) => setCandidateCategory(e.target.value as Category)}>{CATEGORIES.map((item) => <option key={item}>{item}</option>)}</select>
              <ChevronDown size={15} aria-hidden="true"/>
            </label>
            <button type="button" className="date-map-candidate-map-button" onClick={() => mapFocus(candidate)}><MapPin size={15}/> 지도에서 위치 확인</button>
          </div>
          <label className="date-map-candidate-field date-map-candidate-memo">함께 가고 싶은 이유나 메모 <span>(선택)</span>
            <textarea value={candidateMemo} onChange={(e) => setCandidateMemo(e.target.value)} maxLength={1000} placeholder="예: 여기서 식사하고 근처 카페에 가기"/>
          </label>
          <p className="date-map-candidate-note">검색어: {candidateSearch} · 저장하기 전에 위치가 맞는지 확인해 주세요.</p>
          {addingToPlan && activePlanId && <button className="date-map-primary date-map-candidate-submit" type="button" disabled={pending || !connection} onClick={addSelectedToPlan}><Plus size={17}/> 이번 데이트 후보에 담기</button>}
          <button className={addingToPlan && activePlanId ? 'date-map-candidate-map-button date-plan-secondary-action' : 'date-map-primary date-map-candidate-submit'} type="button" disabled={pending || !connection} onClick={() => void saveCandidate(addingToCourse)}><Plus size={17}/> {addingToCourse ? '현재 코스에 장소 추가' : '가고 싶은 곳에 저장'}</button>
        </article>}
        {tab === 'places' && <>
          <div className="date-map-panel-header"><strong>우리의 가고 싶은 곳</strong><span>총 {places.length}곳</span></div>
          <p className="date-map-add-hint">둘이 가고 싶은 장소를 함께 모으는 보관함이에요. 코스에 담아도 여기에서 사라지지 않아요.</p>
          {activePlanId && <p className="date-map-add-hint">현재 작성 중인 데이트 계획에도 장소를 가져올 수 있어요. 원본 보관함은 그대로 유지됩니다.</p>}
          <div className="date-map-status-filters" aria-label="코스 포함 여부">
            <button type="button" aria-pressed={placeStatus === 'all'} onClick={() => { clearMapFocus(); setSelectedId(''); setPlaceStatus('all'); }}>전체 {statusCounts.all}</button>
            <button type="button" aria-pressed={placeStatus === 'unassigned'} onClick={() => { clearMapFocus(); setSelectedId(''); setPlaceStatus('unassigned'); }}>코스 미배정 {statusCounts.unassigned}</button>
            <button type="button" aria-pressed={placeStatus === 'in-course'} onClick={() => { clearMapFocus(); setSelectedId(''); setPlaceStatus('in-course'); }}>코스에 포함 {statusCounts.inCourse}</button>
          </div>
          <div className="date-map-filters" aria-label="장소 종류">{[ALL,...CATEGORIES].map((item) => <button key={item} type="button" className={category === item ? 'active' : ''} onClick={() => { clearMapFocus(); setSelectedId(''); setCategory(item); }}>{item}</button>)}</div>
          <div className="date-map-panel-header"><strong>장소 목록</strong><span>{visible.length}곳</span></div>
          <p className="date-map-add-hint">장소를 누르면 지도에서 확인하고 코스에 담을 수 있어요. 왼쪽 체크박스로 여러 장소를 골라 새 코스를 만들 수도 있어요.</p>
          {picked.length > 0 && <div className="date-map-bulk-actions"><span>{picked.length}곳 선택</span><button type="button" onClick={() => {
            if ((courseId || coursePlaceIds.length || courseTitle) && !window.confirm('현재 코스 편집을 닫고 선택한 장소로 새 코스를 만들까요? 저장하지 않은 변경은 사라져요.')) return;
            const first = places.find((item) => item.id === picked[0]);
            newCourse(); setCoursePlaceIds(picked); setCoursePicking(false);
            if (first) { const region = placeRegion(first.address).province; setCourseTitle(`${region === '지역 미분류' ? '우리의' : region} 데이트`); }
            setPickedIds([]);
          }}>선택한 장소로 코스 만들기</button><button type="button" onClick={() => setPickedIds([])}>선택 해제</button></div>}
          {!visible.length && <p className="date-map-empty">{!places.length
            ? '아직 모아둔 장소가 없어요. 검색 결과에서 가고 싶은 곳에 저장해 보세요.'
            : placeStatus === 'unassigned' ? '이 조건에 코스 미배정 장소가 없어요. 모두 코스에 담았거나 다른 분류에 있어요.'
              : placeStatus === 'in-course' ? '이 조건에 코스에 담긴 장소가 없어요. 원하는 곳을 골라 코스를 만들어 보세요.'
                : '이 분류에 장소가 없어요. 다른 분류를 선택해 보세요.'}</p>}
          {regionGroups.map((region) => <details key={region.name} className="date-map-saved-region" open>
            <summary><span>{region.name}</span><small>{region.count}곳</small><ChevronDown size={16}/></summary>
            {region.districts.map((district) => <section key={district.name} className="date-map-region-group">
              <h3>{district.name} <small>{district.places.length}곳</small></h3>
              {district.places.map((item) => <div className="date-map-saved-row" key={item.id}>
                <input type="checkbox" aria-label={item.name + ' 코스로 묶기 선택'} checked={picked.includes(item.id)} disabled={!picked.includes(item.id) && picked.length >= MAX_DATE_COURSE_PLACES} onChange={(e) => setPickedIds((ids) => e.target.checked ? [...ids, item.id] : ids.filter((id) => id !== item.id))}/>
                <button type="button" className={selectedId === item.id ? 'date-map-place active' : 'date-map-place'} onClick={() => { setSelectedId(item.id); setCandidate(null); mapFocus({ ...item, placeName: item.name }); }}>
                  <span className="date-map-pin"><MapPin size={18}/></span><span><b>{item.name}</b><small>{item.category} · {item.address}</small><small className="date-map-place-status">{courseUsage.has(item.id) ? `코스 ${courseUsage.get(item.id)}개에 포함` : '코스 미배정 · 나중에 코스에 추가 가능'}</small></span><ChevronDown size={15}/>
                </button>
              </div>)}
            </section>)}
          </details>)}
          {selected && <article className="date-map-detail">
            <div className="date-map-panel-header"><strong>{selected.name}</strong><button type="button" aria-label="선택 해제" onClick={() => setSelectedId('')}><X size={16}/></button></div>
            <small>{selected.category} · {selected.address}</small>
            <p className="date-map-add-hint">{courseUsage.has(selected.id)
              ? `현재 ${courseUsage.get(selected.id)}개 코스에 담겨 있어요: ${courses.filter((item) => item.placeIds.includes(selected.id)).map((item) => item.title).join(', ')}`
              : '아직 코스에 담기지 않은 장소예요. 나중에 방문할 코스로 묶어보세요.'}</p>
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
              else if (coursePlaceIds.length >= MAX_DATE_COURSE_PLACES) setMessage('하나의 코스에는 장소를 최대 20곳까지 추가할 수 있어요.');
              else { appendToCourse(selected.id); setMessage('장소를 추가했어요. 마지막에 코스 저장을 눌러 주세요.'); }
              setCourseEditorOpen(true); setTab('courses');
            }}>{courseId || coursePlaceIds.length ? '편집 중인 코스에 담기' : '새 코스에 담기'}</button>
              {activePlanId && <button type="button" disabled={pending} onClick={() => void addCandidateToPlan({
                name: selected.name, address: selected.address, latitude: selected.latitude, longitude: selected.longitude,
                category: selected.category, memo: selected.memo, sourceSavedPlaceId: selected.id,
              })}><Plus size={14}/> 이번 데이트 후보에 가져오기</button>}
              <button type="button" className="date-map-delete" disabled={pending} onClick={() => { if (window.confirm(courseUsage.has(selected.id)
                ? `이 장소는 ${courseUsage.get(selected.id)}개 코스에서 사용 중이에요. 삭제하면 해당 코스에서 장소 정보가 사라질 수 있어요. 그래도 삭제할까요?`
                : '가고 싶은 곳에서 이 장소를 삭제할까요?')) void submit(async () => { await deleteDatePlace(coupleId, selected.id); clearMapFocus(); setSelectedId(''); }, '장소를 삭제했어요.'); }}><Trash2 size={14}/> 장소 삭제</button></div>
          </article>}
        </>}
        {tab === 'courses' && <>
          <div className="date-map-panel-header"><strong>{coursePicking ? (courseId ? '장소 더 담기' : '코스에 담을 장소') : '함께 만드는 코스'}</strong><button type="button" onClick={newCourse}><Plus size={14}/> 새 코스</button></div>
          {!coursePicking && <>
            {courses.map((item) => <button key={item.id} type="button" className={courseId === item.id ? 'date-map-course-choice active' : 'date-map-course-choice'} onClick={() => chooseCourse(item)}><CalendarDays size={17}/><span><b>{item.title}</b><small>{item.date || '날짜 미정'} · 장소 {item.placeIds.length}곳</small></span></button>)}
            {!courses.length && !coursePlaceIds.length && <p className="date-map-empty">아직 데이트 코스가 없어요. 새 코스에서 장소를 골라보세요.</p>}
          </>}
        </>}
      </section>
    </div>
    {tab === 'courses' && courseEditorOpen && createPortal(
      <div className="date-map-page date-map-course-modal-overlay">
        <section
          ref={courseDialog}
          className="date-map-course-modal"
          role="dialog"
          aria-modal="true"
          aria-label={courseId ? '데이트 코스 수정' : '새 데이트 코스'}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && !pending) { event.stopPropagation(); closeCourseEditor(); }
            if (event.key !== 'Tab') return;
            const controls = Array.from(courseDialog.current?.querySelectorAll<HTMLElement>(
              'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
            ) ?? []).filter((element) => element.getClientRects().length > 0);
            if (!controls.length) return;
            if (event.shiftKey && document.activeElement === controls[0]) {
              event.preventDefault(); controls[controls.length - 1].focus();
            } else if (!event.shiftKey && document.activeElement === controls[controls.length - 1]) {
              event.preventDefault(); controls[0].focus();
            }
          }}
        >
          <header className="date-map-course-modal-header">
            <div><small>OUR DATE PLAN</small><h2>{courseId ? '데이트 코스 수정' : '새 데이트 코스'}</h2>
              <p>장소를 골라 방문 순서와 일정을 정해 보세요.</p></div>
            <button type="button" aria-label="코스 편집 닫기" disabled={pending} onClick={closeCourseEditor}><X size={20}/></button>
          </header>
          <div className="date-map-course-modal-content">
            {coursePicking ? <div className="date-map-course-picker">
            <div className="date-map-panel-header"><strong>{courseId ? '코스에 장소 더 담기' : '코스에 담을 장소 선택'}</strong></div>
            <p className="date-map-add-hint">가고 싶은 장소를 차례로 눌러 주세요. 다시 누르면 선택이 취소돼요. 선택 순서가 지도에도 표시돼요.</p>
            <div className="date-map-picker-actions"><span><b>{coursePlaceIds.length}</b> / {MAX_DATE_COURSE_PLACES}곳 선택</span><button type="button" onClick={beginCourseSearch}><Search size={14}/> 저장하지 않은 장소 검색</button></div>
            {!courseRegions.length && <p className="date-map-empty">저장한 장소가 없어요. 검색해서 첫 번째 장소를 추가해 보세요.</p>}
            {courseRegions.map((region) => <details key={region.name} className="date-map-saved-region" open>
              <summary><span>{region.name}</span><small>{region.count}곳</small><ChevronDown size={16}/></summary>
              {region.districts.map((district) => <section key={district.name} className="date-map-region-group">
                <h3>{district.name} <small>{district.places.length}곳</small></h3>
                {district.places.map((item) => {
                  const index = coursePlaceIds.indexOf(item.id);
                  return <button key={item.id} type="button" aria-pressed={index >= 0} className={index >= 0 ? 'date-map-picker-place selected' : 'date-map-picker-place'} disabled={index < 0 && coursePlaceIds.length >= MAX_DATE_COURSE_PLACES} onClick={() => toggleCoursePlace(item)}>
                    <span className="date-map-picker-number">{index >= 0 ? index + 1 : <Plus size={15}/>}</span>
                    <span><strong>{item.name}</strong><small>{item.category} · {item.address}</small></span>
                    <span className="date-map-picker-check">{index >= 0 ? '선택됨' : '담기'}</span>
                  </button>;
                })}
              </section>)}
            </details>)}
            <div className="date-map-picker-footer">
              <button type="button" className="date-map-primary" disabled={!coursePlaceIds.length} onClick={() => { setCoursePicking(false); setMessage(''); }}>
                선택한 {coursePlaceIds.length}곳으로 {courseId ? '코스 수정하기' : '코스 만들기'}
              </button>
            </div>
          </div> : <article className="date-map-detail date-map-course-editor">
            <div className="date-map-panel-header"><strong>{courseId ? '데이트 코스 수정' : '새 데이트 코스'}</strong></div>
            <label className="date-map-label">코스 이름<input maxLength={100} placeholder="예: 강릉 주말 데이트" value={courseTitle} onChange={(e) => setCourseTitle(e.target.value)}/></label>
            <div className="date-map-panel-header"><strong>방문 순서</strong><span>{coursePlaceIds.length} / 20곳</span></div>
            <p className="date-map-add-hint">장소를 잡아 끌어 순서를 변경해요. 모바일에서는 위·아래 버튼으로 조정할 수 있어요.</p>
            <div className="date-map-course-schedule" aria-label="방문 순서">
              {coursePlaceIds.map((id, index) => {
                const place = places.find((item) => item.id === id);
                const slot = courseTimes[id] ?? { start: '', end: '' };
                const name = place?.name ?? '삭제된 장소';
                return <div className="date-map-course-stop" key={id} draggable onDragStart={(event) => { dragStopId.current = id; event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', id); }} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; }} onDrop={(event) => { event.preventDefault(); moveStopTo(dragStopId.current || event.dataTransfer.getData('text/plain'), id); dragStopId.current = ''; }} onDragEnd={() => { dragStopId.current = ''; }}>
                  <span className="date-map-stop-number" aria-label={index + 1 + '번째 장소'}>{index + 1}</span>
                  <div className="date-map-stop-place"><strong>{name}</strong><small><MapPin size={12} aria-hidden="true"/>{place?.address || '장소 정보를 확인해 주세요.'}</small></div>
                  {showSchedule && <div className="date-map-stop-times" aria-label={name + ' 방문 시간'}>
                    <label><span>시작</span><input type="time" aria-label={name + ' 시작 시간'} value={slot.start} onChange={(event) => setStopTime(id, 'start', event.target.value)}/></label>
                    <span className="date-map-time-tilde" aria-hidden="true">~</span>
                    <label><span>종료</span><input type="time" aria-label={name + ' 종료 시간'} value={slot.end} onChange={(event) => setStopTime(id, 'end', event.target.value)}/></label>
                  </div>}
                  <div className="date-map-stop-controls">
                    <span className="date-map-drag-handle" aria-hidden="true"><GripVertical size={17}/></span>
                    <button type="button" aria-label={name + ' 위로 이동'} title="위로 이동" disabled={index === 0} onClick={() => changeOrder(index, -1)}><ChevronUp size={17}/></button>
                    <button type="button" aria-label={name + ' 아래로 이동'} title="아래로 이동" disabled={index === coursePlaceIds.length - 1} onClick={() => changeOrder(index, 1)}><ChevronDown size={17}/></button>
                    <button type="button" aria-label={name + ' 코스에서 제거'} title="코스에서 제거" onClick={() => removeStop(id)}><X size={17}/></button>
                  </div>
                </div>;
              })}
              {!coursePlaceIds.length && <p className="date-map-empty">코스에 담긴 장소가 없어요. 장소 추가 버튼을 눌러 주세요.</p>}
            </div>
            <button type="button" className="date-map-course-add" onClick={() => setCoursePicking(true)}><Plus size={16}/> 장소 추가</button>
            <button type="button" className="date-map-course-schedule-toggle" aria-expanded={showSchedule} onClick={() => setShowSchedule((value) => !value)}><CalendarDays size={16}/> 일정 추가 (선택) {showSchedule ? <ChevronUp size={16}/> : <ChevronDown size={16}/>}</button>
            {showSchedule && <label className="date-map-label">데이트 날짜 (선택)<input type="date" value={courseDate} onChange={(e) => setCourseDate(e.target.value)}/></label>}
            <button type="button" className="date-map-primary" disabled={pending || !connection || !coursePlaceIds.length || !courseTitle.trim()} onClick={() => void saveCourse()}>코스 저장</button>
            {courseId && <button type="button" className="date-map-delete" disabled={pending} onClick={() => { if (window.confirm('이 데이트 코스를 삭제할까요?')) void submit(async () => { await deleteDateCourse(coupleId, courseId); resetCourseEditor(); }, '코스를 삭제했어요.'); }}><Trash2 size={14}/> 코스 삭제</button>}
          </article>}
          </div>
        </section>
      </div>, document.body,
    )}
    <p className="date-map-disclaimer">이 화면은 앞으로 갈 장소와 코스를 계획하는 공간이에요. 저장한 장소가 방문 완료로 자동 처리되지는 않으며, 기존 GPS 발자취는 홈 또는 앨범에서 확인할 수 있어요.</p>
  </div>;
}
