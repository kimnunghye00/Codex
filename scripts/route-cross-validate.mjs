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
];
for (const reference of bannedReferences) {
  const owners = allTextFiles.filter((file) => read(file).includes(reference));
  check(`no stale reference: ${reference}`, owners.length === 0, owners.join(', '));
}

const main = read('src/main.tsx');
const appIconNative = read('src/app-icon-native.ts');
const native = read('src/lib/native.ts');
const manifest = read('android/app/src/main/AndroidManifest.xml');
const configureNative = read('scripts/configure-native.mjs');
const pkg = JSON.parse(read('package.json'));
const workflow = read('.github/workflows/stability-gate.yml');

check('single React root remains', (main.match(/createRoot\(/g) || []).length === 1);
check('runtime recovery is directly loaded', main.includes("import './recovery-runtime';"));
check('runtime recovery CSS is directly loaded', main.includes("import './route-runtime-stability-v19.css';"));
check('native icon bridge is directly loaded', main.includes("import './app-icon-native';"));
check('native icon bridge has no retired wrapper import', !appIconNative.includes('appearance-stability'));

check('native keyboard lifecycle is wired', native.includes("keyboardWillShow") && native.includes("keyboardDidHide") && native.includes('route-keyboard-open'));
check('native Android back bridge is wired', native.includes("App.addListener('backButton'") && native.includes("route-native-back"));
check('native resume bridge is wired', native.includes("route-app-resume"));
check('camera permission helper exists', native.includes('ensureCameraPermission'));
check('location permission helper exists', native.includes('ensureLocationPermission'));
check('notification permission helper exists', native.includes('ensureNotificationPermission'));

const requiredPermissions = [
  'android.permission.INTERNET',
  'android.permission.CAMERA',
  'android.permission.RECORD_AUDIO',
  'android.permission.ACCESS_COARSE_LOCATION',
  'android.permission.ACCESS_FINE_LOCATION',
  'android.permission.POST_NOTIFICATIONS',
];
for (const permission of requiredPermissions) {
  check(`Android manifest permission: ${permission}`, manifest.includes(permission));
  check(`native configure permission: ${permission}`, configureNative.includes(permission));
}

const forbiddenPermissions = [
  'android.permission.ACCESS_BACKGROUND_LOCATION',
  'android.permission.FOREGROUND_SERVICE_LOCATION',
  'android.permission.READ_MEDIA_IMAGES',
  'android.permission.READ_MEDIA_VIDEO',
];
for (const permission of forbiddenPermissions) {
  check(`Android manifest excludes: ${permission}`, !manifest.includes(`uses-permission android:name="${permission}"`));
  check(`native configure strips: ${permission}`, configureNative.includes(permission));
}

check('Android WebView uses adjustResize', manifest.includes('android:windowSoftInputMode="adjustResize"'));
check('Android backup is disabled', manifest.includes('android:allowBackup="false"'));
check('launcher icon aliases remain configured', ['RouteDefaultIcon', 'RouteHeartIcon', 'RouteNightIcon', 'RouteCreamIcon'].every((name) => manifest.includes(name)));

check('package exposes flow gate', pkg.scripts?.['stability:flow'] === 'node scripts/route-flow-smoke.mjs');
check('package exposes native gate', pkg.scripts?.['stability:native'] === 'node scripts/route-native-smoke.mjs');
check('package exposes cross gate', pkg.scripts?.['stability:cross'] === 'node scripts/route-cross-validate.mjs');
check('full stability command runs all independent gates', typeof pkg.scripts?.stability === 'string'
  && pkg.scripts.stability.includes('stability:flow')
  && pkg.scripts.stability.includes('stability:native')
  && pkg.scripts.stability.includes('stability:cross'));
check('CI executes cross validation', workflow.includes('npm run stability:cross'));

console.log(`\nROUTE cross validation: ${passes.length} checks passed.`);
for (const pass of passes) console.log(`  ✓ ${pass}`);

if (failures.length) {
  console.error(`\n${failures.length} cross-validation check(s) failed:`);
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  process.exit(1);
}

console.log('\nIndependent repository, native, and cleanup invariants agree.');
