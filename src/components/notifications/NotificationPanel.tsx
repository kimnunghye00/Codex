import { Bell, CheckCheck, MessageCircle, Heart, Image, UserRound, X } from 'lucide-react';
import type { AppNotification } from '../../utils/notifications';

const iconFor = (kind: AppNotification['kind']) => {
  if (kind === 'chat') return <MessageCircle size={17} />;
  if (kind === 'memory') return <Image size={17} />;
  if (kind === 'profile') return <UserRound size={17} />;
  if (kind === 'couple') return <Heart size={17} />;
  return <Bell size={17} />;
};

function timeLabel(value: string) {
  const date = new Date(value);
  const diff = Date.now() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return '방금 전';
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  return `${date.getMonth() + 1}월 ${date.getDate()}일`;
}

export function NotificationPanel({ items, onClose, onReadAll, onClear }: {
  items: AppNotification[];
  onClose: () => void;
  onReadAll: () => void;
  onClear: () => void;
}) {
  return <div className="notification-backdrop" role="dialog" aria-modal="true" aria-label="MELUNI 알림">
    <section className="notification-panel">
      <header>
        <div><small>ACTIVITY</small><h2>알림</h2><p>두 사람이 MELUNI에서 한 활동만 보여줘요. 휴대폰 알림은 보내지 않아요.</p></div>
        <button className="notification-close" onClick={onClose} aria-label="닫기"><X /></button>
      </header>
      <div className="notification-actions">
        <button onClick={onReadAll}><CheckCheck size={15} />모두 읽음</button>
        <button onClick={onClear}>전체 삭제</button>
      </div>
      <div className="notification-list">
        {!items.length && <div className="notification-empty"><Bell size={24} /><strong>아직 알림이 없어요</strong><span>채팅, 프로필, 추억 등의 활동이 여기에 쌓여요.</span></div>}
        {items.map((item) => <article key={item.id} className={item.read ? '' : 'unread'}>
          <span className={`notification-icon ${item.actor}`}>{iconFor(item.kind)}</span>
          <div><div><strong>{item.title}</strong><time>{timeLabel(item.createdAt)}</time></div>{item.detail && <p>{item.detail}</p>}<small>{item.actor === 'me' ? '나' : item.actor === 'partner' ? '상대방' : 'MELUNI'}</small></div>
        </article>)}
      </div>
    </section>
  </div>;
}
