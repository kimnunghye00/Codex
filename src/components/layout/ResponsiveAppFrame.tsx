import type { ReactNode } from 'react';

/**
 * One layout contract for Web, Android WebView and iOS WebView.
 *
 * Mobile keeps the app edge-to-edge so mobile web and the installed app share
 * the same geometry. Wider screens progressively expand the same React pages
 * instead of rendering a separate desktop or phone-preview implementation.
 */
export function ResponsiveAppFrame({ children }: { children: ReactNode }) {
  return (
    <div
      className="route-responsive-root min-h-dvh w-full min-w-0 overflow-x-clip bg-[var(--background)]
        [&_.app-shell]:!relative [&_.app-shell]:!mx-auto [&_.app-shell]:!min-h-dvh [&_.app-shell]:!w-full [&_.app-shell]:!max-w-none [&_.app-shell]:!overflow-x-clip [&_.app-shell]:!shadow-none
        md:[&_.app-shell]:!max-w-[960px] md:[&_.app-shell]:!border-x md:[&_.app-shell]:!border-[var(--border)] xl:[&_.app-shell]:!max-w-[1440px]
        [&_.page]:!mx-auto [&_.page]:!w-full [&_.page]:!min-w-0 [&_.page]:!max-w-none [&_.page]:!px-4
        sm:[&_.page]:!px-5 md:[&_.page]:!px-6 lg:[&_.page]:!max-w-[1280px] lg:[&_.page]:!px-8 xl:[&_.page]:!px-10
        [&_.full-page]:!w-full [&_.full-page]:!min-w-0
        [&_.chat-page]:!mx-auto [&_.chat-page]:!w-full [&_.chat-page]:!min-w-0 lg:[&_.chat-page]:!max-w-[1180px]"
    >
      {children}
    </div>
  );
}
