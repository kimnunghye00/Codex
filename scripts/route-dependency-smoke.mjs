import fs from 'node:fs';

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
const lockRoot = lock.packages?.[''];
const failures = [];
const passes = [];

function check(name, condition, detail = '') {
  if (condition) passes.push(name);
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

check('package and lockfile versions match',
  pkg.version === lock.version && pkg.version === lockRoot?.version,
  `package=${pkg.version}, lock=${lock.version}, root=${lockRoot?.version}`);

for (const group of ['dependencies', 'devDependencies']) {
  const manifest = pkg[group] ?? {};
  const lockedSpecs = lockRoot?.[group] ?? {};
  for (const [name, spec] of Object.entries(manifest)) {
    const installed = lock.packages?.[`node_modules/${name}`]?.version;
    check(`${group} exact pin: ${name}`,
      typeof installed === 'string' && spec === installed && lockedSpecs[name] === installed,
      `manifest=${spec}, lockRoot=${lockedSpecs[name]}, installed=${installed}`);
  }
}

check('Node runtime floor is pinned', pkg.engines?.node === '>=22.13.0');

console.log(`\nROUTE dependency smoke gate: ${passes.length} checks passed.`);
for (const pass of passes) console.log(`  ✓ ${pass}`);

if (failures.length) {
  console.error(`\n${failures.length} dependency pin check(s) failed:`);
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  process.exit(1);
}

console.log('\nDirect dependency versions are deterministic and match package-lock.json.');
