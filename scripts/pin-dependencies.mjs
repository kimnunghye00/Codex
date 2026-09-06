import fs from 'node:fs';

const PACKAGE_PATH = 'package.json';
const LOCK_PATH = 'package-lock.json';
const GROUPS = ['dependencies', 'devDependencies'];

const readJson = (path) => JSON.parse(fs.readFileSync(path, 'utf8'));
const writeJson = (path, value) => fs.writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);

const pkg = readJson(PACKAGE_PATH);
const lock = readJson(LOCK_PATH);
const lockRoot = lock.packages?.[''];

if (!lockRoot) throw new Error('package-lock.json is missing the root package entry.');

const pinned = [];
for (const group of GROUPS) {
  const manifestGroup = pkg[group] ?? {};
  const lockGroup = lockRoot[group] ?? {};

  for (const name of Object.keys(manifestGroup)) {
    const installed = lock.packages?.[`node_modules/${name}`]?.version;
    if (!installed) throw new Error(`Cannot find a locked version for ${name}.`);
    manifestGroup[name] = installed;
    lockGroup[name] = installed;
    pinned.push(`${name}@${installed}`);
  }

  pkg[group] = manifestGroup;
  lockRoot[group] = lockGroup;
}

// Keep all native/CI environments on the Node line already used by ROUTE Actions
// and required by the current Capacitor/Vite toolchain.
pkg.engines = { ...(pkg.engines ?? {}), node: '>=22.13.0' };
lockRoot.engines = pkg.engines;

// package.json was bumped independently in the past; keep lockfile package metadata
// aligned so npm ci and future release tooling see one application version.
lock.name = pkg.name;
lock.version = pkg.version;
lockRoot.name = pkg.name;
lockRoot.version = pkg.version;

writeJson(PACKAGE_PATH, pkg);
writeJson(LOCK_PATH, lock);

console.log(`Pinned ${pinned.length} direct dependencies to the versions already validated by package-lock.json.`);
for (const item of pinned) console.log(`  - ${item}`);
