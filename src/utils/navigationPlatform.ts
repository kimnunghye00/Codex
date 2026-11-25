/** Keep desktop navigation horizontal, including touchscreen laptops.
 * iPadOS desktop-class Safari reports MacIntel, so touch points distinguish
 * it from a Mac. Android/iOS native apps always use the adaptive mobile UI.
 */
export interface NavigationPlatformInfo {
  nativePlatform?: string;
  userAgent?: string;
  platform?: string;
  maxTouchPoints?: number;
}

export function isDesktopNavigation(info: NavigationPlatformInfo): boolean {
  if (info.nativePlatform === 'android' || info.nativePlatform === 'ios') return false;
  const ua = info.userAgent ?? '';
  const platform = info.platform ?? '';
  if (/Android|iPhone|iPad|iPod|Windows Phone|Mobile/i.test(ua)
      || /Android|iOS|iPhone|iPad|iPod/i.test(platform)) return false;
  if (/Mac/i.test(platform + ' ' + ua) && (info.maxTouchPoints ?? 0) > 1) return false;
  return /Windows|Win32|Win64|Mac|Linux|X11|CrOS|Chrome OS|FreeBSD|OpenBSD|NetBSD/i.test(platform + ' ' + ua);
}

/** A spacious tablet-class window is based on usable width, not a model name. */
export function supportsTabletWorkspace(width: number, desktop: boolean): boolean {
  return !desktop && width >= 840;
}
