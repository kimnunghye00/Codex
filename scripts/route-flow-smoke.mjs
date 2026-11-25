import { existsSync, readFileSync, statSync } from 'node:fs';

const read = (path) => readFileSync(path, 'utf8');
const failures = [];
const passes = [];

function check(name, condition, detail = '') {
  if (condition) {
    passes.push(name);
    return;
  }
  failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

function includesAll(source, values) {
  return values.every((value) => source.includes(value));
}

const requiredFiles = [
  'src/App.tsx',
  'src/Root.tsx',
  'src/main.tsx',
  'src/recovery-runtime.ts',
  'src/config/releaseFlags.ts',
  'src/utils/accountIsolationPolicy.ts',
  'src/utils/coupleConnectSession.ts',
  'src/utils/messageId.ts',
  'src/lib/firebaseCore.ts',
  'src/lib/firebaseAuth.ts',
  'src/lib/firebase.ts',
  'src/lib/firestoreCacheReset.ts',
  'src/lib/footprintVideoPlan.ts',
  'src/lib/footprintVideoPrivacy.ts',
  'src/lib/footprintVideoMemories.ts',
  'src/lib/footprintVideoExport.ts',
  'src/lib/coupleConnection.ts',
  'src/components/couple/CoupleConnect.tsx',
  'src/components/home/CoupleHomeTools.tsx',
  'src/components/layout/ResponsiveAppFrame.tsx',
  'src/components/navigation/AppHeader.tsx',
  'src/components/navigation/BottomNav.tsx',
  'src/components/more/MoreServices.tsx',
  'src/components/chat/ChatPage.tsx',
  'src/components/chat/DanduliSticker.tsx',
  'src/danduli-stickers.css',
  'src/components/call/DanduliCallManager.tsx',
  'src/lib/coupleCall.ts',
  'src/components/memories/MemoriesPage.tsx',
  'src/components/memories/MemoryMedia.tsx',
  'src/components/footprints/FootprintsPage.tsx',
  'src/components/auth/AuthFlow.tsx',
  'src/components/auth/ProfileSetup.tsx',
  'src/components/auth/AccountSettings.tsx',
  'src/components/auth/PartnerProfileCard.tsx',
  'src/styles/features/chat.ts',
  'public/naver-map-host.html',
];

for (const file of requiredFiles) check(`required file: ${file}`, existsSync(file));
if (failures.length) {
  console.error('\nROUTE flow smoke gate failed before source checks:\n');
  failures.forEach((failure) => console.error(`  ✗ ${failure}`));
  process.exit(1);
}

const app = read('src/App.tsx');
const root = read('src/Root.tsx');
const main = read('src/main.tsx');
const recovery = read('src/recovery-runtime.ts');
const firebase = read('src/lib/firebase.ts');
const firebaseAuth = read('src/lib/firebaseAuth.ts');
const firestoreCacheReset = read('src/lib/firestoreCacheReset.ts');
const footprintVideoPlan = read('src/lib/footprintVideoPlan.ts');
const footprintVideoPrivacy = read('src/lib/footprintVideoPrivacy.ts');
const footprintVideoMemories = read('src/lib/footprintVideoMemories.ts');
const footprintVideoExport = read('src/lib/footprintVideoExport.ts');
const accountPolicy = read('src/utils/accountIsolationPolicy.ts');
const coupleConnection = read('src/lib/coupleConnection.ts');
const coupleConnect = read('src/components/couple/CoupleConnect.tsx');
const homeTools = read('src/components/home/CoupleHomeTools.tsx');
const coupleSession = read('src/utils/coupleConnectSession.ts');
const releaseFlags = read('src/config/releaseFlags.ts');
const callManager = read('src/components/call/DanduliCallManager.tsx');
const coupleCall = read('src/lib/coupleCall.ts');
const messageId = read('src/utils/messageId.ts');
const header = read('src/components/navigation/AppHeader.tsx');
const bottomNav = read('src/components/navigation/BottomNav.tsx');
const more = read('src/components/more/MoreServices.tsx');
const chat = read('src/components/chat/ChatPage.tsx');
const danduliSticker = read('src/components/chat/DanduliSticker.tsx');
const danduliStickerStyles = read('src/danduli-stickers.css');
const chatStyles = read('src/styles/features/chat.ts');
const memories = read('src/components/memories/MemoriesPage.tsx');
const memoryMedia = read('src/components/memories/MemoryMedia.tsx');
const location = read('src/components/footprints/FootprintsPage.tsx');
const authFlow = read('src/components/auth/AuthFlow.tsx');
const profileSetup = read('src/components/auth/ProfileSetup.tsx');
const account = read('src/components/auth/AccountSettings.tsx');
const mapHost = read('public/naver-map-host.html');
const responsiveFrame = read('src/components/layout/ResponsiveAppFrame.tsx');

check('primary navigation terminology', includesAll(bottomNav, ["'홈'", "'추억'", "'대화'", "'지도'", "'더보기'"]));
check('shared header owns notifications', header.includes('notification-button') && header.includes('onNotifications'));
check('shared header owns settings', header.includes('onSettings') && header.includes('onClick={openPageSettings}') && header.includes('{settingsLabel}</button>'));
const adaptiveWindow = read('src/adaptive-window.css');
check('shared frame delegates expanded layout to adaptive window CSS', responsiveFrame.includes('route-responsive-root') && !responsiveFrame.includes('max-w-[1320px]') && !responsiveFrame.includes('!pl-28'));
check('expanded window reserves a left navigation rail', adaptiveWindow.includes('@media (min-width:600px)') && adaptiveWindow.includes('margin:0 0 0 var(--route-rail-width)') && adaptiveWindow.includes('inset:0 auto 0 0'));
check('tablet and compact window layouts remain available', adaptiveWindow.includes('@media (min-width:900px)') && adaptiveWindow.includes('@media (max-width:599px)') && adaptiveWindow.includes('repeat(auto-fill,minmax(min(100%,200px),1fr))'));
check('desktop OS keeps horizontal navigation', responsiveFrame.includes('data-route-desktop') && adaptiveWindow.includes('[data-route-desktop="true"]') && adaptiveWindow.includes('inset:auto 0 0 0 !important') && adaptiveWindow.includes('--route-desktop-nav-height'));
check('tablet media keeps aspect ratio', adaptiveWindow.includes('object-fit:contain !important') && adaptiveWindow.includes('.detail-gallery'));
const homeAdaptive = read('src/home-adaptive.css');
check('home adaptive styles load with authenticated app instead of startup', app.includes("import './home-adaptive.css';") && !read('src/main.tsx').includes("import './home-adaptive.css';") && !adaptiveWindow.includes('container-name:home-summary'));
check('home summary preserves content-based sizing and container queries', homeAdaptive.includes('min-height:max-content !important') && homeAdaptive.includes('display:contents !important') && homeAdaptive.includes('overflow-y:auto !important') && homeAdaptive.includes('@container home-summary') && homeAdaptive.includes('.home-schedule-row:nth-child(n+2)'));
check('navigation layout has one wide-screen owner', !bottomNav.includes('lg:!flex-col') && !bottomNav.includes('lg:!left-') && adaptiveWindow.includes('flex-direction:column !important') && adaptiveWindow.includes('flex-direction:row !important'));

check('App routes home', app.includes("baseTab === 'home'"));
check('App routes memories directly', app.includes("from './components/memories/MemoriesPage'") && /<MemoriesPage\b[^>]*\brequestedTab=\{requestedHubTab\}/.test(app));
check('App enters an independent chat room without primary nav', app.includes("tab === 'chat'") && app.includes('hidden={roomOpen}') && app.includes('roomOpen ? <main className="naner-room-screen"') && app.includes('onBack={exitChatRoom}') && app.includes(': <BottomNav tab={tab}'));
check('Map tab renders footprints and has no date planning', app.includes("baseTab === 'location' && <FootprintsPage") && !app.includes('DateMapPage'));
check('App routes more', app.includes("baseTab === 'more'"));
check('native back handler remains connected', app.includes('route-native-back'));
check('App uses realtime couple subscription', app.includes('subscribeRealCoupleConnection'));

check('home schedule listener delays first cloud subscription', homeTools.includes('SCHEDULE_SUBSCRIBE_DELAY_MS') && homeTools.includes('window.setTimeout'));
check('home schedule listener pauses while app is hidden', homeTools.includes("document.addEventListener('visibilitychange'") && homeTools.includes('unsubscribe?.()'));
check('home shows legacy promises in upcoming calendar', homeTools.includes('loadLegacyPromises') && homeTools.includes('legacyPromises'));
check('home schedule creation is schedule-only', homeTools.includes("type: 'personal'") && !homeTools.includes('schedule-type-picker'));

check('couple connection exposes realtime user subscription', coupleConnection.includes('export function subscribeRealCoupleConnection') && coupleConnection.includes('onSnapshot(userRef'));
check('CoupleConnect has no interval polling', !coupleConnect.includes('setInterval('));
check('CoupleConnect consumes realtime invite snapshots', coupleConnect.includes('subscribeCoupleInviteState') && coupleConnect.includes('subscribeRealCoupleConnection'));
check('pending couple connection is restart-persisted', coupleConnect.includes('persistSession') && coupleConnect.includes('loadPersistedSession') && coupleSession.includes('route.coupleConnect.pending:'));

check('More keeps typed navigation contract', more.includes('onNavigate: (target: MoreNavigationTarget) => void'));
check('More is a customization hub', more.includes('나/너 꾸미기') && more.includes("'chat-style'") && more.includes("'store'") && more.includes("profileEditor: true") && more.includes('사진 · 배경 편집'));
check('More removes duplicate quick-settings section', !more.includes('more-quick-settings'));
check('More removes duplicated service navigation and settings', !more.includes("id: 'settings', label: '설정'") && !more.includes("id: 'date', label: '약속'") && !more.includes("id: 'footprint', label: '발자취'"));
check('More exposes theme icon emoticon customization', more.includes("openSheet('theme')") && more.includes("openSheet('app-icon')") && more.includes("openSheet('emoticon')"));
check('More uses typed navigation for linked settings', !more.includes('querySelectorAll') && more.includes("toolsSection: 'settings'") && more.includes("toolsSection: 'stickers'"));
check('profile customization opens the real photo editor', app.includes('profileEditorRequest={profileEditorRequest}') && homeTools.includes('profileEditorRequest') && homeTools.includes('backgroundPhotoDataUrl'));

check('chat has a room-specific partner header and explicit back', chat.includes('className="naner-room-header"') && chat.includes('aria-label="채팅방 나가기"') && chat.includes('{partnerName}'));
check('chat realtime subscription is present', chat.includes('subscribeCoupleMessages'));
check('chat header opens its own settings without a duplicate profile bar', chat.includes('onClick={openChatMenu}') && chat.includes('onClick={openScheduleMessage}') && !chat.includes('className="chat-profile"'));
check('memories header opens tab and anniversary settings', memories.includes('onSettings={() => setOrderOpen(true)}'));
check('map header opens footprint settings', location.includes('settingsLabel="발자취 설정"'));
check('home and more headers open page settings', app.includes('settingsLabel="홈 설정"') && app.includes('settingsLabel="더보기 설정"') && more.includes('내 프로필') && more.includes('상대방 프로필 및 연결'));
check('chat media upload path is present', chat.includes('uploadChatMedia'));
check('chat composer remains mounted', chat.includes('<ChatComposer'));
check('chat uses collision-resistant message ids', chat.includes('createMessageId') && messageId.includes('cryptoApi?.getRandomValues'));
check('voice/video call controls remain intentionally hidden', releaseFlags.includes('CALLING_ENABLED = false') && !chat.includes('aria-label="음성 통화"') && !chat.includes('aria-label="영상 통화"'));
check('call manager stays unmounted while calling is paused', !app.includes('<DanduliCallManager') && callManager.includes('subscribeCoupleCall'));
check('call signaling is couple-scoped', coupleCall.includes("doc(db, 'couples', coupleId)") && coupleCall.includes('activeCall'));
check('chat room CSS is feature-loaded only', chatStyles.includes('route-chat-room-v26.css') && !app.includes("import './route-chat-room-v26.css'"));
const stickerPackIds = ['daily-cat', 'daily-bunny', 'military-cat', 'military-bunny'];
const stickerAssetPaths = stickerPackIds.flatMap((pack) =>
  Array.from({ length: 16 }, (_, index) => `public/stickers/${pack}/${String(index + 1).padStart(2, '0')}.webp`));
check('all 64 individual sticker assets are nonempty WebP files', stickerAssetPaths.every((path) => {
  if (!existsSync(path) || statSync(path).size < 20) return false;
  const signature = readFileSync(path).subarray(0, 12);
  return signature.toString('ascii', 0, 4) === 'RIFF' && signature.toString('ascii', 8, 12) === 'WEBP';
}));
check('four portrait packs use stable IDs and individual asset paths',
  stickerPackIds.every((id) => danduliSticker.includes(`makePack('${id}'`))
  && danduliSticker.includes('image: `/stickers/${id}/${String(index + 1).padStart(2, \'0\')}.webp`'));
check('portrait stickers render transparent full images without crop',
  danduliSticker.includes('className="danduli-sticker-asset-image"')
  && danduliSticker.includes('src={item.image}')
  && danduliStickerStyles.includes('object-fit: contain')
  && danduliStickerStyles.includes('overflow: visible')
  && !danduliStickerStyles.includes('clip-path: inset('));
check('legacy square sticker pack keeps direct sprite rendering',
  danduliSticker.includes("item.image ? undefined : { backgroundPosition:")
  && danduliStickerStyles.includes("background-image: url('/danduli-stickers-v3-clean.webp')"));

check('memories exposes album tab', memories.includes("album: '앨범'"));
check('memories exposes anniversary tab', memories.includes("anniversary: '기념일'"));
check('memories exposes schedule tab', memories.includes("schedule: '일정'"));
check('memories exposes promise tab label', memories.includes("date: '약속'"));
check('memories separates schedule rows from promises', memories.includes('scheduleItems') && memories.includes('promiseScheduleExtras'));
check('memories schedule form has no type selector', !memories.includes('<select value={scheduleForm.type}') && memories.includes("type: 'personal' as const"));
check('memories promise form saves couple type', memories.includes("type: 'couple' as const") && memories.includes('약속 저장'));
check('memory media attempts durable legacy recovery', memoryMedia.includes('backupMedia/memories-live') && memoryMedia.includes('persistRecoveredUrl'));

check('map preserves memory-linked footprint focus', location.includes('initialMemoryId?: number'));
check('location screen title is 지도', location.includes('<Header title="지도"'));
check('map shows partner GPS', location.includes("'partner'"));
check('map shows verified joint GPS', location.includes('buildJointFootprints'));
check('Naver map host remains configured', location.includes('meluni-f4e00.web.app'));
check('map route uses exact shared LatLng path', mapHost.includes('path: points') && mapHost.includes('position: points[index]'));
check('map route follows active theme', mapHost.includes("--route-accent") && mapHost.includes('strokeColor: palette.accent'));
check('footprint replay uses adaptive timeline instead of fixed segment timing',
  mapHost.includes('buildPlaybackTimeline')
  && mapHost.includes('PLAYBACK_CONTINUOUS_GAP_MS')
  && !mapHost.includes('const duration = 900;'));
check('footprint replay exposes cinematic HUD', mapHost.includes('playback-hud') && mapHost.includes('playback-clock') && mapHost.includes('playback-distance'));
check('footprint replay does not draw unverified reconnect jumps',
  mapHost.includes("segment.kind === 'reconnect'") && mapHost.includes('createPlaybackLine'));
check('footprint replay inline script parses',
  (() => {
    const inlineScript = mapHost.match(/<script>\s*([\s\S]*?)<\/script>/)?.[1];
    if (!inlineScript) return false;
    try { new Function(inlineScript); return true; } catch { return false; }
  })());
check('live footprint updates wait until replay ends',
  read('src/components/footprints/FootprintsPage.tsx').includes("if (!mapReady || playbackState === 'playing') return;"));
check('footprint video plan separates reconnects from verified travel',
  footprintVideoPlan.includes("kind: FootprintVideoSegmentKind")
  && footprintVideoPlan.includes("kind === 'move'")
  && footprintVideoPlan.includes("kind === 'reconnect'"));
check('footprint video export supports portrait and landscape 720p',
  footprintVideoExport.includes("orientation === 'portrait'")
  && footprintVideoExport.includes('{ width: 720, height: 1280 }')
  && footprintVideoExport.includes('{ width: 1280, height: 720 }'));
check('footprint video export prefers mp4 and falls back to webm',
  footprintVideoExport.includes("'video/mp4'")
  && footprintVideoExport.includes("'video/webm;codecs=vp9'"));
check('footprint video export saves Android output through RouteMediaSaver',
  footprintVideoExport.includes("registerPlugin<RouteMediaSaverPlugin>('RouteMediaSaver')")
  && footprintVideoExport.includes('RouteMediaSaver.saveVideo'));
check('footprint video exports automatically protect sensitive endpoints',
  footprintVideoPrivacy.includes('FOOTPRINT_VIDEO_PRIVACY_RADIUS_METERS = 200')
  && footprintVideoExport.includes('protectFootprintVideoRoute')
  && footprintVideoExport.includes('options.hideSensitiveLocations !== false'));
check('footprint video share supports native chooser and web file share fallback',
  footprintVideoExport.includes('RouteMediaSaver.shareVideo')
  && footprintVideoExport.includes('navigator.share')
  && footprintVideoExport.includes('navigator.canShare')
  && footprintVideoExport.includes('downloadWebVideo'));
check('web footprint sharing is staged behind a fresh second user gesture',
  footprintVideoExport.includes('prepareFootprintVideoShare')
  && footprintVideoExport.includes('sharePreparedFootprintVideo')
  && read('src/components/footprints/FootprintsPage.tsx').includes('preparedVideoShare.current')
  && read('src/components/footprints/FootprintsPage.tsx').includes('공유 화면 열기'));
check('footprint video UI forces sensitive-location protection for save and share',
  read('src/components/footprints/FootprintsPage.tsx').includes('hideSensitiveLocations: true')
  && read('src/components/footprints/FootprintsPage.tsx').includes('민감 위치 자동 보호')
  && read('src/components/footprints/FootprintsPage.tsx').includes('바로 공유'));
check('footprint videos attach album media only through verified date/place matches',
  footprintVideoMemories.includes('buildFootprintVideoMemoryMoments')
  && footprintVideoMemories.includes('memory.date !== routeDay')
  && footprintVideoMemories.includes('samePlace(item.placeName, memory.location)')
  && footprintVideoMemories.includes('nearestDistance > 300')
  && footprintVideoMemories.includes("kind: 'photo' | 'video'"));
check('footprint video memory media pauses route playback and stays privacy-filtered',
  footprintVideoExport.includes('MEMORY_PHOTO_HOLD_MS')
  && footprintVideoExport.includes('MEMORY_VIDEO_MAX_MS = 3_000')
  && footprintVideoExport.includes('presentationState')
  && footprintVideoExport.includes('drawMemoryMedia')
  && footprintVideoExport.includes('allowedPointIds')
  && footprintVideoExport.includes('loadMemoryMediaMoments(options.memoryMoments, allowedPointIds)'));
check('footprint video renders muted short clips with arrival titles',
  footprintVideoExport.includes('video.muted = true')
  && footprintVideoExport.includes("frame.kind === 'video'")
  && footprintVideoExport.includes("' · 도착'")
  && footprintVideoExport.includes("context.fillText('▶ 짧은 영상'"));
check('footprint video UI passes matched album moments into save and share exports',
  read('src/components/footprints/FootprintsPage.tsx').includes('videoMemoryMoments')
  && read('src/components/footprints/FootprintsPage.tsx').includes('memoryMoments: videoMemoryMoments')
  && read('src/components/footprints/FootprintsPage.tsx').includes('영상 클립은 최대 약 3초, 무음'));

check('Root protects unauthenticated flow', root.includes('if (!user) return <Suspense') && root.includes('<AuthFlow />'));
check('Root protects first profile setup flow', root.includes('<ProfileSetup'));
check(
  'authentication is phone-only with password recovery',
  authFlow.includes('<label>휴대폰 번호<input')
    && authFlow.includes('비밀번호 찾기')
    && !authFlow.includes('아이디 찾기')
    && !authFlow.includes('휴대폰 번호 또는 이메일'),
);
check(
  'profile setup does not request email',
  !profileSetup.includes('이메일') && includesAll(profileSetup, ["'이름'", "'생년월일'", "'성별'", "'프로필 사진'"]),
);
check(
  'account settings does not expose email login',
  !account.includes('이메일 로그인')
    && !account.includes('sendEmailVerification')
    && !account.includes('linkWithCredential'),
);
check('account settings keeps couple connection flow', account.includes('<CoupleConnect'));
check('partner profile is directly integrated', account.includes('<PartnerProfileCard'));

check('single React application root', (main.match(/createRoot\(/g) || []).length === 1);
check('startup restores auth without eager Firestore import', main.includes("from './lib/firebaseAuth';") && !main.includes("from './lib/firebase';"));
check('Firebase auth module does not import Firestore', !firebaseAuth.includes('firebase/firestore'));
check('Firestore module still owns persistent native cache', firebase.includes('persistentLocalCache') && firebase.includes('initializeFirestore'));
check('runtime recovery is explicitly initialized', main.includes("import { initializeRuntimeRecovery } from './recovery-runtime';"));
check('account isolation blocks React mount', main.indexOf('await initializeRuntimeRecovery()') > -1 && main.indexOf('await initializeRuntimeRecovery()') < main.indexOf('createRoot('));
check('account isolation policy is used', recovery.includes('decideAccountIsolation') && accountPolicy.includes("'reset-orphan'") && accountPolicy.includes("'reset-switch'"));
check('runtime recovery keeps Firestore cache isolation', firestoreCacheReset.includes('clearNativeFirestorePersistence'));

// NANER Phase 2: preserve existing theme IDs and the adaptive geometry owner.
const nanerSystem = read('src/naner-design-system.css');
const nanerThemes = read('src/route-themes.ts');
const nanerPalette = read('src/route-theme-accessibility.css');
check('NANER only exposes Modern Violet and keeps the theme preference key', nanerThemes.includes("const DEFAULT_THEME = 'modern-violet'") && !nanerThemes.includes("id: 'sunset-route'") && !nanerThemes.includes("id: 'neon-night'") && nanerThemes.includes("const STORAGE_KEY = 'route-theme-v2'"));
check('NANER palette and minimal navigation primitives are wired', nanerPalette.includes("data-route-theme='modern-violet'") && nanerPalette.includes('--primary:#635BEB') && nanerSystem.includes('background: transparent !important;') && nanerSystem.includes('.nav-icon') && read('src/main.tsx').includes("import './naner-design-system.css';") && read('src/styles.css').includes('Pretendard Variable'));

check('NANER phone composition connects real home previews, album and profile list', app.includes('latestMessage={messages[messages.length - 1]}') && app.includes('naner-home-chat') && memories.includes('naner-memory-add') && memories.includes("setFilter('video')") && more.includes('naner-more-profile') && location.includes('naner-location-settings') && app.includes("import './naner-phone-layout.css';"));
check('NANER own footprints use only own GPS records, without weakening joint verification', location.includes("scope === 'mine' ? myVisits : jointVisits") && location.includes("scope === 'mine' ? mySamples : partnerSamples") && location.includes("scope === 'together' ? jointById.get(visit.id)") && location.includes("buildJointFootprints"));
check('NANER room keeps scoped draft and previous page, with web and native back', app.includes('chatReturnTab') && app.includes('roomScope={roomScope}') && app.includes('draftCache={chatDraftRef}') && app.includes("window.addEventListener('popstate'") && app.includes("if (tab === 'chat') { event.preventDefault(); exitChatRoom(); return; }") && chat.includes('draftCache.current.scope === roomScope') && chat.includes('draftCache.current = { scope: roomScope, text: draft, replyTo }'));
check('NANER room keeps visual viewport composer and hides scrollbars', chat.includes('const bottom = visibleBottom;') && chat.includes("composer.style.setProperty('position', 'fixed', 'important')") && read('src/naner-chat-room.css').includes('scrollbar-width:none !important') && read('src/styles/features/chat.ts').includes('naner-chat-room.css'));
check('NANER expanded mobile workspaces preserve compact routes and real actions', read('src/utils/useExpandedMobile.ts').includes('width >= 600') && memories.includes('naner-album-detail') && memories.includes('!expanded || activeTab') && chat.includes('naner-chat-side') && chat.includes('dockWidth') && more.includes('naner-more-detail') && location.includes("type: 'focus', visit") && app.includes("import './naner-foldable.css';"));
check('NANER spacious tablet layout and scrollable hidden tracks', read('src/utils/navigationPlatform.ts').includes('width >= 840') && app.includes('tablet ? 3 : 2') && read('src/naner-tablet.css').includes('repeat(3,minmax(0,1fr))') && read('src/naner-tablet.css').includes('scrollbar-width:none !important') && chat.includes('tabIndex={tablet ? 0 : undefined}') && more.includes('naner-tablet-theme-preview') && more.includes("sheet === 'layout'") && app.includes("import './naner-tablet.css';"));
console.log(`\nROUTE flow smoke gate: ${passes.length} checks passed.`);
for (const pass of passes) console.log(`  ✓ ${pass}`);

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed:`);
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  process.exit(1);
}

console.log('\nCritical user-flow wiring is intact.');
