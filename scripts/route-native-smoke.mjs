import { existsSync, readFileSync } from 'node:fs';

const failures = [];
const passes = [];
const read = (path) => readFileSync(path, 'utf8');

function check(name, condition, detail = '') {
  if (condition) passes.push(name);
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

const required = [
  'index.html',
  'src/main.tsx',
  'src/lib/native.ts',
  'src/app-icon-native.ts',
  'src/input-ime-stability.ts',
  'src/route-stability-v15.css',
  'android/app/src/main/AndroidManifest.xml',
  'android/app/src/main/java/com/route/couple/LauncherRepairReceiver.java',
  'android/app/src/main/java/com/route/couple/AppIconPlugin.java',
  'src/components/more/MoreServices.tsx',
  'scripts/prepare_character_launcher_icons.py',
  'capacitor.config.ts',
];

for (const file of required) check(`required native file: ${file}`, existsSync(file));

if (failures.length) {
  console.error('\nROUTE native smoke gate failed before source checks:\n');
  failures.forEach((failure) => console.error(`  ✗ ${failure}`));
  process.exit(1);
}

const index = read('index.html');
const main = read('src/main.tsx');
const native = read('src/lib/native.ts');
const icon = read('src/app-icon-native.ts');
const ime = read('src/input-ime-stability.ts');
const stabilityCss = read('src/route-stability-v15.css');
const manifest = read('android/app/src/main/AndroidManifest.xml');
const launcherRepair = read('android/app/src/main/java/com/route/couple/LauncherRepairReceiver.java');
const iconPlugin = read('android/app/src/main/java/com/route/couple/AppIconPlugin.java');
const moreServices = read('src/components/more/MoreServices.tsx');
const iconPrep = read('scripts/prepare_character_launcher_icons.py');
const capacitorConfig = read('capacitor.config.ts');

check('native bootstrap is wired', main.includes('initializeNativeApp') && (main.includes('await initializeNativeApp()') || main.includes('void initializeNativeApp()')));
check('native splash has an OS-level auto-hide guard', capacitorConfig.includes('launchAutoHide: true') && /launchShowDuration:\s*[1-9][0-9]*/.test(capacitorConfig));
check('native splash can still hide immediately when ROUTE is ready', main.includes('hideNativeSplash') && native.includes('export async function hideNativeSplash'));
check('native splash has a slow-bootstrap fallback', main.includes('NATIVE_SPLASH_FAILSAFE_MS') && main.includes('mountBootstrapShell'));
check('entry HTML has a dependency-free startup shell', index.includes('data-route-entry-shell="1"') && index.includes('data-route-entry-message'));
check('entry HTML reports module-load failures', index.includes('unhandledrejection') && index.includes('showEntryFailure'));
check('runtime recovery is explicitly wired', main.includes("import { initializeRuntimeRecovery } from './recovery-runtime';") && main.includes('await initializeRuntimeRecovery()'));
check('app icon native bridge is wired', main.includes("import './app-icon-native'"));
check('IME stability runtime is wired', main.includes("import './input-ime-stability'"));

check('keyboard show/hide listeners exist', native.includes('keyboardWillShow') && native.includes('keyboardDidHide'));
check('Android back button bridge exists', native.includes("App.addListener('backButton'") && native.includes('route-native-back'));
check('app resume bridge exists', native.includes('route-app-resume'));
check('native lifecycle wiring is duplicate-safe', native.includes('routeNativeLifecycleWired'));
check('foreground location permission flow exists', native.includes('ensureLocationPermission') && native.includes('Geolocation.requestPermissions'));
check('camera permission flow exists', native.includes('ensureCameraPermission') && native.includes('Camera.requestPermissions'));

check('IME composition handling exists', ime.includes('compositionstart') && ime.includes('compositionend'));
check('keyboard-open native CSS exists', stabilityCss.includes('route-keyboard-open'));
check('mobile input font guards exist', stabilityCss.includes('font-size: 16px'));

check('Android app disables backup', manifest.includes('android:allowBackup="false"'));
check('Android keyboard uses adjustResize', manifest.includes('android:windowSoftInputMode="adjustResize"'));
check('Android internet permission exists', manifest.includes('android.permission.INTERNET'));
check('Android camera permission exists', manifest.includes('android.permission.CAMERA'));
check('Android microphone permission exists', manifest.includes('android.permission.RECORD_AUDIO'));
check('Android fine location permission exists', manifest.includes('android.permission.ACCESS_FINE_LOCATION'));
check('Android notification permission exists', manifest.includes('android.permission.POST_NOTIFICATIONS'));
check('Android background location is not requested', !manifest.includes('ACCESS_BACKGROUND_LOCATION'));
check('Android broad media permission is not requested', !manifest.includes('READ_MEDIA_IMAGES') && !manifest.includes('READ_MEDIA_VIDEO'));

check('Android alternate launcher aliases exist', ['RouteDefaultIcon','RouteHeartChatIcon','DanduliCoupleLoveIcon','DanduliCoupleDateIcon'].every((name) => manifest.includes(name)));
check('launcher repair receiver is registered', manifest.includes('LauncherRepairReceiver') && manifest.includes('android.intent.action.MY_PACKAGE_REPLACED'));
check('launcher repair preserves the saved launcher icon', launcherRepair.includes('selected_icon') && launcherRepair.includes('applyIconState'));
check('app icon plugin registration exists', icon.includes("registerPlugin<RouteAppIconPlugin>('RouteAppIcon')"));
check('app icon bridge exposes verified native read/write', icon.includes('getNativeRouteAppIcon') && icon.includes('setNativeRouteAppIcon') && icon.includes('ICON_STATE_MISMATCH'));
check('app icon picker displays actual Android launcher state', moreServices.includes('Android가 실제로 활성화한 런처 아이콘 기준') && moreServices.includes('getNativeRouteAppIcon'));
check('Android 13+ launcher aliases switch atomically', iconPlugin.includes('setComponentEnabledSettings') && iconPlugin.includes('verifyIconState'));
check('character launcher build uses transparent clean artwork', iconPrep.includes('danduli-stickers-v3-clean.webp') && iconPrep.includes('Clean DANDULI sticker sheet lost transparency'));
check('deleted appearance wrapper is not referenced by icon bridge', !icon.includes('appearance-stability'));

console.log(`\nROUTE native smoke gate: ${passes.length} checks passed.`);
for (const pass of passes) console.log(`  ✓ ${pass}`);

if (failures.length) {
  console.error(`\n${failures.length} native check(s) failed:`);
  failures.forEach((failure) => console.error(`  ✗ ${failure}`));
  process.exit(1);
}

console.log('\nCritical Android/native wiring is intact.');
