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
    className="bottom-nav !fixed inset-x-0 bottom-0 z-50 mx-auto !flex h-[82px] w-full !max-w-none items-center border-t border-[var(--border)] bg-[color-mix(in_srgb,var(--surface)_94%,transparent)] px-2 pt-1.5 pb-[max(8px,env(safe-area-inset-bottom))] backdrop-blur-xl
      md:bottom-3 md:h-16 md:!max-w-[760px] md:rounded-[22px] md:border md:px-3 md:py-1.5 md:shadow-[0_14px_40px_rgba(31,42,68,.11)]
      lg:!right-auto lg:!top-1/2 lg:!bottom-auto lg:!left-[max(20px,calc((100vw-1320px)/2+20px))] lg:!h-auto lg:!w-[72px] lg:!max-w-none lg:!-translate-y-1/2 lg:!flex-col lg:!gap-1 lg:!rounded-[24px] lg:!border lg:!p-2 lg:!shadow-[0_16px_42px_rgba(31,42,68,.12)]"
    aria-label="주요 메뉴"
  >
    {ITEMS.map(([id, label, Icon]) => {
      const active = tab === id;
      return <button
        key={id}
        className={`${active ? 'active !text-[var(--primary)] !font-bold' : '!text-[#aaa8b2]'} !mx-auto !flex !min-h-14 !flex-1 !flex-col !items-center !justify-center !gap-1 !rounded-2xl !bg-transparent !text-[10px] transition-transform active:scale-[.94] md:!min-h-[52px] md:!max-w-[150px] lg:!min-h-[62px] lg:!w-full lg:!max-w-none lg:!flex-none`}
        onClick={() => onNavigate(id)}
        aria-current={active ? 'page' : undefined}
      >
        <span className={`${active ? '!bg-[var(--primary-soft)]' : '!bg-transparent'} nav-icon !grid !h-[31px] !w-[38px] place-items-center !rounded-xl`}>
          <Icon size={21} strokeWidth={active ? 2.4 : 1.8} />
        </span>
        <span className="leading-none">{label}</span>
      </button>;
    })}
  </nav>;
}
