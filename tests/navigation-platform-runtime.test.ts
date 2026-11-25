import test from 'node:test';
import assert from 'node:assert/strict';
import { isDesktopNavigation, supportsTabletWorkspace } from '../src/utils/navigationPlatform.ts';

test('Windows, Mac and Linux use desktop bottom navigation', () => {
  assert.equal(isDesktopNavigation({ platform: 'Win32', userAgent: 'Windows NT 10.0', maxTouchPoints: 10 }), true);
  assert.equal(isDesktopNavigation({ platform: 'MacIntel', userAgent: 'Macintosh', maxTouchPoints: 0 }), true);
  assert.equal(isDesktopNavigation({ platform: 'Linux x86_64', userAgent: 'X11; Linux x86_64' }), true);
  assert.equal(isDesktopNavigation({ userAgent: 'CrOS x86_64' }), true);
});

test('Android, iPadOS and iOS stay on the adaptive mobile layout', () => {
  assert.equal(isDesktopNavigation({ platform: 'Linux armv8l', userAgent: 'Android 15; Tablet' }), false);
  assert.equal(isDesktopNavigation({ platform: 'MacIntel', userAgent: 'Macintosh', maxTouchPoints: 5 }), false);
  assert.equal(isDesktopNavigation({ userAgent: 'iPhone; Mobile' }), false);
  assert.equal(isDesktopNavigation({ nativePlatform: 'android', userAgent: 'X11; Linux x86_64' }), false);
  assert.equal(isDesktopNavigation({ nativePlatform: 'ios', platform: 'MacIntel' }), false);
});

test('tablet workspace uses available width and excludes desktop', () => {
  for (const width of [320, 599, 600, 768, 839]) assert.equal(supportsTabletWorkspace(width, false), false);
  for (const width of [840, 1024, 1366]) assert.equal(supportsTabletWorkspace(width, false), true);
  assert.equal(supportsTabletWorkspace(1440, true), false);
});
