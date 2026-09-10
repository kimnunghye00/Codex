import type { ReactNode } from 'react';

/**
 * One layout contract for Web, Android WebView and iOS WebView.
 *
 * Mobile stays edge-to-edge so mobile web and the installed app share the same
 * geometry. Desktop keeps the same React pages, but uses a wider workspace and
 * reserves room for the responsive navigation rail instead of stretching a
 * tablet-shaped shell across the browser.
 */
export function ResponsiveAppFrame({ children }: { children: ReactNode }) {
  return (
    <div
      className="route-responsive-root min-h-dvh w-full min-w-0 overflow-x-clip bg-[var(--background)]
        [&_.app-shell]:!relative [&_.app-shell]:!mx-auto [&_.app-shell]:!min-h-dvh [&_.app-shell]:!w-full [&_.app-shell]:!max-w-none [&_.app-shell]:!overflow-x-clip [&_.app-shell]:!shadow-none
        lg:[&_.app-shell]:!max-w-[1320px] lg:[&_.app-shell]:!border-x lg:[&_.app-shell]:!border-[var(--border)]
        [&_.app-shell>main]:!min-w-0 lg:[&_.app-shell>main]:!pb-0
        [&_.page]:!mx-auto [&_.page]:!w-full [&_.page]:!min-w-0 [&_.page]:!max-w-none [&_.page]:!px-4
        sm:[&_.page]:!px-5 md:[&_.page]:!px-6 lg:[&_.page]:!px-8 lg:[&_.page]:!pl-28
        [&_.full-page]:!w-full [&_.full-page]:!min-w-0 lg:[&_.full-page]:!h-dvh
        [&_.home-page]:!max-w-none lg:[&_.home-page]:!h-dvh lg:[&_.home-page]:!max-h-dvh lg:[&_.home-page]:!min-h-0 lg:[&_.home-page]:!max-w-[1240px] lg:[&_.home-page]:!overflow-hidden
        lg:[&_.home-dashboard]:!grid-rows-[72px_clamp(54px,6.5dvh,62px)_clamp(108px,13dvh,122px)_clamp(116px,14dvh,130px)_minmax(96px,1fr)_clamp(78px,9dvh,88px)]
        lg:[&_.home-map-card]:!min-h-0 lg:[&_.home-map-card]:!h-full
        lg:[&_.home-couple-profile-card]:!min-h-0 lg:[&_.home-couple-profile-card]:!h-full lg:[&_.home-couple-profile-card]:!grid-cols-[minmax(0,1fr)_28px_minmax(0,1fr)] lg:[&_.home-couple-profile-card]:!px-4
        lg:[&_.home-profile-avatar]:!size-8 lg:[&_.home-profile-copy_b]:!text-[10px]
        lg:[&_.home-time-card]:!min-h-0 lg:[&_.home-time-card]:!h-full lg:[&_.home-time-card]:!overflow-hidden
        lg:[&_.home-schedule-card]:!min-h-0 lg:[&_.home-schedule-card]:!h-full lg:[&_.home-schedule-card]:!overflow-hidden
        lg:[&_.home-photo-card]:!min-h-0 lg:[&_.home-photo-card]:!h-full
        lg:[&_.home-chat-card]:!min-h-0 lg:[&_.home-chat-card]:!h-full
        lg:[&_.memories-page]:!max-w-[1160px]
        lg:[&_.location-page]:!max-w-[1240px]
        lg:[&_.more-page]:!max-w-[1160px]
        [&_.chat-page]:!mx-auto [&_.chat-page]:!w-full [&_.chat-page]:!min-w-0 lg:[&_.chat-page]:!max-w-[980px]"
    >
      {children}
    </div>
  );
}
