import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchNaverDatePlaces } from '../src/utils/naverLocalSearch.ts';

test('NAVER local search checks viewport, branch city, provider tag and auth header', async () => {
  const oldFetch = globalThis.fetch;
  let sentUrl = '', authorization = '';
  globalThis.fetch = async (url, options) => {
    sentUrl = String(url);
    authorization = new Headers(options?.headers).get('Authorization') || '';
    return new Response(JSON.stringify({ provider: 'naver-local', results: [
      { latitude: 37.445, longitude: 129.160, placeName: '명륜진사갈비 삼척점', address: '강원특별자치도 삼척시 대학로 1' },
      { latitude: 37.570, longitude: 126.980, placeName: '명륜진사갈비 종로점', address: '서울특별시 종로구' },
      { latitude: 37.445, longitude: 129.160, placeName: '명륜진사갈비 삼척점', address: '강원특별자치도 삼척시 대학로 1' },
    ] }));
  };
  try {
    const result = await fetchNaverDatePlaces('명륜진사갈비 삼척점', {
      endpoint: 'https://asia-northeast3-example.cloudfunctions.net/searchDatePlaces', token: 'test-token',
      bounds: { west: 129.1, east: 129.2, south: 37.4, north: 37.5 },
    });
    assert.equal(authorization, 'Bearer test-token');
    assert.equal(new URL(sentUrl).searchParams.get('query'), '명륜진사갈비 삼척점');
    assert.deepEqual(result.map((p) => p.placeName), ['명륜진사갈비 삼척점']);
  } finally { globalThis.fetch = oldFetch; }
});

test('NAVER local search refuses non-HTTPS endpoints and unexpected response shape', async () => {
  await assert.rejects(fetchNaverDatePlaces('카페', { endpoint: 'http://not-safe.example', token: 'x' }), /Insecure/);
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('<html>not deployed</html>', { status: 200 });
  try {
    await assert.rejects(fetchNaverDatePlaces('카페', { endpoint: 'https://example.com/api/search', token: 'x' }));
  } finally { globalThis.fetch = oldFetch; }
});


test('provider diagnostics distinguish an out-of-map CGV from an unavailable search API', async () => {
  const before = globalThis.fetch;
  let target = '';
  globalThis.fetch = async (url) => {
    target = String(url);
    return new Response(JSON.stringify({ provider: 'naver-local', results: [
      { latitude: 37.534, longitude: 127.094, placeName: 'CGV 강변', address: '서울 광진구' },
      { latitude: 37.570, longitude: 126.980, placeName: 'CGV 타지역', address: '서울 종로구' },
    ] }));
  };
  try {
    let stats = { received: 0, valid: 0, inBounds: 0, matched: 0 };
    const places = await fetchNaverDatePlaces('CGV', {
      endpoint: 'https://asia-northeast3-example.cloudfunctions.net/searchDatePlaces',
      token: 'test-token', region: '서울 광진구 구의3동', focus: true,
      bounds: { west: 127.08, south: 37.53, east: 127.10, north: 37.54 },
      onCoverage: (coverage) => { stats = coverage; },
    });
    assert.deepEqual(places.map((item) => item.placeName), ['CGV 강변']);
    assert.deepEqual(stats, { received: 2, valid: 2, inBounds: 1, matched: 1 });
    assert.equal(new URL(target).searchParams.get('region'), '서울 광진구 구의3동');
    assert.equal(new URL(target).searchParams.get('focus'), '1');
  } finally { globalThis.fetch = before; }
});
