import { Bell, Settings } from 'lucide-react';
import { Wordmark } from '../auth/AuthFlow';

export function AppHeader({ title, onSettings, onNotifications, unreadCount }: {
  title?: string;
  onSettings: () => void;
  onNotifications: () => void;
  unreadCount: number;
}) {
  return <header className="topbar mx-auto !flex !h-auto !min-h-[calc(58px+max(10px,env(safe-area-inset-top)))] w-full min-w-0 !items-center !justify-between gap-3 !pt-[max(10px,env(safe-area-inset-top))] !pb-2 md:!h-[72px] md:!min-h-[72px] md:!py-0">
    <div className="brand !flex min-w-0 !items-center gap-3 sm:gap-3.5">
      <button
        type="button"
        className="route-home-logo !m-0 !min-h-11 !border-0 !bg-transparent !p-0 text-left cursor-pointer"
        aria-label="홈으로 이동"
        title="홈으로 이동"
        onClick={() => window.dispatchEvent(new CustomEvent('route-home-request'))}
      >
        <Wordmark />
      </button>
      {title && <span className="page-title !flex min-h-[26px] min-w-0 !items-center border-l border-[var(--border)] pl-3 text-[18px] font-bold leading-none sm:pl-3.5">{title}</span>}
    </div>
    <div className="header-actions !flex shrink-0 !items-center gap-0.5">
      <button className="notification-button relative !grid !size-11 !min-h-11 !min-w-11 place-items-center" aria-label={`알림 ${unreadCount ? `${unreadCount}개` : ''}`} onClick={onNotifications}>
        <Bell size={20} />
        {unreadCount > 0 && <em className="notification-count">{unreadCount > 99 ? '99+' : unreadCount}</em>}
      </button>
      <button className="!grid !size-11 !min-h-11 !min-w-11 place-items-center" aria-label="설정" onClick={onSettings}><Settings size={20} /></button>
    </div>
  </header>;
}
