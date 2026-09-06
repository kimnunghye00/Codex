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
  'src/route-runtime-stability-v19.css',
  'src/route-release-stability-v24.css',
  'src/lib/coupleConnection.ts',
  'src/components/couple/CoupleConnect.tsx',
  'src/components/navigation/AppHeader.tsx',
  'src/components/navigation/BottomNav.tsx',
  'src/components/more/MoreServices.tsx',
  'src/components/chat/ChatPage.tsx',
  'src/components/memories/MemoriesPage.tsx',
  'src/components/location/LocationPage.tsx',
  'src/components/auth/AccountSettings.tsx',
  'src/components/auth/PartnerProfileCard.tsx',
  'public/naver-map-host.html',
];

for (const file of requiredFiles) {
  check(`required file: ${file}`, existsSync(file));
}

const obsoleteFiles = [
  'src/components/memories/StableMemoriesPage.tsx',
  'src/components/location/StableLocationPage.tsx',
  'src/ai-test.css',
  'src/appearance-stability.ts',
  'src/route-appearance-stability-v17.css',
  'src/route-theme-preview-stability-v18.css',
  'src/route-web-home-v11.css',
  'src/route-mobile-home-v13.css',
  'src/route-mobile-home-fit-v14.css',
];

for (const file of obsoleteFiles) {
  check(`obsolete file removed: ${file}`, !existsSync(file));
}

if (failures.length) {
  console.error('\nROUTE flow smoke gate failed before source checks:\n');
  failures.forEach((failure) => console.error(`  ✗ ${failure}`));
  process.exit(1);
}

const app = read('src/App.tsx');
const root = read('src/Root.tsx');
const main = read('src/main.tsx');
const recovery = read('src/recovery-runtime.ts');
const coupleConnection = read('src/lib/coupleConnection.ts');
const coupleConnect = read('src/components/couple/CoupleConnect.tsx');
const releaseGuard = read('src/route-release-stability-v24.css');
const header = read('src/components/navigation/AppHeader.tsx');
const bottomNav = read('src/components/navigation/BottomNav.tsx');
const more = read('src/components/more/MoreServices.tsx');
const chat = read('src/components/chat/ChatPage.tsx');
const memories = read('src/components/memories/MemoriesPage.tsx');
const location = read('src/components/location/LocationPage.tsx');
const account = read('src/components/auth/AccountSettings.tsx');

check(
  'primary navigation terminology',
  includesAll(bottomNav, ["'홈'", "'추억'", "'대화'", "'지도'", "'더보기'"]),
  'BottomNav must keep the approved five labels',
);
check('shared header owns notifications', header.includes('notification-button') && header.includes('onNotifications'));
check('shared header owns settings', header.includes('onSettings') && header.includes('aria-label="설정"'));

check('App routes home', app.includes("tab === 'home'"));
check('App routes memories directly', app.includes("from './components/memories/MemoriesPage'") && app.includes('<MemoriesPage requestedTab={requestedHubTab}'));
check('App routes chat', app.includes("tab === 'chat'"));
check('App routes location directly', app.includes("from './components/location/LocationPage'") && app.includes('<LocationPage requestedTab={requestedLocationTab}'));
check('App routes more', app.includes("tab === 'more'"));
check('App has no Stable page bridge references', !app.includes('StableMemoriesPage') && !app.includes('StableLocationPage'));
check('native back handler remains connected', app.includes('route-native-back'));
check('App uses realtime couple subscription', app.includes('subscribeRealCoupleConnection') && !app.includes('window.setInterval(check, 3000)'));

check('couple connection exposes realtime user subscription', coupleConnection.includes('export function subscribeRealCoupleConnection') && coupleConnection.includes('onSnapshot(userRef'));
check('couple invite exposes realtime state subscription', coupleConnection.includes('export function subscribeCoupleInviteState') && coupleConnection.includes("'coupleInvites'"));
check('owner invite finalize returns a connection object', coupleConnection.includes('partnerProfile: result.partnerName') && !coupleConnection.includes('return null;\n}\n\nexport async function completeJoinerConnection'));
check('CoupleConnect has no interval polling', !coupleConnect.includes('setInterval('));
check('CoupleConnect consumes realtime invite snapshots', coupleConnect.includes('subscribeCoupleInviteState') && coupleConnect.includes('subscribeRealCoupleConnection'));

check('More uses callback navigation', more.includes('onNavigate: (target: MoreNavigationTarget) => void'));
check('More imports direct page navigation types', more.includes("from '../memories/MemoriesPage'") && more.includes("from '../location/LocationPage'"));
check('More profile opens through callback', more.includes("id === 'profile'") && more.includes('onOpenSettings()'));
check('More notifications open through callback', more.includes("id === 'notifications'") && more.includes('onOpenNotifications()'));
check('More does not search DOM for navigation', !more.includes('querySelectorAll') && !more.includes('.bottom-nav') && !more.includes('clickBottomNav'));
check('More does not use delayed text-click navigation', !more.includes('clickBottomNav'));

check('chat screen title is 대화', chat.includes('<Header title="대화"'));
check('chat realtime subscription is present', chat.includes('subscribeCoupleMessages'));
check('chat media upload path is present', chat.includes('uploadChatMedia'));
check('chat composer remains mounted', chat.includes('<ChatComposer'));
check('unfinished call controls are release-hidden',
  releaseGuard.includes('aria-label="음성 통화"')
  && releaseGuard.includes('aria-label="영상 통화"')
  && releaseGuard.includes('aria-label="화면 공유"')
  && releaseGuard.includes('display: none'));

check('memories exposes requested tab state', memories.includes('requestedTab?: HubTabId') && memories.includes('setActiveTab(requestedTab)'));
check('memories exposes album tab', memories.includes("album: '앨범'"));
check('memories exposes anniversary tab', memories.includes("anniversary: '기념일'"));
check('memories exposes schedule tab', memories.includes("schedule: '일정'"));
check('memories exposes date tab', memories.includes("date: '데이트'"));
check('memories can open map from a place', memories.includes('onOpenLocation'));

check('location exposes requested tab state', location.includes('requestedTab?: LocationTabId') && location.includes('setActiveTab(requestedTab)'));
check('location screen title is 지도', location.includes('<Header title="지도"'));
check('location map tab is present', location.includes("activeTab === 'map'"));
check('location footprints tab is present', location.includes("activeTab === 'footprints'"));
check('location can create a memory', location.includes('onCreateMemory'));
check('Naver map host remains configured', location.includes('meluni-f4e00.web.app'));

check('Root protects unauthenticated flow', root.includes('if (!user) return <App />'));
check('Root protects first profile setup flow', root.includes('<ProfileSetup'));
check('account settings can link an email login', account.includes('linkWithCredential'));
check('account settings keeps couple connection flow', account.includes('<CoupleConnect'));
check('partner profile is directly integrated', account.includes('<PartnerProfileCard'));

check('single React application root', (main.match(/createRoot\(/g) || []).length === 1);
check('recovery runtime is loaded directly', main.includes("import './recovery-runtime';"));
check('runtime recovery styles are loaded directly', main.includes("import './route-runtime-stability-v19.css';"));
check('phase 12 release guard loads last', main.includes("import './route-release-stability-v24.css';"));
check('obsolete appearance wrapper is not imported', !main.includes('appearance-stability'));
check('unused ai test stylesheet is not imported', !main.includes('ai-test.css'));
check('runtime recovery still handles connectivity', recovery.includes("window.addEventListener('offline'") && recovery.includes("window.addEventListener('online'"));
check('runtime recovery keeps account cache isolation', recovery.includes('prepareAccountLocalCache') && recovery.includes('clearNativeFirestorePersistence'));
check('runtime recovery rejects unowned legacy shared cache', recovery.includes('hasSharedLocalCache') && recovery.includes('orphanedLegacyCache'));
check('legacy enhancement layer is gone', !main.includes('RouteEnhancementLayer'));
check('legacy more enhancer is gone', !main.includes('more-enhance'));
check('legacy profile enhancer is gone', !main.includes('profile-enhance'));

console.log(`\nROUTE flow smoke gate: ${passes.length} checks passed.`);
for (const pass of passes) console.log(`  ✓ ${pass}`);

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed:`);
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  process.exit(1);
}

console.log('\nCritical user-flow wiring is intact.');
