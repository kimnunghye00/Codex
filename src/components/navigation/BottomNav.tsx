import { Ellipsis, Home, Image, MapPinned, MessageCircle } from 'lucide-react';

export type AppTab = 'home' | 'chat' | 'memories' | 'location' | 'anniversary' | 'more';

const ITEMS: [AppTab, string, typeof Home][] = [
  ['home', '홈', Home],
  ['memories', '추억', Image],
  ['chat', '대화', MessageCircle],
  ['location', '지도', MapPinned],
  ['more', '더보기', Ellipsis],
];

export function BottomNav({ tab, onNavigate }: { tab: AppTab; onNavigate: (tab: AppTab) => void }) {
  return <nav className="bottom-nav" aria-label="주요 메뉴">
    {ITEMS.map(([id, label, Icon]) => <button key={id} className={tab === id ? 'active' : ''} onClick={() => onNavigate(id)} aria-current={tab === id ? 'page' : undefined}>
      <span className="nav-icon"><Icon size={21} strokeWidth={tab === id ? 2.4 : 1.8} /></span>
      <span>{label}</span>
    </button>)}
  </nav>;
}
