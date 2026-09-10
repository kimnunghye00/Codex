import { existsSync, readFileSync } from 'node:fs';

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
  'src/lib/coupleConnection.ts',
  'src/components/couple/CoupleConnect.tsx',
  'src/components/home/CoupleHomeTools.tsx',
  'src/components/layout/ResponsiveAppFrame.tsx',
  'src/components/navigation/AppHeader.tsx',
  'src/components/navigation/BottomNav.tsx',
  'src/components/more/MoreServices.tsx',
  'src/components/chat/ChatPage.tsx',
  'src/components/memories/MemoriesPage.tsx',
  'src/components/memories/MemoryMedia.tsx',
  'src/components/location/LocationPage.tsx',
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
const accountPolicy = read('src/utils/accountIsolationPolicy.ts');
const coupleConnection = read('src/lib/coupleConnection.ts');
const coupleConnect = read('src/components/couple/CoupleConnect.tsx');
const homeTools = read('src/components/home/CoupleHomeTools.tsx');
const coupleSession = read('src/utils/coupleConnectSession.ts');
const releaseFlags = read('src/config/releaseFlags.ts');
const messageId = read('src/utils/messageId.ts');
const header = read('src/components/navigation/AppHeader.tsx');
const bottomNav = read('src/components/navigation/BottomNav.tsx');
const more = read('src/components/more/MoreServices.tsx');
const chat = read('src/components/chat/ChatPage.tsx');
const chatStyles = read('src/styles/features/chat.ts');
const memories = read('src/components/memories/MemoriesPage.tsx');
const memoryMedia = read('src/components/memories/MemoryMedia.tsx');
const location = read('src/components/location/LocationPage.tsx');
const account = read('src/components/auth/AccountSettings.tsx');
const mapHost = read('public/naver-map-host.html');
const responsiveFrame = read('src/components/layout/ResponsiveAppFrame.tsx');

check('primary navigation terminology', includesAll(bottomNav, ["'홈'", "'추억'", "'대화'", "'지도'", "'더보기'"]));
check('shared header owns notifications', header.includes('notification-button') && header.includes('onNotifications'));
check('shared header owns settings', header.includes('onSettings') && header.includes('aria-label="설정"'));
check('responsive frame owns desktop viewport', responsiveFrame.includes('lg:[&_.home-page]:!h-dvh') && responsiveFrame.includes('lg:[&_.home-page]:!min-h-0'));

check('App routes home', app.includes("tab === 'home'"));
check('App routes memories directly', app.includes("from './components/memories/MemoriesPage'") && app.includes('<MemoriesPage requestedTab={requestedHubTab}'));
check('App routes chat directly into page', app.includes("tab === 'chat'") && app.includes('<ChatPage Header={AppHeader}') && !app.includes('chat-room-layer'));
check('App routes location directly', app.includes("from './components/location/LocationPage'") && app.includes('<LocationPage requestedTab={requestedLocationTab}'));
check('App routes more', app.includes("tab === 'more'"));
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

check('More uses callback navigation', more.includes('onNavigate: (target: MoreNavigationTarget) => void'));
check('More has settings beside service grid', more.includes("id: 'settings', label: '설정'") && more.includes("id: 'footprint', label: '발자취'"));
check('More removes duplicate quick-settings section', !more.includes('more-quick-settings'));
check('More promise terminology', more.includes("id: 'date', label: '약속'"));
check('More does not search DOM for navigation', !more.includes('querySelectorAll'));

check('chat screen title is 대화', chat.includes('<Header title="대화"'));
check('chat realtime subscription is present', chat.includes('subscribeCoupleMessages'));
check('chat media upload path is present', chat.includes('uploadChatMedia'));
check('chat composer remains mounted', chat.includes('<ChatComposer'));
check('chat uses collision-resistant message ids', chat.includes('createMessageId') && messageId.includes('cryptoApi?.getRandomValues'));
check('unfinished call controls are render-gated', releaseFlags.includes('CALLING_ENABLED = false') && chat.includes('CALLING_ENABLED &&'));
check('chat room CSS is feature-loaded only', chatStyles.includes('route-chat-room-v26.css') && !app.includes("import './route-chat-room-v26.css'"));

check('memories exposes album tab', memories.includes("album: '앨범'"));
check('memories exposes anniversary tab', memories.includes("anniversary: '기념일'"));
check('memories exposes schedule tab', memories.includes("schedule: '일정'"));
check('memories exposes promise tab label', memories.includes("date: '약속'"));
check('memories separates schedule rows from promises', memories.includes('scheduleItems') && memories.includes('promiseScheduleExtras'));
check('memories schedule form has no type selector', !memories.includes('<select value={scheduleForm.type}') && memories.includes("type: 'personal' as const"));
check('memories promise form saves couple type', memories.includes("type: 'couple' as const") && memories.includes('약속 저장'));
check('memory media attempts durable legacy recovery', memoryMedia.includes('backupMedia/memories-live') && memoryMedia.includes('persistRecoveredUrl'));

check('location exposes requested tab state', location.includes('requestedTab?: LocationTabId') && location.includes('setActiveTab(requestedTab)'));
check('location screen title is 지도', location.includes('<Header title="지도"'));
check('location map tab is present', location.includes("activeTab === 'map'"));
check('location footprints tab is present', location.includes("activeTab === 'footprints'"));
check('Naver map host remains configured', location.includes('meluni-f4e00.web.app'));
check('map route uses exact shared LatLng path', mapHost.includes('path: points') && mapHost.includes('position: points[index]'));
check('map route follows active theme', mapHost.includes("--route-accent") && mapHost.includes('strokeColor: palette.accent'));

check('Root protects unauthenticated flow', root.includes('if (!user) return <Suspense') && root.includes('<AuthFlow />'));
check('Root protects first profile setup flow', root.includes('<ProfileSetup'));
check('account settings can link an email login', account.includes('linkWithCredential'));
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

console.log(`\nROUTE flow smoke gate: ${passes.length} checks passed.`);
for (const pass of passes) console.log(`  ✓ ${pass}`);

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed:`);
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  process.exit(1);
}

console.log('\nCritical user-flow wiring is intact.');
