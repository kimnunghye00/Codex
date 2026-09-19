import test from 'node:test';
import assert from 'node:assert/strict';
import { searchLocation, searchLocations } from '../src/utils/location.ts';

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
    assert.match(requestUrl, /limit=15/);
    assert.match(requestUrl, /countrycodes=kr/);
    const legacy = await searchLocation('이재모피자');
    assert.equal(legacy?.latitude, branches[0].latitude);
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
