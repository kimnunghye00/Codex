import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

// Resolve only explicitly selected, audit-recommended compatible versions.
// npm regenerates integrity hashes and the entire lockfile; never hand-edit them.
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const runtime = { vite: '8.3.8' };
const development = {
  '@capacitor/cli': '8.6.2',
  eslint: '10.15.0',
  'typescript-eslint': '8.74.0',
  vitest: '4.1.12',
  'firebase-tools': '15.29.0',
};
const overrides = {
  '@grpc/grpc-js': '1.14.5',
  re2js: '2.8.7',
  'source-map-js': '1.2.2',
  'proxy-addr': '2.0.8',
};
for (const [name, version] of Object.entries({...runtime, ...development, ...overrides})) {
  const found = JSON.parse(execFileSync('npm', ['view', name + '@' + version, 'version', '--json'], { encoding:'utf8' }));
  if (found !== version) throw Error('Unverified registry version: ' + name + '@' + version);
}
Object.assign(pkg.dependencies, runtime);
Object.assign(pkg.devDependencies, development);
pkg.overrides = { ...pkg.overrides, ...overrides };
// Do not downgrade Firebase or change its browser SDK API. Firestore pins
// grpc ~1.9; this same-major security override must pass emulator integration.
const cliTar = JSON.parse(execFileSync('npm', ['view', 'firebase-tools@15.29.0', 'dependencies.tar', '--json'], {encoding:'utf8'}));
if (typeof cliTar === 'string' && /^(?:[~^])?7\./.test(cliTar)) {
  const patched = JSON.parse(execFileSync('npm', ['view', 'tar@7.5.22', 'version', '--json'], {encoding:'utf8'}));
  if (patched !== '7.5.22') throw Error('Unverified tar patch');
  pkg.overrides['firebase-tools'] = { ...(pkg.overrides['firebase-tools'] ?? {}), tar:'7.5.22' };
}
fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
