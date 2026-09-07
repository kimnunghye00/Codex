import fs from 'node:fs';
import path from 'node:path';

const assetsDir = path.resolve('dist/assets');
// Keep the native WebView entry graph simple, but fail CI if a future feature
// silently makes the shared runtime or startup stylesheet heavy again.
const MAX_JS_CHUNK_BYTES = 700 * 1024;
const MAX_ENTRY_CSS_BYTES = 190 * 1024;

if (!fs.existsSync(assetsDir)) {
  console.error('ROUTE bundle gate: dist/assets is missing. Run the production build first.');
  process.exit(1);
}

const assetNames = fs.readdirSync(assetsDir);
const jsChunks = assetNames
  .filter((name) => name.endsWith('.js'))
  .map((name) => ({ name, bytes: fs.statSync(path.join(assetsDir, name)).size }))
  .sort((a, b) => b.bytes - a.bytes);
const entryCss = assetNames
  .filter((name) => /^index-.*\.css$/.test(name))
  .map((name) => ({ name, bytes: fs.statSync(path.join(assetsDir, name)).size }))
  .sort((a, b) => b.bytes - a.bytes)[0];

if (!jsChunks.length) {
  console.error('ROUTE bundle gate: no JavaScript chunks were generated.');
  process.exit(1);
}
if (!entryCss) {
  console.error('ROUTE bundle gate: startup index CSS was not generated.');
  process.exit(1);
}

const oversized = jsChunks.filter((chunk) => chunk.bytes > MAX_JS_CHUNK_BYTES);
const largest = jsChunks[0];
const entryCssTooLarge = entryCss.bytes > MAX_ENTRY_CSS_BYTES;

console.log(`ROUTE bundle gate: ${jsChunks.length} JS chunks; largest ${largest.name} = ${(largest.bytes / 1024).toFixed(1)} KiB.`);
console.log(`Maximum allowed JS chunk size: ${(MAX_JS_CHUNK_BYTES / 1024).toFixed(0)} KiB.`);
console.log(`Startup CSS ${entryCss.name} = ${(entryCss.bytes / 1024).toFixed(1)} KiB; budget ${(MAX_ENTRY_CSS_BYTES / 1024).toFixed(0)} KiB.`);

if (oversized.length) {
  for (const chunk of oversized) {
    console.error(`Oversized chunk: ${chunk.name} = ${(chunk.bytes / 1024).toFixed(1)} KiB`);
  }
  console.error('A ROUTE JavaScript chunk exceeded the startup-safe bundle budget. Keep feature screens lazy-loaded or split only the new heavy feature.');
}
if (entryCssTooLarge) {
  console.error(`Startup CSS exceeded budget: ${entryCss.name} = ${(entryCss.bytes / 1024).toFixed(1)} KiB`);
  console.error('Move screen-specific styles back behind their lazy feature loader instead of adding them to main.tsx.');
}
if (oversized.length || entryCssTooLarge) process.exit(1);

console.log('ROUTE JavaScript and startup CSS bundle budgets passed.');
