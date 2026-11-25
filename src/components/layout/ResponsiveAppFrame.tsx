import type { ReactNode } from 'react';
import { Capacitor } from '@capacitor/core';
import { isDesktopNavigation } from '../../utils/navigationPlatform';

/** Shared shell for Web, Android and iOS. Expanded window geometry is owned
 * solely by adaptive-window.css so desktop utility widths cannot fight it.
 */
export function ResponsiveAppFrame({ children }: { children: ReactNode }) {
  const desktopNavigation = typeof navigator !== 'undefined' && isDesktopNavigation({
    nativePlatform: Capacitor.getPlatform(),
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    maxTouchPoints: navigator.maxTouchPoints,
  });
  return (
    <div data-route-desktop={desktopNavigation ? 'true' : undefined} className="route-responsive-root min-h-dvh w-full min-w-0 overflow-x-clip bg-[var(--background)]
      [&_.app-shell]:!relative [&_.app-shell]:!mx-auto [&_.app-shell]:!min-h-dvh [&_.app-shell]:!w-full [&_.app-shell]:!max-w-none [&_.app-shell]:!overflow-x-clip [&_.app-shell]:!shadow-none
      [&_.app-shell>main]:!min-w-0
      [&_.page]:!mx-auto [&_.page]:!w-full [&_.page]:!min-w-0 [&_.page]:!max-w-none [&_.page:not(.chat-page)]:!px-4
      sm:[&_.page:not(.chat-page)]:!px-5 md:[&_.page:not(.chat-page)]:!px-6
      [&_.full-page]:!w-full [&_.full-page]:!min-w-0
      [&_.home-page]:!max-w-none [&_.chat-page]:!mx-auto [&_.chat-page]:!w-full [&_.chat-page]:!min-w-0">
      {children}
    </div>
  );
}
