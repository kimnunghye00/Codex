import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { insideMapBounds, sameMapBounds, searchLocations, searchLocationPage } from '../src/utils/locationSearch.ts';
import { matchesPlaceSearchIntent, parsePlaceSearchIntent } from '../src/utils/placeSearchIntent.ts';

test('same-name places remain independently selectable with disambiguating addresses', async () => {
  const oldFetch = globalThis.fetch;
  let requestUrl = '';
  globalThis.fetch = async (url) => {
    requestUrl = String(url);
    return new Response(JSON.stringify([
      { lat: '35.156', lon: '129.058', name: '이재모피자', display_name: '이재모피자, 부산진구, 부산' },
      { lat: '35.099', lon: '129.030', name: '이재모피자', display_name: '이재모피자, 중구, 부산' },
      { lat: '35.156', lon: '129.058', name: '이재모피자', display_name: '중복 위치' },
      { lat: 'not-a-coordinate', lon: '129.030', name: '오류 위치' },
    ]), { status: 200 });
  };
  try {
    const branches = await searchLocations('이재모피자');
    assert.equal(branches.length, 2);
    assert.equal(branches[0].placeName, '이재모피자');
    assert.equal(branches[1].address, '이재모피자, 중구, 부산');
    assert.notEqual(branches[0].latitude, branches[1].latitude);
    assert.match(requestUrl, /limit=40/);
    assert.match(requestUrl, /countrycodes=kr/);
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test('empty query and invalid search responses return zero results', async () => {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('invalid', { status: 500 });
  try {
    assert.deepEqual(await searchLocations('   '), []);
    assert.deepEqual(await searchLocations('없는 위치'), []);
  } finally {
    globalThis.fetch = oldFetch;
  }
});


test('map search restricts request and filters out nationwide results; paging preserves its bounds', async () => {
  const original = globalThis.fetch;
  const urls: URL[] = [];
  globalThis.fetch = async (url) => {
    urls.push(new URL(String(url)));
    return new Response(JSON.stringify([
      { place_id: 10, lat: '35.16', lon: '129.06', name: '부산 가게' },
      { place_id: 20, lat: '37.56', lon: '126.97', name: '서울 가게' },
    ]));
  };
  try {
    const bounds = { west: 129, east: 130, south: 35, north: 36 };
    const first = await searchLocationPage('가게', { bounds });
    assert.deepEqual(first.results.map((p) => p.placeName), ['부산 가게']);
    assert.equal(urls[0].searchParams.get('bounded'), '1');
    assert.equal(urls[0].searchParams.get('viewbox'), '129,36,130,35');
    assert.equal(first.hasMore, true);
    const next = await searchLocationPage('가게', { bounds, excludedIds: first.excludedIds });
    assert.equal(urls[1].searchParams.get('exclude_place_ids'), '10,20');
    assert.equal(next.hasMore, false);
    await searchLocationPage('가게');
    assert.equal(urls[2].searchParams.has('bounded'), false);
  } finally { globalThis.fetch = original; }
});

test('new search API distinguishes a service failure from a real empty result', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response('', { status: 429 });
  try { await assert.rejects(searchLocationPage('카페')); }
  finally { globalThis.fetch = original; }
});


test('map search retries outside the strict viewbox and filters nationwide false positives', async () => {
  const oldFetch = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    if (urls.length === 1) return new Response(JSON.stringify([]));
    return new Response(JSON.stringify([
      { place_id: 44, lat: '37.563', lon: '126.974', name: '서진닭갈비', display_name: '서진닭갈비, 서울' },
      { place_id: 45, lat: '35.170', lon: '129.060', name: '서진닭갈비', display_name: '다른 지역 서진닭갈비' },
    ]));
  };
  try {
    const results = await searchLocationPage('서진닭갈비', { bounds: { west: 126.97, south: 37.56, east: 126.98, north: 37.57 } });
    assert.equal(results.results.length, 1);
    assert.equal(results.results[0].placeName, '서진닭갈비');
    assert.match(urls[0], /bounded=1/);
    assert.ok(!urls[1].includes('bounded=1'));
  } finally { globalThis.fetch = oldFetch; }
});

test('map search falls back to nearby named OSM POIs, excluding out-of-view locations and duplicate geometries', async () => {
  const oldFetch = globalThis.fetch;
  const urls: string[] = [];
  let poiRequest = '';
  globalThis.fetch = async (url, options) => {
    urls.push(String(url));
    if (String(url).includes('overpass-api')) {
      poiRequest = String(options?.body ?? '');
      return new Response(JSON.stringify({ elements: [
        { type: 'node', id: 1, lat: 37.563, lon: 126.974, tags: { name: '서진닭갈비', 'addr:street': '서소문로' } },
        { type: 'way', id: 2, center: { lat: 37.563, lon: 126.974 }, tags: { name: '서진닭갈비' } },
        { type: 'node', id: 3, lat: 35.16, lon: 129.06, tags: { name: '서진닭갈비' } },
        { type: 'node', id: 4, lat: 37.564, lon: 126.975, tags: { name: '다른 식당' } },
      ] }));
    }
    return new Response(JSON.stringify([]));
  };
  try {
    const page = await searchLocationPage('서진닭갈비', { bounds: { west: 126.97, south: 37.56, east: 126.98, north: 37.57 } });
    assert.equal(page.results.length, 1);
    assert.equal(page.results[0].address, '서소문로');
    assert.equal(page.hasMore, false);
    assert.equal(urls.length, 3);
    assert.match(new URLSearchParams(poiRequest).get('data') ?? '', /37\.56,126\.97,37\.57,126\.98/);
  } finally { globalThis.fetch = oldFetch; }
});

test('a missing POI query with quotes is safely escaped and map search cannot return remote matches', async () => {
  const oldFetch = globalThis.fetch;
  let poiQuery = '';
  globalThis.fetch = async (url, options) => {
    if (String(url).includes('overpass-api')) {
      poiQuery = new URLSearchParams(String(options?.body)).get('data') ?? '';
      return new Response(JSON.stringify({ elements: [] }));
    }
    return new Response(JSON.stringify([]));
  };
  try {
    const result = await searchLocationPage('카페 "안녕"', { bounds: { west: 126.97, south: 37.56, east: 126.98, north: 37.57 } });
    assert.deepEqual(result.results, []);
    assert.match(poiQuery, /\\"안녕\\"/);
  } finally { globalThis.fetch = oldFetch; }
});


test('a named Samcheok branch is parsed even when the suffix is attached', () => {
  const spaced = parsePlaceSearchIntent('명륜진사갈비 삼척점');
  const attached = parsePlaceSearchIntent('명륜진사갈비삼척점');
  const leading = parsePlaceSearchIntent('강원 삼척 명륜진사갈비');
  assert.equal(spaced.businessQuery, '명륜진사갈비');
  assert.equal(spaced.city, '삼척시');
  assert.equal(spaced.province, '강원');
  assert.equal(attached.city, '삼척시');
  assert.equal(attached.businessQuery, '명륜진사갈비');
  assert.equal(leading.city, '삼척시');
  assert.equal(leading.businessQuery, '명륜진사갈비');
  assert.equal(parsePlaceSearchIntent('명륜진사갈비').hasExplicitRegion, false);
});

test('a franchise branch in Seoul never satisfies a named Samcheok search', () => {
  const intent = parsePlaceSearchIntent('명륜진사갈비 삼척점');
  assert.equal(matchesPlaceSearchIntent({
    latitude: 37.57, longitude: 127, placeName: '명륜진사갈비',
    address: '명륜진사갈비, 종로구, 서울특별시',
  }, intent), false);
  assert.equal(matchesPlaceSearchIntent({
    latitude: 37.45, longitude: 129.16, placeName: '명륜진사갈비 삼척점',
    address: '명륜진사갈비, 삼척시, 강원특별자치도',
  }, intent), true);
  assert.equal(matchesPlaceSearchIntent({
    latitude: 37.57, longitude: 127, placeName: '명륜진사갈비 삼척점',
    address: '종로구, 서울특별시',
  }, intent), false);
});

test('brand-only retry rejects Seoul and returns only the requested Samcheok branch', async () => {
  const oldFetch = globalThis.fetch;
  const urls: URL[] = [];
  globalThis.fetch = async (url) => {
    const parsed = new URL(String(url));
    urls.push(parsed);
    const name = parsed.searchParams.get('q');
    return new Response(JSON.stringify(name === '명륜진사갈비 삼척점' ? [
      { place_id: 1, lat: '37.57', lon: '127', name: '명륜진사갈비', display_name: '명륜진사갈비, 종로구, 서울특별시' },
    ] : [
      { place_id: 1, lat: '37.57', lon: '127', name: '명륜진사갈비', display_name: '명륜진사갈비, 종로구, 서울특별시' },
      { place_id: 2, lat: '37.45', lon: '129.16', name: '명륜진사갈비', display_name: '명륜진사갈비, 삼척시, 강원특별자치도' },
    ]));
  };
  try {
    const page = await searchLocationPage('명륜진사갈비 삼척점');
    assert.equal(page.results.length, 1);
    assert.match(page.results[0].address || '', /삼척시/);
    assert.equal(urls.length, 2);
    assert.equal(urls[1].searchParams.get('q'), '명륜진사갈비');
    assert.equal(urls[0].searchParams.has('bounded'), false);
  } finally { globalThis.fetch = oldFetch; }
});

test('when only a Seoul franchise is indexed, Samcheok search is empty rather than an incorrect substitute', async () => {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify([
    { place_id: 1, lat: '37.57', lon: '127', name: '명륜진사갈비', display_name: '명륜진사갈비, 종로구, 서울특별시' },
  ]));
  try {
    const page = await searchLocationPage('명륜진사갈비 삼척점');
    assert.deepEqual(page.results, []);
    assert.equal(page.hasMore, false);
  } finally { globalThis.fetch = oldFetch; }
});

test('identical map searches reuse fresh data but changed bounds and pagination fetch again', async () => {
  const original = globalThis.fetch;
  const bounds = { west: 126.97, east: 126.98, south: 37.56, north: 37.57 };
  let requests = 0;
  globalThis.fetch = async () => {
    requests += 1;
    return new Response(JSON.stringify([
      { place_id: 7701, lat: '37.563', lon: '126.974', name: '도토리카페', display_name: '도토리카페, 중구, 서울' },
    ]));
  };
  try {
    const first = await searchLocationPage('도토리카페', { bounds, cache: true });
    const second = await searchLocationPage('도토리카페', { bounds, cache: true });
    assert.equal(requests, 1);
    assert.deepEqual(first, second);
    assert.notEqual(first.results, second.results, 'cached pages must not share the results array');
    await searchLocationPage('도토리카페', { bounds: { ...bounds, west: 126.971 }, cache: true });
    assert.equal(requests, 2, 'moving the viewport must invalidate the previous area');
    await searchLocationPage('도토리카페', { bounds, excludedIds: first.excludedIds, cache: true });
    assert.equal(requests, 3, 'pagination must not reuse the first page');
  } finally { globalThis.fetch = original; }
});

test('superseded map searches abort the active Nominatim request without starting fallbacks', async () => {
  const original = globalThis.fetch;
  const controller = new AbortController();
  let requests = 0;
  globalThis.fetch = async (_url, options) => {
    requests += 1;
    return new Promise<Response>((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(options.signal?.reason), { once: true });
    });
  };
  try {
    const search = searchLocationPage('검색취소검증', {
      bounds: { west: 126.97, east: 126.98, south: 37.56, north: 37.57 },
      cache: true, signal: controller.signal,
    });
    controller.abort();
    await assert.rejects(search, { name: 'AbortError' });
    assert.equal(requests, 1, 'an aborted request must not retry nationwide or hit Overpass');
  } finally { globalThis.fetch = original; }
});


test('map CGV search finds a genuinely brand-tagged cinema without inventing a POI', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes('overpass-api')) return new Response(JSON.stringify({ elements: [
      { type: 'node', id: 1, lat: 37.535, lon: 127.095, tags: { name: '씨지브이 강변', brand: 'CGV', 'addr:street': '강변역로' } },
      { type: 'node', id: 2, lat: 35.1, lon: 129.0, tags: { name: 'CGV 다른 지역', brand: 'CGV' } },
    ] }));
    return new Response(JSON.stringify([]));
  };
  try {
    const page = await searchLocationPage('cgv', { bounds: {
      west: 127.08, east: 127.10, south: 37.53, north: 37.54,
    } });
    assert.equal(page.results.length, 1);
    assert.equal(page.results[0].placeName, 'CGV · 씨지브이 강변');
    assert.equal(page.results[0].address, '강변역로');
  } finally { globalThis.fetch = original; }
});

test('CGV results from Seoul city center cannot appear inside a Gangbyeon live viewport', () => {
  const seoulCityHall = { west: 126.97, south: 37.56, east: 126.99, north: 37.57 };
  const gangbyeon = { west: 127.07, south: 37.52, east: 127.11, north: 37.55 };
  const data = [
    { latitude: 37.563, longitude: 126.985, placeName: 'CGV 명동', address: '서울 중구 명동' },
    { latitude: 37.535, longitude: 127.095, placeName: 'CGV 강변', address: '서울 광진구 구의동' },
  ];
  assert.equal(sameMapBounds(seoulCityHall, gangbyeon), false);
  assert.equal(sameMapBounds(gangbyeon, { ...gangbyeon, west: gangbyeon.west + 0.00005 }), true);
  assert.deepEqual(data.filter((item) => insideMapBounds(item, gangbyeon)).map((item) => item.placeName), ['CGV 강변']);
  assert.deepEqual(data.filter((item) => insideMapBounds(item, seoulCityHall)).map((item) => item.placeName), ['CGV 명동']);
});

test('map host and date map use a correlated live viewport protocol rather than cached bounds for a new search', () => {
  // This is the critical cross-iframe contract: a matching reply has to be
  // returned before any provider requests begin.
  const host = readFileSync('public/naver-map-host.html', 'utf8');
  const parent = readFileSync('src/components/location/DateMapPage.tsx', 'utf8');
  assert.match(host, /type === 'request-viewport'[\s\S]*?send\('viewport-snapshot'/);
  assert.match(parent, /await readLiveViewport\(\)/);
  assert.match(parent, /pending\.id === event\.data\.requestId/);
  assert.match(parent, /results\.filter\(\(item\) => insideMapBounds\(item, bounds\)\)/);
});
