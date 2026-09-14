import assert from 'node:assert/strict';

const startHeap = process.memoryUsage().heapUsed;
const messages = Array.from({ length: 10_000 }, (_, index) => ({
  id: index + 1,
  sender: index % 2 ? 'me' : 'partner',
  type: index % 7 === 0 ? 'image' : 'text',
  text: `누적 대화 ${index} ${'가나다라마바사'.repeat(12)}`,
  imageUrl: index % 7 === 0 ? `https://example.invalid/media/${index}.webp` : undefined,
  timestamp: new Date(1_700_000_000_000 + index * 1000).toISOString(),
}));
const serialized = JSON.stringify(messages);
const parsed = JSON.parse(serialized);
const latestWindow = parsed.slice(-400);
assert.equal(latestWindow.length, 400);
assert.equal(latestWindow.at(-1).id, 10_000);

const memories = Array.from({ length: 2_000 }, (_, index) => ({
  id: index + 1,
  title: `추억 ${index}`,
  images: Array.from({ length: 5 }, (_, media) => `https://example.invalid/memories/${index}/${media}.webp`),
  description: '우리의 긴 추억 설명'.repeat(20),
}));
const visible = memories.slice(0, 30);
assert.equal(visible.length, 30);

const heapGrowthMb = (process.memoryUsage().heapUsed - startHeap) / 1024 / 1024;
assert.ok(heapGrowthMb < 80, `synthetic release data used ${heapGrowthMb.toFixed(1)} MiB`);
assert.ok(serialized.length < 8_000_000, 'message payload unexpectedly large');
console.log(`Release load smoke passed: 10,000 messages, 2,000 memories, ${heapGrowthMb.toFixed(1)} MiB heap growth.`);
