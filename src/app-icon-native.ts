import { Capacitor, registerPlugin } from '@capacitor/core';
import type { RouteAppIconId } from './utils/appIcon';

type IconId = RouteAppIconId;
type RouteAppIconPlugin = {
  setIcon(options: { icon: IconId }): Promise<{ icon: IconId }>;
  getIcon(): Promise<{ icon: IconId }>;
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
  await RouteAppIcon.setIcon({ icon });
  const verified = await RouteAppIcon.getIcon();
  if (verified.icon !== icon) throw new Error(`ICON_STATE_MISMATCH:${icon}:${verified.icon}`);
  notifyIcon(verified.icon);
  return verified.icon;
}

if (supportsNativeRouteAppIcon()) {
  void getNativeRouteAppIcon().catch((cause) => {
    console.warn('[DANDULI app icon state]', cause);
  });
}
