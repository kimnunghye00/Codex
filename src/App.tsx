import { lazy, memo, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { transitionCoupleCache } from './utils/coupleCacheIsolation';
import type { HubTabId } from './components/memories/MemoriesPage';
import { previewLegacyFootprints } from './lib/footprintFoundation';
import { loadLocationVisits } from './utils/location';
import type { MoreNavigationTarget } from './components/more/MoreServices';
import { AppHeader as SharedAppHeader } from './components/navigation/AppHeader';
import { BottomNav, type AppTab } from './components/navigation/BottomNav';
import type { RealCoupleConnection } from './lib/coupleConnection';
import type { User } from 'firebase/auth';
import type { Memory, MemoryDraft, Message } from './types';
import { loadMemories, loadMessages, saveMemories, saveMessages } from './utils/storage';
import { displayName, type UserProfile } from './utils/profile';
import {
  loadNotifications,
  makeNotification,
  markAllNotificationsRead,
  mergePartnerNotifications,
  notificationDestination,
  type NotificationDestination,
  saveNotifications,
  type AppNotification,
} from './utils/notifications';
import { subscribeCoupleActivities } from './lib/coupleActivity';
import { activityAlertEnabled, installActivityAlertClicks, openActivityFromUrl, requestActivityAlerts, showPartnerActivityAlert } from './lib/activityAlerts';
import { ChevronRight, Heart, Image, MapPin, MapPinned, Plus } from 'lucide-react';
import './home-simple.css';
import './home-dashboard.css';
import './home-couple-tools.css';
import './home-couple-layout.css';
import './home-map-overlay.css';
import './home-brand-polish-v5.css';

const FootprintsPage = lazy(() => import('./components/footprints/FootprintsPage').then((module) => ({ default: module.FootprintsPage })));

const CoupleHomeTools = lazy(() => import('./components/home/CoupleHomeTools').then((module) => ({ default: module.CoupleHomeTools })));

const ChatPage = lazy(() => Promise.all([
  import('./styles/features/chat'),
  import('./components/chat/ChatPage'),
]).then(([, module]) => ({ default: module.ChatPage })));
const MemoriesPage = lazy(() => Promise.all([
  import('./styles/features/memories'),
  import('./components/memories/MemoriesPage'),
]).then(([, module]) => ({ default: module.MemoriesPage })));
const DateMapPage = lazy(() => import('./components/location/DateMapPage').then((module) => ({ default: module.DateMapPage })));
const AccountSettings = lazy(() => Promise.all([
  import('./styles/features/settings'),
  import('./components/auth/AccountSettings'),
]).then(([, module]) => ({ default: module.AccountSettings })));
const NotificationPanel = lazy(() => Promise.all([
  import('./styles/features/notifications'),
  import('./components/notifications/NotificationPanel'),
]).then(([, module]) => ({ default: module.NotificationPanel })));
const MoreServices = lazy(() => Promise.all([
  import('./styles/features/more'),
  import('./components/more/MoreServices'),
]).then(([, module]) => ({ default: module.MoreServices })));

type Tab = AppTab | 'footprints';
type Anniversary = { id: string; icon: string; title: string; date: Date; recurring?: boolean };
type AppProps = { user: User; profile: UserProfile; onProfileChange: (profile: UserProfile) => void };

const DAY = 86_400_000;
const initialMemories: Memory[] = [];
const initialMessages: Message[] = [];

function memoryPersistedSignature(memory: Memory) {
  return JSON.stringify({
    id: memory.id,
    title: memory.title,
    date: memory.date,
    description: memory.description,
    images: memory.images,
    videos: memory.videos ?? [],
    location: memory.location ?? '',
    tags: memory.tags ?? [],
    favorite: memory.favorite ?? false,
    ownerUid: memory.ownerUid ?? '',
  });
}

function homeMemoryPreview(source?: string) {
  if (!source || source.startsWith('gs://') || source.startsWith('data:') || source.startsWith('blob:')) return '';
  const marker = '#route-original=';
  const index = source.indexOf(marker);
  return index >= 0 ? source.slice(0, index) : source;
}
const COUPLE_SPECIAL_DAYS = [
  { month: 1, day: 14, icon: '📔', title: '다이어리데이' },
  { month: 2, day: 14, icon: '💝', title: '발렌타인데이' },
  { month: 3, day: 14, icon: '🤍', title: '화이트데이' },
  { month: 4, day: 14, icon: '🍜', title: '블랙데이' },
  { month: 5, day: 14, icon: '🌹', title: '로즈데이' },
  { month: 6, day: 14, icon: '💋', title: '키스데이' },
  { month: 7, day: 14, icon: '💍', title: '실버데이' },
  { month: 8, day: 14, icon: '🌿', title: '그린데이' },
  { month: 9, day: 14, icon: '📷', title: '포토데이' },
  { month: 10, day: 14, icon: '🍷', title: '와인데이' },
  { month: 11, day: 11, icon: '🍫', title: '빼빼로데이' },
  { month: 11, day: 14, icon: '🎬', title: '무비데이' },
  { month: 12, day: 14, icon: '🤗', title: '허그데이' },
  { month: 12, day: 25, icon: '🎄', title: '크리스마스' },
] as const;

function atMidnight(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function parseDate(value?: string) {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function messageTimestamp(value?: string) {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function currentMonthSpecialDays(today = atMidnight()): Anniversary[] {
  const month = today.getMonth() + 1;
  return COUPLE_SPECIAL_DAYS
    .filter((item) => item.month === month)
    .map((item) => ({ id: `special-${item.month}-${item.day}`, icon: item.icon, title: item.title, date: new Date(today.getFullYear(), item.month - 1, item.day), recurring: true }))
    .sort((a, b) => a.date.getTime() - b.date.getTime());
}

function nextBirthday(profile: UserProfile, ownerLabel: string, today = atMidnight()): Anniversary | null {
  const birth = parseDate(profile.birthDate);
  if (!birth) return null;
  let date = new Date(today.getFullYear(), birth.getMonth(), birth.getDate());
  if (date < today) date = new Date(today.getFullYear() + 1, birth.getMonth(), birth.getDate());
  return { id: `birthday-${ownerLabel}`, icon: '🎂', title: `${displayName(profile)} 생일`, date, recurring: true };
}

function buildAnniversaries(profile: UserProfile, partnerProfile: UserProfile | null, relationshipStartDate?: string, today = atMidnight()): Anniversary[] {
  const events: Anniversary[] = [];
  const mine = nextBirthday(profile, 'me', today);
  const partner = partnerProfile ? nextBirthday(partnerProfile, 'partner', today) : null;
  if (mine) events.push(mine);
  if (partner) events.push(partner);

  const start = parseDate(relationshipStartDate);
  if (start) {
    const currentDay = Math.max(1, Math.floor((today.getTime() - start.getTime()) / DAY) + 1);
    if (currentDay < 365) {
      const nextHundred = Math.ceil(currentDay / 100) * 100;
      events.push({ id: `day-${nextHundred}`, icon: '✨', title: `우리의 ${nextHundred}일`, date: new Date(start.getTime() + (nextHundred - 1) * DAY) });
    } else {
      const nextThousand = Math.ceil(currentDay / 1000) * 1000;
      events.push({ id: `day-${nextThousand}`, icon: '✨', title: `우리의 ${nextThousand}일`, date: new Date(start.getTime() + (nextThousand - 1) * DAY) });
      let anniversaryYear = today.getFullYear() - start.getFullYear();
      let anniversaryDate = new Date(start.getFullYear() + anniversaryYear, start.getMonth(), start.getDate());
      if (anniversaryDate < today) {
        anniversaryYear += 1;
        anniversaryDate = new Date(start.getFullYear() + anniversaryYear, start.getMonth(), start.getDate());
      }
      events.push({ id: `year-${anniversaryYear}`, icon: '💞', title: `우리의 ${anniversaryYear}주년`, date: anniversaryDate, recurring: true });
    }
  }
  return events.filter((event) => event.date >= today).sort((a, b) => a.date.getTime() - b.date.getTime());
}

function daysUntil(date: Date, today = atMidnight()) {
  return Math.max(0, Math.ceil((atMidnight(date).getTime() - today.getTime()) / DAY));
}

function relativeDayLabel(date: Date, today = atMidnight()) {
  const diff = Math.round((atMidnight(date).getTime() - today.getTime()) / DAY);
  if (diff === 0) return 'D-DAY';
  return diff > 0 ? `D-${diff}` : `D+${Math.abs(diff)}`;
}

function formatDate(date: Date) {
  return `${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일`;
}

function formatShortDate(value?: string) {
  return value ? value.replaceAll('-', '.') : '기념일 설정 필요';
}

function App({ user, profile, onProfileChange }: AppProps) {
  const [connection, setConnection] = useState<RealCoupleConnection | null>(null);
  const [relationshipStartDate, setRelationshipStartDate] = useState<string>();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [alertStatus, setAlertStatus] = useState('기기 알림 받기');
  const [pendingRoute, setPendingRoute] = useState<NotificationDestination | null>(() =>
    typeof window !== 'undefined' ? openActivityFromUrl() : null);
  const [notificationMessageId, setNotificationMessageId] = useState<number>();
  const [notificationPlanId, setNotificationPlanId] = useState<string>();
  const [notifications, setNotifications] = useState<AppNotification[]>(() => loadNotifications(user.uid));
  const [tab, setTab] = useState<Tab>('home');
  const [messages, setMessages] = useState<Message[]>(() => loadMessages(initialMessages));
  const [memories, setMemories] = useState<Memory[]>(() => loadMemories(initialMemories));
  const [memoryToOpen, setMemoryToOpen] = useState<number>();
  const [memoryDraft, setMemoryDraft] = useState<MemoryDraft>();
  const [footprintMemoryId, setFootprintMemoryId] = useState<number>();
  const [locationFocus, setLocationFocus] = useState<string>();
  const [requestedHubTab, setRequestedHubTab] = useState<HubTabId>();
  const previousMessages = useRef(messages);
  const previousMemories = useRef(memories);
  const memoriesRef = useRef(memories);
  const syncedCoupleMemoriesRef = useRef<Memory[]>([]);
  const coupleMemoriesReadyRef = useRef(false);
  const chatClearAllActivityRef = useRef(false);
  const knownActivityIds = useRef<Set<string> | null>(null);
  const tabHistory = useRef<Tab[]>(['home']);
  const unreadCount = useMemo(() => notifications.filter((item) => !item.read).length, [notifications]);
  const coupleDay = useMemo(() => {
    const start = parseDate(relationshipStartDate);
    return start ? Math.max(1, Math.floor((atMidnight().getTime() - start.getTime()) / DAY) + 1) : 0;
  }, [relationshipStartDate]);
  const anniversaries = useMemo(() => buildAnniversaries(profile, connection?.partnerProfile ?? null, relationshipStartDate), [connection?.partnerProfile, profile, relationshipStartDate]);
  const openSettings = useCallback(() => setSettingsOpen(true), []);
  const navigateTab = useCallback((next: Tab) => {
    if (next === tab) return;
    tabHistory.current.push(next);
    setTab(next);
  }, [tab]);
  const navigateMoreTarget = useCallback((target: MoreNavigationTarget) => {
    if (target.area === 'chat') {
      navigateTab('chat');
      return;
    }
    if (target.area === 'memories') {
      setRequestedHubTab(target.tab);
      navigateTab('memories');
      return;
    }
    if (target.tab === 'footprints') {
      setFootprintMemoryId(undefined);
      navigateTab('footprints');
      return;
    }
    navigateTab('location');
  }, [navigateTab]);

  useEffect(() => installActivityAlertClicks(), []);
  useEffect(() => {
    void activityAlertEnabled().then((enabled) => setAlertStatus(enabled ? '기기 알림 켜짐' : '기기 알림 받기'));
  }, []);

  useEffect(() => {
    const coupleId = connection?.coupleId;
    knownActivityIds.current = null;
    if (!coupleId) return;
    return subscribeCoupleActivities(coupleId, user.uid, (events) => {
      const mapped: AppNotification[] = events.map((event) => {
        const target = notificationDestination(event.target);
        const timestamp = event.createdAt as { toDate?: () => Date } | undefined;
        return {
          id: 'cloud:' + event.id, actor: 'partner', kind: event.kind,
          title: event.title, detail: event.detail, createdAt: timestamp?.toDate?.()?.toISOString() || new Date().toISOString(),
          read: false, ...(target ? { target } : {}),
        };
      });
      const existing = knownActivityIds.current;
      knownActivityIds.current = new Set(mapped.map((item) => item.id));
      setNotifications((current) => {
        const next = mergePartnerNotifications(current, mapped);
        saveNotifications(user.uid, next);
        return next;
      });
      // Only alert for events arriving after the first historical snapshot.
      // Multiple devices may see a new activity; each device alerts only once.
      if (existing) mapped.filter((item) => !existing.has(item.id) && Date.now() - Date.parse(item.createdAt) < 90_000)
        .forEach((item) => void showPartnerActivityAlert(item));
    }, (cause) => console.warn('[DANDULI partner activity]', cause));
  }, [connection?.coupleId, user.uid]);

    const addActivity = useCallback((input: Omit<AppNotification, 'id' | 'createdAt' | 'read'>) => {
    setNotifications((items) => {
      const next = [makeNotification(input), ...items].slice(0, 200);
      saveNotifications(user.uid, next);
      return next;
    });
  }, [user.uid]);

  useEffect(() => {
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    void import('./lib/coupleConnection').then(({ subscribeRealCoupleConnection }) => {
      if (disposed) return;
      unsubscribe = subscribeRealCoupleConnection(
        user.uid,
        (next) => {
          if (disposed) return;
          if (transitionCoupleCache(user.uid, next?.coupleId ?? null)) {
            previousMessages.current = [];
            previousMemories.current = [];
            memoriesRef.current = [];
            syncedCoupleMemoriesRef.current = [];
            coupleMemoriesReadyRef.current = false;
            setMessages([]);
            setMemories([]);
            setMemoryDraft(undefined);
            setMemoryToOpen(undefined);
            setLocationFocus(undefined);
          }
          setConnection(next);
        },
        () => setConnection(null),
      );
    }).catch((cause) => {
      if (!disposed) {
        console.warn('[DANDULI couple connection lazy load]', cause);
        setConnection(null);
      }
    });
    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, [user.uid]);

  useEffect(() => {
    const coupleId = connection?.coupleId;
    if (!coupleId) {
      setRelationshipStartDate(undefined);
      return;
    }
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    void import('./lib/coupleShared').then(({ subscribeCoupleShared }) => {
      if (disposed) return;
      unsubscribe = subscribeCoupleShared(coupleId, (shared) => {
        if (!disposed) setRelationshipStartDate(shared.relationshipStartDate);
      });
    }).catch((cause) => {
      if (!disposed) console.warn('[DANDULI couple shared lazy load]', cause);
    });
    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, [connection?.coupleId]);

  useEffect(() => {
    memoriesRef.current = memories;
  }, [memories]);

  useEffect(() => {
    const coupleId = connection?.coupleId;
    coupleMemoriesReadyRef.current = false;
    syncedCoupleMemoriesRef.current = [];
    if (!coupleId) return;

    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    let migrationBusy = false;
    let migrationPhase = true;
    let firstStableSnapshot = true;

    void import('./lib/coupleMemories').then(({ subscribeCoupleMemories, migrateLocalMemoriesToCouple }) => {
      if (disposed) return;
      unsubscribe = subscribeCoupleMemories(coupleId, user.uid, (remoteMemories) => {
        if (disposed) return;

        if (migrationPhase) {
          const localMemories = memoriesRef.current;
          const remoteIds = new Set(remoteMemories.map((memory) => memory.id));
          const localOnly = localMemories.filter((memory) => !remoteIds.has(memory.id));

          if (localOnly.length) {
            const merged = [...remoteMemories, ...localOnly]
              .filter((memory, index, items) => items.findIndex((candidate) => candidate.id === memory.id) === index)
              .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
            memoriesRef.current = merged;
            setMemories(merged);

            if (!migrationBusy) {
              migrationBusy = true;
              void migrateLocalMemoriesToCouple(coupleId, user.uid, localOnly)
                .catch((cause) => console.error('[DANDULI couple memories migration]', cause))
                .finally(() => { migrationBusy = false; });
            }
            return;
          }

          migrationPhase = false;
        }

        const next = remoteMemories;
        syncedCoupleMemoriesRef.current = next;
        coupleMemoriesReadyRef.current = true;
        memoriesRef.current = next;
        if (firstStableSnapshot) {
          previousMemories.current = next;
          firstStableSnapshot = false;
        }
        setMemories(next);
      }, (cause) => {
        if (!disposed) console.error('[DANDULI couple memories subscribe]', cause);
      });
    }).catch((cause) => {
      if (!disposed) console.warn('[DANDULI couple memories lazy load]', cause);
    });

    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, [connection?.coupleId, user.uid]);

  useEffect(() => {
    const coupleId = connection?.coupleId;
    if (!coupleId || !coupleMemoriesReadyRef.current) return;

    const previous = syncedCoupleMemoriesRef.current;
    const previousById = new Map(previous.map((memory) => [memory.id, memory]));
    const currentById = new Map(memories.map((memory) => [memory.id, memory]));
    // Compare using the same canonical, persisted-only shape that actually
    // gets written to/read from Firestore (see memorySyncSignature). Comparing
    // raw Memory objects here used to flag memories as "changed" forever
    // because of fields like createdBy (locally computed, never persisted)
    // and favorite (undefined locally vs. false once round-tripped), which
    // meant both partners' devices kept re-writing the same memories back and
    // forth without ever converging - flooding Firestore with writes.
    const upserts = memories.filter((memory) => {
      const before = previousById.get(memory.id);
      return !before || memoryPersistedSignature(before) !== memoryPersistedSignature(memory);
    });
    const removed = previous.filter((memory) => !currentById.has(memory.id));

    if (!upserts.length && !removed.length) return;

    syncedCoupleMemoriesRef.current = memories;
    void import('./lib/coupleMemories').then(({ upsertCoupleMemory, deleteCoupleMemory }) => Promise.allSettled([
      ...upserts.map((memory) => upsertCoupleMemory(coupleId, user.uid, memory)),
      ...removed.map((memory) => deleteCoupleMemory(coupleId, memory.id)),
    ])).then((results) => {
      if (results.some((result) => result.status === 'rejected')) {
        console.error('[DANDULI couple memories sync] 일부 추억을 동기화하지 못했어요.', results);
        coupleMemoriesReadyRef.current = false;
      }
    }).catch((cause) => {
      console.error('[DANDULI couple memories lazy sync]', cause);
      coupleMemoriesReadyRef.current = false;
    });
  }, [connection?.coupleId, memories, user.uid]);

  useEffect(() => {
    const handleHomeRequest = () => {
      tabHistory.current = ['home'];
      setTab('home');
      setSettingsOpen(false);
      setNotificationsOpen(false);
    };
    window.addEventListener('route-home-request', handleHomeRequest);
    return () => window.removeEventListener('route-home-request', handleHomeRequest);
  }, []);

  useEffect(() => {
    const handleBack = (event: Event) => {
      if (event.defaultPrevented) return;
      if (settingsOpen) { event.preventDefault(); setSettingsOpen(false); return; }
      if (notificationsOpen) { event.preventDefault(); setNotificationsOpen(false); return; }
      if (tabHistory.current.length > 1) {
        event.preventDefault();
        tabHistory.current.pop();
        setTab(tabHistory.current[tabHistory.current.length - 1] ?? 'home');
        return;
      }
      if (tab !== 'home') { event.preventDefault(); tabHistory.current = ['home']; setTab('home'); }
    };
    window.addEventListener('route-native-back', handleBack);
    return () => window.removeEventListener('route-native-back', handleBack);
  }, [notificationsOpen, settingsOpen, tab]);

  useEffect(() => {
    const markChatClearAll = () => { chatClearAllActivityRef.current = true; };
    window.addEventListener('route-chat-cleared-all', markChatClearAll);
    return () => window.removeEventListener('route-chat-cleared-all', markChatClearAll);
  }, []);

  useEffect(() => {
    saveMessages(messages);
    const before = previousMessages.current;
    const beforeById = new Map(before.map((message) => [message.id, message]));
    const afterById = new Map(messages.map((message) => [message.id, message]));
    const newestBeforeTime = before.reduce((latest, message) => Math.max(latest, messageTimestamp(message.timestamp)), 0);
    messages
      .filter((message) => !beforeById.has(message.id) && (before.length === 0 || messageTimestamp(message.timestamp) >= newestBeforeTime))
      .forEach((message) => {
        // Connected partner events arrive via the durable shared activity log.
        if (connection?.coupleId && message.sender !== 'me') return;
        addActivity({ actor: message.sender === 'me' ? 'me' : 'partner', kind: 'chat',
          title: message.sender === 'me' ? '메시지를 보냈어요' : '새 메시지가 왔어요',
          detail: message.type === 'image' ? '사진을 보냈어요.' : message.text?.slice(0, 70),
          target: { screen: 'chat', itemId: String(message.id) } });
      });
    const removedMessages = before.filter((message) => !afterById.has(message.id));
    if (chatClearAllActivityRef.current && removedMessages.length) {
      addActivity({ actor: 'me', kind: 'chat', title: '채팅 내용을 모두 삭제했어요', detail: `${removedMessages.length}개의 메시지를 내 대화에서 삭제했어요.` });
      chatClearAllActivityRef.current = false;
    } else {
      removedMessages.forEach((message) => addActivity({ actor: 'me', kind: 'chat', title: '메시지를 삭제했어요', detail: message.text?.slice(0, 60) }));
    }
    previousMessages.current = messages;
  }, [addActivity, messages, connection?.coupleId]);

  useEffect(() => {
    const handleRemoteMemories = (event: Event) => {
      if (connection?.coupleId) return;
      const next = (event as CustomEvent<Memory[]>).detail;
      if (Array.isArray(next)) setMemories(next);
    };
    window.addEventListener('route-memories-remote-change', handleRemoteMemories);
    return () => window.removeEventListener('route-memories-remote-change', handleRemoteMemories);
  }, [connection?.coupleId]);

  useEffect(() => {
    saveMemories(memories);
    const before = previousMemories.current;
    const beforeById = new Map(before.map((memory) => [memory.id, memory]));
    const afterById = new Map(memories.map((memory) => [memory.id, memory]));
    memories.filter((memory) => !beforeById.has(memory.id)).forEach((memory) => {
      if (connection?.coupleId && memory.createdBy !== 'me') return;
      addActivity({ actor: memory.createdBy === 'me' ? 'me' : 'partner', kind: 'memory',
        title: '새 추억을 추가했어요', detail: memory.title,
        target: { screen: 'album', itemId: String(memory.id) } });
    });
    before.filter((memory) => !afterById.has(memory.id)).forEach((memory) => addActivity({ actor: 'me', kind: 'memory', title: '추억을 삭제했어요', detail: memory.title }));
    previousMemories.current = memories;
  }, [addActivity, memories, connection?.coupleId]);

  const openNotifications = useCallback(() => setNotificationsOpen(true), []);
  const readAllNotifications = useCallback(() => {
    setNotifications((items) => {
      const next = markAllNotificationsRead(items);
      saveNotifications(user.uid, next);
      return next;
    });
  }, [user.uid]);
  const clearNotifications = useCallback(() => {
    setNotifications([]);
    saveNotifications(user.uid, []);
  }, [user.uid]);
  const openMemory = useCallback((id: number) => {
    setMemoryDraft(undefined);
    setMemoryToOpen(id);
    setRequestedHubTab('album');
    navigateTab('memories');
  }, [navigateTab]);
  useEffect(() => {
    if (!pendingRoute) return;
    if (pendingRoute.screen === 'date-plan' && !connection?.coupleId) return;
    const route = pendingRoute;
    setPendingRoute(null);
    setNotificationsOpen(false);
    if (route.screen === 'chat') {
      setNotificationMessageId(Number(route.itemId));
      navigateTab('chat');
    } else if (route.screen === 'album') {
      openMemory(Number(route.itemId));
    } else {
      setNotificationPlanId(route.itemId);
      navigateTab('location');
    }
  }, [pendingRoute, connection?.coupleId, navigateTab, openMemory]);

  useEffect(() => {
    const open = (event: Event) => {
      const target = notificationDestination((event as CustomEvent<unknown>).detail);
      if (target) setPendingRoute(target);
    };
    window.addEventListener('route-notification-open', open);
    return () => window.removeEventListener('route-notification-open', open);
  }, []);

  const selectNotification = useCallback((item: AppNotification) => {
    setNotifications((items) => {
      const next = items.map((entry) => entry.id === item.id ? { ...entry, read: true } : entry);
      saveNotifications(user.uid, next);
      return next;
    });
    if (item.target) {
      setPendingRoute(item.target);
      return;
    }
    // Historical local notifications predate destination IDs. Open the
    // appropriate feature even when the exact older item is unavailable.
    setNotificationsOpen(false);
    if (item.kind === 'chat' || item.kind === 'call') navigateTab('chat');
    else if (item.kind === 'memory') { setRequestedHubTab('album'); navigateTab('memories'); }
    else if (item.kind === 'location') navigateTab('location');
    else if (item.kind === 'anniversary') navigateTab('anniversary');
    else if (item.kind === 'profile' || item.kind === 'couple') navigateTab('home');
  }, [user.uid, navigateTab]);

  const enableActivityAlerts = useCallback(() => {
    void requestActivityAlerts().then((allowed) => {
      setAlertStatus(allowed ? '기기 알림 켜짐' : '알림이 차단됨 · 설정 확인');
    });
  }, []);

    const openFootprints = (memoryId?: number) => {
    setFootprintMemoryId(memoryId);
    navigateTab('footprints');
  };
  const closeFootprints = () => {
    if (tabHistory.current.length > 1) tabHistory.current.pop();
    const prior = tabHistory.current[tabHistory.current.length - 1] ?? 'home';
    tabHistory.current = tabHistory.current.length ? tabHistory.current : ['home'];
    setTab(prior);
  };
  const saveStartDate = async (value: string) => {
    if (!connection?.coupleId) throw new Error('not-connected');
    const { saveRelationshipStartDate } = await import('./lib/coupleShared');
    await saveRelationshipStartDate(connection.coupleId, value);
    setRelationshipStartDate(value);
  };

  const AppHeader = ({ title }: { title?: string }) => <SharedAppHeader title={title} onSettings={openSettings} onNotifications={openNotifications} unreadCount={unreadCount} />;

  return <>
    <div className="app-shell"><main><Suspense fallback={<div className="page auth-loading" role="status" aria-live="polite"><div className="loading-mark" /><p>화면을 불러오는 중이에요</p></div>}>
      {tab === 'home' && <HomePage uid={user.uid} profile={profile} onProfileChange={onProfileChange} connection={connection} relationshipStartDate={relationshipStartDate} coupleDay={coupleDay} memories={memories} onNavigate={navigateTab} onOpenMemory={openMemory} onOpenFootprints={() => openFootprints()} onSettings={openSettings} onNotifications={openNotifications} unreadCount={unreadCount} />}
      {tab === 'memories' && <MemoriesPage requestedTab={requestedHubTab} Header={AppHeader} memories={memories} setMemories={setMemories} initialMemoryId={memoryToOpen} initialDraft={memoryDraft} onClearInitial={() => setMemoryToOpen(undefined)} onClearInitialDraft={() => setMemoryDraft(undefined)} onOpenLocation={(place) => { setLocationFocus(place); navigateTab('location'); }} onOpenFootprints={(memoryId) => openFootprints(memoryId)} sharedProfile={profile} sharedConnection={connection} sharedRelationshipStartDate={relationshipStartDate} />}
      {tab === 'footprints' && <FootprintsPage uid={user.uid} memories={memories} initialMemoryId={footprintMemoryId} onOpenMemory={openMemory} onBack={closeFootprints} Header={AppHeader} />}
      {tab === 'chat' && <ChatPage Header={AppHeader} messages={messages} setMessages={setMessages} connection={connection} initialMessageId={notificationMessageId}/>}
      {tab === 'location' && <DateMapPage Header={AppHeader} connection={connection} focusPlace={locationFocus} onClearFocus={() => setLocationFocus(undefined)} initialPlanId={notificationPlanId}/>}
      {tab === 'anniversary' && <AnniversaryPage connected={Boolean(connection)} relationshipStartDate={relationshipStartDate} coupleDay={coupleDay} anniversaries={anniversaries} onSaveStartDate={saveStartDate} onSettings={openSettings} onNotifications={openNotifications} unreadCount={unreadCount} />}
      {tab === 'more' && <MorePage onSettings={openSettings} onNotifications={openNotifications} unreadCount={unreadCount} onNavigate={navigateMoreTarget} />}
    </Suspense></main><BottomNav tab={tab === 'footprints' ? 'home' : tab} onNavigate={navigateTab} /></div>

    <Suspense fallback={null}>
      {settingsOpen && <AccountSettings user={user} profile={profile} onProfileChange={onProfileChange} onClose={() => setSettingsOpen(false)} />}
      {notificationsOpen && <NotificationPanel items={notifications} onClose={() => setNotificationsOpen(false)} onReadAll={readAllNotifications}
        onClear={clearNotifications} onSelect={selectNotification} onEnableAlerts={enableActivityAlerts} alertStatus={alertStatus} />}
    </Suspense>
  </>;
}

const HomePage = memo(function HomePage({ uid, profile, onProfileChange, connection, relationshipStartDate, coupleDay, memories, onNavigate, onOpenMemory, onOpenFootprints, onSettings, onNotifications, unreadCount }: { uid: string; profile: UserProfile; onProfileChange: (profile: UserProfile) => void; connection: RealCoupleConnection | null; relationshipStartDate?: string; coupleDay: number; memories: Memory[]; onNavigate: (tab: Tab) => void; onOpenMemory: (id: number) => void; onOpenFootprints: () => void; onSettings: () => void; onNotifications: () => void; unreadCount: number }) {
  const previewMemories = memories.slice(0, 4);
  const personalVisits = useMemo(() => previewLegacyFootprints(uid, loadLocationVisits(uid)), [uid]);
  const recentPlaces = personalVisits.slice(-3).reverse();

  return <div className="page home-page home-dashboard">
    <SharedAppHeader onSettings={onSettings} onNotifications={onNotifications} unreadCount={unreadCount} />

    <div className="home-dashboard-grid">
      <button className="home-map-card" type="button" aria-label="우리의 발자취 열기" onClick={onOpenFootprints}>
        <div className="home-map-grid-lines" /><span className="home-map-road road-a" /><span className="home-map-road road-b" /><span className="home-map-river" />
        {recentPlaces.map((place, index) => <span key={place.id} className={`home-map-place ${['place-office', 'place-cafe', 'place-park'][index]}`}>{place.placeName || '방문 지점'}</span>)}
        <div className="home-location-status"><MapPin size={16} /><span><b>우리의 발자취 ♡</b><small>{personalVisits.length ? `내 이전 방문 기록 ${personalVisits.length}곳 · 전체 보기` : '새로운 추억을 남길 준비 중이에요'}</small></span></div>
        <div className="home-map-person"><span className="home-map-halo" /><span className="home-map-avatar">♡</span><MapPin size={25} fill="currentColor" /></div>
        <div className="home-map-locate"><MapPinned size={20} /></div>
      </button>

      <aside className="home-dashboard-side" aria-label="홈 요약">
        <Suspense fallback={<section className="home-profile-card" aria-label="커플 정보 불러오는 중"><div className="loading-mark" /><small>커플 정보를 불러오는 중이에요</small></section>}>
          <CoupleHomeTools uid={uid} profile={profile} onProfileChange={onProfileChange} connection={connection} relationshipStartDate={relationshipStartDate} coupleDay={coupleDay} onOpenConnect={onSettings} onOpenAnniversary={() => onNavigate('anniversary')} />
        </Suspense>

        <section className="home-memory-card" aria-label="우리의 추억">
          <header className="home-memory-head">
            <span className="home-memory-title-icon" aria-hidden="true"><Image size={17} /></span>
            <span className="home-memory-title-copy"><b>우리의 추억</b><small>함께한 소중한 순간들을 모아봤어요.</small></span>
            <button type="button" onClick={() => onNavigate('memories')}>전체보기 <ChevronRight size={14} /></button>
          </header>

          {previewMemories.length ? <div className="home-memory-grid">
            {previewMemories.map((memory) => <button className="home-memory-tile" type="button" key={memory.id} onClick={() => onOpenMemory(memory.id)}>
              {homeMemoryPreview(memory.images[0]) ? <img src={homeMemoryPreview(memory.images[0])} alt={memory.title} loading="lazy" decoding="async" /> : <span className="home-memory-tile-placeholder"><Image size={20} /></span>}
              <span className="home-memory-tile-shade" />
              <span className="home-memory-tile-copy"><b>{memory.title}</b><small>{memory.date.replaceAll('-', '.')}</small></span>
            </button>)}
          </div> : <button className="home-memory-empty" type="button" onClick={() => onNavigate('memories')}><Image size={22} /><span><b>첫 추억을 남겨보세요</b><small>함께한 사진과 이야기가 여기에 보여요.</small></span></button>}
        </section>

      </aside>
    </div>
  </div>;
});

function AnniversaryPage({ connected, relationshipStartDate, coupleDay, anniversaries, onSaveStartDate, onSettings, onNotifications, unreadCount }: { connected: boolean; relationshipStartDate?: string; coupleDay: number; anniversaries: Anniversary[]; onSaveStartDate: (value: string) => Promise<void>; onSettings: () => void; onNotifications: () => void; unreadCount: number }) {
  const [date, setDate] = useState(relationshipStartDate ?? '');
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState('');
  const monthlySpecials = useMemo(() => currentMonthSpecialDays(), []);
  useEffect(() => setDate(relationshipStartDate ?? ''), [relationshipStartDate]);
  const save = async () => {
    if (!date) return setFeedback('서로 만나기 시작한 날짜를 입력해 주세요.');
    setSaving(true); setFeedback('');
    try { await onSaveStartDate(date); setFeedback('우리의 기념일을 저장했어요. 상대방 화면에도 함께 반영돼요.'); }
    catch { setFeedback('기념일 저장 중 문제가 생겼어요.'); }
    finally { setSaving(false); }
  };
  return <div className="page"><SharedAppHeader title="기념일" onSettings={onSettings} onNotifications={onNotifications} unreadCount={unreadCount} />
    <div className="title-block"><small>OUR DAYS</small><h1>함께 기다리는 날</h1><p>우리 둘의 생일과 소중한 기념일을 한곳에서 확인해요.</p></div>
    {connected && !relationshipStartDate && <div className="anniversary-card"><div className="rings"><Heart fill="currentColor" /></div><span>처음 한 번만 설정해 주세요</span><strong>우리의 시작일</strong><p>한 사람이 저장하면 두 사람에게 동일하게 적용돼요.</p><label style={{display:'grid',gap:8,marginTop:14}}>서로 만나기 시작한 날짜<input type="date" value={date} max={new Date().toISOString().slice(0,10)} onChange={(e) => setDate(e.target.value)} /></label><button className="primary" type="button" disabled={saving || !date} onClick={() => void save()}>{saving ? '저장 중...' : '기념일 저장'}</button>{feedback && <p>{feedback}</p>}</div>}
    {!connected && <div className="anniversary-card"><div className="rings"><Heart fill="currentColor" /></div><span>상대방 연결 필요</span><strong>둘만의 기념일</strong><p>설정에서 상대방 계정을 먼저 연결하면 생일과 기념일을 함께 볼 수 있어요.</p></div>}
    {relationshipStartDate && <div className="anniversary-card"><div className="rings"><Heart fill="currentColor" /></div><span>우리의 시간</span><strong>{coupleDay}번째 날</strong><p>{relationshipStartDate.replaceAll('-', '.')}부터 · D+{coupleDay}</p></div>}
    <div className="section-head upcoming"><h2>이번 달 기념일</h2></div>
    <div className="event-list">{monthlySpecials.map((event) => <button className="event" key={event.id}><div className="event-icon">{event.icon}</div><div><b>{event.title}</b><span>{formatDate(event.date)}</span></div><em>{relativeDayLabel(event.date)}</em><ChevronRight size={17} /></button>)}</div>
    <div className="section-head upcoming"><h2>우리의 다가오는 기념일</h2><button onClick={() => connected && !relationshipStartDate && void save()}><Plus size={16} />기념일</button></div>
    <div className="event-list">{anniversaries.map((event) => <button className="event" key={event.id}><div className="event-icon">{event.icon}</div><div><b>{event.title}</b><span>{formatDate(event.date)}</span></div><em>D-{daysUntil(event.date)}</em><ChevronRight size={17} /></button>)}</div>
  </div>;
}

function MorePage({ onSettings, onNotifications, unreadCount, onNavigate }: { onSettings: () => void; onNotifications: () => void; unreadCount: number; onNavigate: (target: MoreNavigationTarget) => void }) {
  return <div className="page more-page">
    <SharedAppHeader title="더보기" onSettings={onSettings} onNotifications={onNotifications} unreadCount={unreadCount} />
    <div className="more-scroll"><MoreServices onOpenSettings={onSettings} onOpenNotifications={onNotifications} onNavigate={onNavigate} /></div>
  </div>;
}

export default App;
