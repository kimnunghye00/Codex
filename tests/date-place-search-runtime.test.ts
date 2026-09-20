import test from 'node:test';
import assert from 'node:assert/strict';
import { searchLocations, searchLocationPage } from '../src/utils/locationSearch.ts';

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
