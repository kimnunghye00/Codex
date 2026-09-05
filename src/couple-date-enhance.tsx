import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CalendarDays, Heart } from 'lucide-react';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import { auth, db } from './lib/firebase';
import { getRealCoupleConnection } from './lib/coupleConnection';

type Schedule = { id: string; title: string; date: string; startTime: string; type: 'personal' | 'couple'; location?: string; memo?: string };

function SharedPlans() {
  const [items, setItems] = useState<Schedule[]>([]);

  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    let unsubscribe: (() => void) | undefined;
    void getRealCoupleConnection(uid).then((connection) => {
      if (!connection?.coupleId) return;
      const q = query(collection(db, 'couples', connection.coupleId, 'schedules'), orderBy('date', 'asc'));
      unsubscribe = onSnapshot(q, (snapshot) => {
        setItems(snapshot.docs.map((doc) => ({ id: doc.id, ...(doc.data() as Omit<Schedule, 'id'>) })).filter((item) => item.type === 'couple'));
      });
    });
    return () => unsubscribe?.();
  }, []);

  if (!items.length) return <div className="memory-empty route-shared-plan-empty">아직 함께 잡은 약속이 없어요.</div>;
  return <div className="route-shared-plan-list">{items.map((item) => <article key={item.id} className="hub-list-row date-row route-shared-plan-row"><Heart size={17} /><div><b>{item.title}</b><small>{item.date.replaceAll('-', '.')} · {item.startTime}{item.location ? ` · ${item.location}` : ''}</small>{item.memo && <em>{item.memo}</em>}</div><span>함께</span></article>)}</div>;
}

function replaceText() {
  document.querySelectorAll<HTMLElement>('.hub-tabs button, .more-service-grid button b').forEach((node) => {
    if (node.textContent?.trim() === '데이트') node.textContent = '둘의 약속';
  });
  document.querySelectorAll<HTMLElement>('.hub-head h1, .hub-section-head h2').forEach((node) => {
    if (node.textContent?.trim() === '데이트') node.textContent = '둘의 약속';
  });
  document.querySelectorAll<HTMLInputElement>('input[placeholder="예: 저녁 데이트"]').forEach((input) => { input.placeholder = '예: 저녁 약속'; });
  document.querySelectorAll<HTMLElement>('.schedule-type-picker button').forEach((button) => {
    if (button.textContent?.trim() === '우리 일정') button.lastChild && (button.lastChild.textContent = '둘의 약속');
  });
}

function hideSharedFromScheduleTab() {
  const title = document.querySelector<HTMLElement>('.hub-head h1')?.textContent?.trim();
  if (title !== '일정') return;
  document.querySelectorAll<HTMLElement>('.hub-list-row').forEach((row) => {
    const badge = row.querySelector<HTMLElement>(':scope > span:last-child');
    if (badge?.textContent?.trim() === '우리') row.style.display = 'none';
  });
}

function mountSharedPlans() {
  const title = document.querySelector<HTMLElement>('.hub-head h1')?.textContent?.trim();
  if (title !== '둘의 약속') return;
  const stack = document.querySelector<HTMLElement>('.route-hub .hub-stack');
  if (!stack || stack.querySelector('.route-shared-plan-root')) return;

  const marker = document.createElement('div');
  marker.className = 'route-shared-plan-heading';
  marker.innerHTML = '<span><b>함께 잡은 약속</b><small>홈에서 “둘의 약속”으로 추가한 일정</small></span>';
  const root = document.createElement('div');
  root.className = 'route-shared-plan-root';
  const firstList = stack.querySelector('.hub-list-row, .memory-empty');
  if (firstList) firstList.insertAdjacentElement('beforebegin', marker);
  else stack.append(marker);
  marker.insertAdjacentElement('afterend', root);
  createRoot(root).render(<SharedPlans />);
}

function enhance() {
  replaceText();
  hideSharedFromScheduleTab();
  mountSharedPlans();
}

enhance();
const observer = new MutationObserver(enhance);
observer.observe(document.documentElement, { childList: true, subtree: true });

void CalendarDays;
