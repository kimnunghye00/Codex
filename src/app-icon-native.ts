import { Capacitor, registerPlugin } from '@capacitor/core';
import type { RouteAppIconId } from './utils/appIcon';

type IconId = RouteAppIconId;
type RouteAppIconPlugin = {
  setIcon(options: { icon: IconId }): Promise<{ icon: IconId; pending?: boolean }>;
  getIcon(): Promise<{ icon: IconId; component?: string | null }>;
};

const RouteAppIcon = registerPlugin<RouteAppIconPlugin>('RouteAppIcon');

function notifyIcon(icon: IconId) {
  localStorage.setItem('route-app-icon', icon);
  window.dispatchEvent(new CustomEvent<IconId>('route-app-icon-changed', { detail: icon }));
}

export function supportsNativeRouteAppIcon() {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
}

export async function getNativeRouteAppIcon(): Promise<IconId | null> {
  if (!supportsNativeRouteAppIcon()) return null;
  const result = await RouteAppIcon.getIcon();
  notifyIcon(result.icon);
  return result.icon;
}

export async function setNativeRouteAppIcon(icon: IconId): Promise<IconId> {
  if (!supportsNativeRouteAppIcon()) return icon;
  const result = await RouteAppIcon.setIcon({ icon });
  // Android completes the launcher-component replacement after moving the task to the Home screen.
  // Do not immediately call getIcon(): during that short overlap both launcher
  // components intentionally exist so Samsung can observe the replacement.
  notifyIcon(result.icon);
  return result.icon;
}

if (supportsNativeRouteAppIcon()) {
  void getNativeRouteAppIcon().catch((cause) => {
    console.warn('[DANDULI app icon state]', cause);
  });
}
