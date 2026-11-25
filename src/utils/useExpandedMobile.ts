import { useSyncExternalStore } from 'react';
import { Capacitor } from '@capacitor/core';
import { isDesktopNavigation, supportsTabletWorkspace } from './navigationPlatform';

/** Use available CSS pixels, not device model: cover screen and split window
 * fall back to compact UI without resetting the current feature state. */
export function supportsExpandedMobile(width: number, desktop: boolean): boolean {
  return !desktop && width >= 600;
}
function isMobileWindow(): boolean {
  if (typeof window === 'undefined') return false;
  const desktop = isDesktopNavigation({ nativePlatform: Capacitor.getPlatform(), userAgent: navigator.userAgent, platform: navigator.platform, maxTouchPoints: navigator.maxTouchPoints });
  return !desktop;
}
function snapshot(): boolean {
  return typeof window !== 'undefined' && supportsExpandedMobile(window.innerWidth, !isMobileWindow());
}
function tabletSnapshot(): boolean {
  return typeof window !== 'undefined' && supportsTabletWorkspace(window.innerWidth, !isMobileWindow());
}
function subscribe(callback: () => void) {
  window.addEventListener('resize', callback);
  window.visualViewport?.addEventListener('resize', callback);
  return () => {
    window.removeEventListener('resize', callback);
    window.visualViewport?.removeEventListener('resize', callback);
  };
}
export function useExpandedMobile() {
  return useSyncExternalStore(subscribe, snapshot, () => false);
}

export function useTabletWorkspace() {
  return useSyncExternalStore(subscribe, tabletSnapshot, () => false);
}
