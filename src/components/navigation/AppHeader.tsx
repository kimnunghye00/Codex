import { Bell, Settings } from 'lucide-react';
import { Wordmark } from '../auth/AuthFlow';

export function AppHeader({ title, onSettings, onNotifications, unreadCount }: {
  title?: string;
  onSettings: () => void;
  onNotifications: () => void;
  unreadCount: number;
}) {
  return <header className="topbar mx-auto !flex h-[76px] w-full min-w-0 max-w-[1500px] !items-center !justify-between gap-3 lg:h-[72px]">
    <div className="brand !flex min-w-0 !items-center gap-3 sm:gap-3.5">
      <Wordmark />
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
