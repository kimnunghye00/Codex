import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const failures = [];
const passes = [];

function check(name, condition, detail = '') {
  if (condition) {
    passes.push(name);
    return;
  }
  failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

function read(relativePath) {
  return readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function walk(dir, results = []) {
  const absolute = path.join(ROOT, dir);
  if (!existsSync(absolute)) return results;
  for (const entry of readdirSync(absolute)) {
    const relative = path.join(dir, entry);
    const full = path.join(ROOT, relative);
    if (statSync(full).isDirectory()) walk(relative, results);
    else results.push(relative.replaceAll('\\', '/'));
  }
  return results;
}

function resolveRelativeImport(fromFile, specifier) {
  const base = path.resolve(ROOT, path.dirname(fromFile), specifier);
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.jsx`,
    `${base}.mjs`,
    `${base}.css`,
    `${base}.json`,
    path.join(base, 'index.ts'),
    path.join(base, 'index.tsx'),
    path.join(base, 'index.js'),
    path.join(base, 'index.css'),
  ];
  return candidates.some((candidate) => existsSync(candidate));
}

const sourceFiles = walk('src').filter((file) => /\.(?:ts|tsx|js|jsx|mjs)$/.test(file));
const importPattern = /(?:import\s+(?:[^'";]*?\s+from\s+)?|export\s+[^'";]*?\s+from\s+)["']([^"']+)["']/g;
const missingImports = [];

for (const file of sourceFiles) {
  const source = read(file);
  for (const match of source.matchAll(importPattern)) {
    const specifier = match[1];
    if (!specifier.startsWith('.')) continue;
    if (!resolveRelativeImport(file, specifier)) missingImports.push(`${file} -> ${specifier}`);
  }
}

check('all relative source imports resolve', missingImports.length === 0, missingImports.join(', '));

const retiredFiles = [
  'src/appearance-stability.ts',
  'src/ai-test.css',
  'src/route-appearance-stability-v17.css',
  'src/route-theme-preview-stability-v18.css',
  'src/route-web-home-v11.css',
  'src/route-mobile-home-v13.css',
  'src/route-mobile-home-fit-v14.css',
  'src/route-release-stability-v24.css',
  'src/components/memories/StableMemoriesPage.tsx',
  'src/components/location/StableLocationPage.tsx',
];
for (const file of retiredFiles) check(`retired file absent: ${file}`, !existsSync(path.join(ROOT, file)));

const allTextFiles = walk('src').filter((file) => /\.(?:ts|tsx|js|jsx|mjs|css)$/.test(file));
const bannedReferences = [
  './appearance-stability',
  'StableMemoriesPage',
  'StableLocationPage',
  'route-appearance-stability-v17.css',
  'route-theme-preview-stability-v18.css',
  'route-web-home-v11.css',
  'route-mobile-home-v13.css',
  'route-mobile-home-fit-v14.css',
  'route-release-stability-v24.css',
];
for (const reference of bannedReferences) {
  const owners = allTextFiles.filter((file) => read(file).includes(reference));
  check(`no stale reference: ${reference}`, owners.length === 0, owners.join(', '));
}

const main = read('src/main.tsx');
const app = read('src/App.tsx');
const recovery = read('src/recovery-runtime.ts');
const accountPolicy = read('src/utils/accountIsolationPolicy.ts');
const coupleConnection = read('src/lib/coupleConnection.ts');
const coupleConnect = read('src/components/couple/CoupleConnect.tsx');
const coupleSession = read('src/utils/coupleConnectSession.ts');
const chat = read('src/components/chat/ChatPage.tsx');
const messageId = read('src/utils/messageId.ts');
const releaseFlags = read('src/config/releaseFlags.ts');
const coupleCall = read('src/lib/coupleCall.ts');
const callManager = read('src/components/call/DanduliCallManager.tsx');
const runtimeTests = read('tests/route-runtime.test.ts');
const appIconNative = read('src/app-icon-native.ts');
const native = read('src/lib/native.ts');
const manifest = read('android/app/src/main/AndroidManifest.xml');
const configureNative = read('scripts/configure-native.mjs');
const pkg = JSON.parse(read('package.json'));
const workflow = read('.github/workflows/stability-gate.yml');
const webDeploy = read('.github/workflows/web-deploy.yml');
const firebaseConfig = read('firebase.json');
const locationUpload = read('functions-location/index.js');
const locationRealtime = read('src/lib/locationRealtime.ts');
const backgroundLocationUpload = read('src/lib/backgroundLocationUpload.ts');
const footprintVideoPrivacy = read('src/lib/footprintVideoPrivacy.ts');
const footprintVideoExport = read('src/lib/footprintVideoExport.ts');
const mediaSaver = read('android/app/src/main/java/com/e2/danduli/MediaSaverPlugin.java');

check('single React root remains', (main.match(/createRoot\(/g) || []).length === 1);
check('runtime recovery is explicitly imported', main.includes("import { initializeRuntimeRecovery } from './recovery-runtime';"));
check('runtime recovery blocks React bootstrap', main.indexOf('await initializeRuntimeRecovery()') > -1 && main.indexOf('await initializeRuntimeRecovery()') < main.indexOf('createRoot('));
check('runtime recovery CSS is directly loaded', main.includes("import './route-runtime-stability-v19.css';"));
check('native icon bridge is directly loaded', main.includes("import './app-icon-native';"));
check('native icon bridge has no retired wrapper import', !appIconNative.includes('appearance-stability'));

check('App realtime connection replaces always-on polling', app.includes('subscribeRealCoupleConnection') && !app.includes('window.setInterval(check, 3000)'));
check('couple library has user/couple/partner snapshots',
  coupleConnection.includes('subscribeRealCoupleConnection')
  && coupleConnection.includes("onSnapshot(doc(db, 'couples', coupleId)")
  && coupleConnection.includes("onSnapshot(doc(db, 'users', partnerUid)"));
check('couple invite state is snapshot driven', coupleConnection.includes('subscribeCoupleInviteState') && coupleConnect.includes('subscribeCoupleInviteState'));
check('CoupleConnect has no interval polling', !coupleConnect.includes('setInterval('));
check('owner finalize no longer always returns null',
  coupleConnection.includes('partnerProfile: result.partnerName')
  && !coupleConnection.includes('if (!result?.coupleId || !result.partnerUid) return null;\n  return null;'));
check('pending couple connection survives restart', coupleConnect.includes('loadPersistedSession') && coupleSession.includes("mode: 'invite' | 'waiting'"));

check('account isolation is policy-driven', recovery.includes('decideAccountIsolation') && accountPolicy.includes('export function decideAccountIsolation'));
check('orphaned cache is cleared before initial mount', recovery.includes("action === 'reset-orphan'") && main.includes('await initializeRuntimeRecovery()'));
check('recovery initialization is idempotent', recovery.includes('runtimeRecoveryPromise') && recovery.includes('runtimeListenersInstalled'));
check('recovery no longer self-installs on import', !recovery.includes('installRuntimeRecovery();'));

check('message ids use secure random words', messageId.includes('cryptoApi?.getRandomValues') && messageId.includes('messageIdFromRandomWords'));
check('chat no longer uses timestamp-only message ids', chat.includes('createMessageId') && !chat.includes('Date.now() * 1000'));
check('voice/video calls remain release-paused', releaseFlags.includes('CALLING_ENABLED = false') && chat.includes('CALLING_ENABLED && connection') && chat.includes('danduli-call-request'));
check('calls use realtime couple signaling', coupleCall.includes('subscribeCoupleCall') && coupleCall.includes('startCoupleCall') && coupleCall.includes('appendCoupleCallCandidate'));
check('call manager owns WebRTC media', callManager.includes('RTCPeerConnection') && callManager.includes('getUserMedia') && callManager.includes('acceptIncoming'));

check('runtime tests execute production helpers',
  runtimeTests.includes("../src/utils/messageId.ts")
  && runtimeTests.includes("../src/utils/accountIsolationPolicy.ts")
  && runtimeTests.includes("../src/utils/coupleConnectSession.ts")
  && runtimeTests.includes("../src/config/releaseFlags.ts"));

check('native keyboard lifecycle is wired', native.includes('keyboardWillShow') && native.includes('keyboardDidHide') && native.includes('route-keyboard-open'));
check('native Android back bridge is wired', native.includes("App.addListener('backButton'") && native.includes('route-native-back'));
check('native resume bridge is wired', native.includes('route-app-resume'));
check('camera permission helper exists', native.includes('ensureCameraPermission'));
check('location permission helper exists', native.includes('ensureLocationPermission'));
check('notification permission helper exists', native.includes('ensureNotificationPermission'));

const requiredPermissions = [
  'android.permission.INTERNET',
  'android.permission.CAMERA',
  'android.permission.RECORD_AUDIO',
  'android.permission.ACCESS_COARSE_LOCATION',
  'android.permission.ACCESS_FINE_LOCATION',
  'android.permission.FOREGROUND_SERVICE',
  'android.permission.FOREGROUND_SERVICE_LOCATION',
  'android.permission.POST_NOTIFICATIONS',
];
for (const permission of requiredPermissions) {
  check(`Android manifest permission: ${permission}`, manifest.includes(permission));
  check(`native configure permission: ${permission}`, configureNative.includes(permission));
}

const forbiddenPermissions = [
  'android.permission.ACCESS_BACKGROUND_LOCATION',
  'android.permission.READ_MEDIA_IMAGES',
  'android.permission.READ_MEDIA_VIDEO',
];
for (const permission of forbiddenPermissions) {
  check(`Android manifest excludes: ${permission}`, !manifest.includes(`uses-permission android:name="${permission}"`));
  check(`native configure strips: ${permission}`, configureNative.includes(permission));
}

check('Android location foreground service is declared',
  manifest.includes('BackgroundLocationService')
  && manifest.includes('android:foregroundServiceType="location"')
  && manifest.includes('android:exported="false"'));
check('Android WebView uses adjustResize', manifest.includes('android:windowSoftInputMode="adjustResize"'));
check('Android backup is disabled', manifest.includes('android:allowBackup="false"'));
check('four launcher icon aliases remain configured', ['DanduliDefaultLauncher', 'DanduliChatLauncher', 'DanduliLoveLauncher', 'DanduliDateLauncher'].every((name) => manifest.includes(name)));

check('package exposes runtime gate', pkg.scripts?.['stability:runtime'] === 'node --experimental-strip-types --test tests/*runtime.test.ts');
check('package exposes flow gate', pkg.scripts?.['stability:flow'] === 'node scripts/route-flow-smoke.mjs');
check('package exposes native gate', pkg.scripts?.['stability:native'] === 'node scripts/route-native-smoke.mjs');
check('package exposes cross gate', pkg.scripts?.['stability:cross'] === 'node scripts/route-cross-validate.mjs');
check('full stability command runs runtime and static gates', typeof pkg.scripts?.stability === 'string'
  && pkg.scripts.stability.includes('stability:runtime')
  && pkg.scripts.stability.includes('stability:flow')
  && pkg.scripts.stability.includes('stability:native')
  && pkg.scripts.stability.includes('stability:cross'));
check('CI executes runtime validation', workflow.includes('npm run stability:runtime'));
check('CI executes cross validation', workflow.includes('npm run stability:cross'));
check('location upload functions are isolated in their own codebase',
  firebaseConfig.includes('"source": "functions-location"')
  && firebaseConfig.includes('"codebase": "location-upload"'));
check('web deploy verifies and publishes location upload functions',
  webDeploy.includes('functions-location/location-upload.test.js')
  && webDeploy.includes('functions:location-upload:registerLocationUploadDevice')
  && webDeploy.includes('functions:location-upload:uploadBackgroundLocation'));
check('native uploader token is issued from verified Firebase auth',
  locationUpload.includes('verifyIdToken')
  && locationUpload.includes('verifyMembership')
  && locationUpload.includes('secretHash'));
check('location upload endpoint writes owner-attributed raw samples only',
  locationUpload.includes('/locationSamples/')
  && locationUpload.includes('ownerUid')
  && !locationUpload.includes("source: 'gps-cross-check'"));
check('web client subscribes to owner-separated raw GPS samples',
  locationRealtime.includes('subscribeMemberLocationSamples')
  && backgroundLocationUpload.includes('getIdToken(true)'));
check('footprint video export does not require map tile capture',
  footprintVideoExport.includes('canvas.captureStream(30)')
  && !footprintVideoExport.includes('naver-map-host'));
check('Android video export writes through scoped MediaStore without broad media permission',
  mediaSaver.includes('MediaStore.Video.Media.RELATIVE_PATH')
  && mediaSaver.includes('Environment.DIRECTORY_MOVIES + "/DANDULI"')
  && !manifest.includes('READ_MEDIA_VIDEO')
  && !manifest.includes('WRITE_EXTERNAL_STORAGE'));
check('shared footprint videos redact endpoints before timeline rendering',
  footprintVideoExport.indexOf('protectFootprintVideoRoute') < footprintVideoExport.indexOf('buildFootprintVideoPlan(privacy.points)')
  && footprintVideoPrivacy.includes('sanitizeBoundaryNames'));
check('Android sharing grants only temporary read access to saved media',
  mediaSaver.includes('Intent.FLAG_GRANT_READ_URI_PERMISSION')
  && mediaSaver.includes('content')
  && !manifest.includes('READ_MEDIA_VIDEO'));

console.log(`\nROUTE cross validation: ${passes.length} checks passed.`);
for (const pass of passes) console.log(`  ✓ ${pass}`);

if (failures.length) {
  console.error(`\n${failures.length} cross-validation check(s) failed:`);
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  process.exit(1);
}

console.log('\nIndependent repository, native, privacy, runtime, and cleanup invariants agree.');
