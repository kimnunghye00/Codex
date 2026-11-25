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
  // Rolldown's optional WASI binding requires these exact peers. Making
  // them explicit prevents npm from pruning their lock entries on Linux.
  '@emnapi/core': '2.0.0-beta.2',
  '@emnapi/runtime': '2.0.0-beta.2',
};
const overrides = {
  '@grpc/grpc-js': '1.14.5',
  re2js: '2.8.7',
  'source-map-js': '1.2.2',
  'proxy-addr': '2.0.8',
  '@modelcontextprotocol/sdk': '1.32.0',
  'basic-ftp': '6.2.4',
  'body-parser@1': '1.20.9',
  'body-parser@2': '2.4.0',
  'brace-expansion@1': '1.1.21',
  'brace-expansion@2': '2.1.7',
  'brace-expansion@5': '5.0.12',
  'undici@8': '8.12.2',
  'zod@4': '4.6.6',
  'tar@7': '7.5.22',
};
for (const [name, version] of Object.entries({...runtime, ...development, ...overrides})) {
  const packageName = name.replace(/@\d+$/, '');
  const found = JSON.parse(execFileSync('npm', ['view', packageName + '@' + version, 'version', '--json'], { encoding:'utf8' }));
  if (found !== version) throw Error('Unverified registry version: ' + name + '@' + version);
}
Object.assign(pkg.dependencies, runtime);
Object.assign(pkg.devDependencies, development);
pkg.overrides = { ...pkg.overrides, ...overrides };
// Do not downgrade Firebase or change its browser SDK API. Firestore pins
// grpc ~1.9; this same-major security override must pass emulator integration.
// Do not nest overrides inside other override rules. Keep supported major
// series for parser dependencies, and verify all selected versions above.
fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
