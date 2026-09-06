import fs from 'node:fs';
import path from 'node:path';

const assetsDir = path.resolve('dist/assets');
const MAX_JS_CHUNK_BYTES = 450 * 1024;

if (!fs.existsSync(assetsDir)) {
  console.error('ROUTE bundle gate: dist/assets is missing. Run the production build first.');
  process.exit(1);
}

const jsChunks = fs.readdirSync(assetsDir)
  .filter((name) => name.endsWith('.js'))
  .map((name) => ({ name, bytes: fs.statSync(path.join(assetsDir, name)).size }))
  .sort((a, b) => b.bytes - a.bytes);

if (!jsChunks.length) {
  console.error('ROUTE bundle gate: no JavaScript chunks were generated.');
  process.exit(1);
}

const oversized = jsChunks.filter((chunk) => chunk.bytes > MAX_JS_CHUNK_BYTES);
const largest = jsChunks[0];

console.log(`ROUTE bundle gate: ${jsChunks.length} JS chunks; largest ${largest.name} = ${(largest.bytes / 1024).toFixed(1)} KiB.`);
console.log(`Maximum allowed JS chunk size: ${(MAX_JS_CHUNK_BYTES / 1024).toFixed(0)} KiB.`);

if (oversized.length) {
  for (const chunk of oversized) {
    console.error(`Oversized chunk: ${chunk.name} = ${(chunk.bytes / 1024).toFixed(1)} KiB`);
  }
  console.error('A ROUTE JavaScript chunk exceeded the P3 performance budget. Keep route/vendor code splitting intact or split the new dependency.');
  process.exit(1);
}

console.log('ROUTE JavaScript bundle budget passed.');
