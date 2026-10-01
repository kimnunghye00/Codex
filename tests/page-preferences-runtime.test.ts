import assert from 'node:assert/strict';
import test from 'node:test';
import { loadDateMapPreferences, loadHomePagePreferences, savePagePreferences } from '../src/utils/pagePreferences.ts';

test('page preferences persist independently for each account and page', () => {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  } });
  const home = { anniversaries: false, schedules: true, memories: false };
  const map = { searchScope: 'nationwide' as const, numbered: false, connectStops: true };
  assert.equal(savePagePreferences('account-a', 'home', home), true);
  assert.equal(savePagePreferences('account-a', 'map', map), true);
  assert.deepEqual(loadHomePagePreferences('account-a'), home);
  assert.deepEqual(loadDateMapPreferences('account-a'), map);
  assert.deepEqual(loadHomePagePreferences('account-b'), { anniversaries: true, schedules: true, memories: true });
  assert.deepEqual(loadDateMapPreferences('account-b'), { searchScope: 'map', numbered: true, connectStops: true });
  values.set('danduli-page-preferences:account-a:home', '{broken');
  assert.deepEqual(loadHomePagePreferences('account-a'), loadHomePagePreferences('account-b'));
  values.set('danduli-page-preferences:account-a:map', JSON.stringify({ searchScope: 'invalid', numbered: 'false', connectStops: false }));
  assert.deepEqual(loadDateMapPreferences('account-a'), { searchScope: 'map', numbered: true, connectStops: false });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('full'); },
  } });
  assert.equal(savePagePreferences('account-a', 'home', home), false);
  assert.deepEqual(loadDateMapPreferences('account-a'), { searchScope: 'map', numbered: true, connectStops: true });
});
