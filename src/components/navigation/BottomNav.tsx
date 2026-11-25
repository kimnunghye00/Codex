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
  return <nav
    data-route-nav
    className="bottom-nav !fixed inset-x-0 bottom-0 z-50 mx-auto !flex h-[82px] w-full !max-w-none items-center border-t border-[var(--border)] bg-[var(--surface)] px-2 pt-1.5 pb-[max(8px,env(safe-area-inset-bottom))]
      md:bottom-3 md:h-16 md:!max-w-[760px] md:px-3 md:py-1.5"
    aria-label="주요 메뉴"
  >
    {ITEMS.map(([id, label, Icon]) => {
      const active = tab === id;
      return <button
        key={id}
        className={`${active ? 'active !text-[var(--accent-text)] !font-bold' : '!text-[var(--text-secondary)]'} !mx-auto !flex !min-h-14 !flex-1 !flex-col !items-center !justify-center !gap-1 !rounded-xl !bg-transparent !text-[10px] transition-transform active:scale-[.94] md:!min-h-[52px] md:!max-w-[150px]`}
        onClick={(event) => {
          if (active) return;
          onNavigate(id);
          if (event.detail > 0) {
            void import('../../lib/native').then(({ nativeImpact }) => nativeImpact()).catch(() => {});
          }
        }}
        aria-current={active ? 'page' : undefined}
      >
        <span className="nav-icon !grid !h-[31px] !w-[38px] place-items-center !bg-transparent">
          <Icon size={21} strokeWidth={active ? 2.4 : 1.8} />
        </span>
        <span className="leading-none">{label}</span>
      </button>;
    })}
  </nav>;
}
