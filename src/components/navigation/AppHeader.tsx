import { Bell, Settings } from 'lucide-react';
import { Wordmark } from '../auth/AuthFlow';

export function AppHeader({ title, onSettings, onNotifications, unreadCount }: {
  title?: string;
  onSettings: () => void;
  onNotifications: () => void;
  unreadCount: number;
}) {
  return <header className="topbar">
    <div className="brand"><Wordmark />{title && <span className="page-title">{title}</span>}</div>
    <div className="header-actions">
      <button className="notification-button" aria-label={`알림 ${unreadCount ? `${unreadCount}개` : ''}`} onClick={onNotifications}>
        <Bell size={20} />
        {unreadCount > 0 && <em className="notification-count">{unreadCount > 99 ? '99+' : unreadCount}</em>}
      </button>
      <button aria-label="설정" onClick={onSettings}><Settings size={20} /></button>
    </div>
  </header>;
}
