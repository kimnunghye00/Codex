import { useEffect } from 'react';
import type React from 'react';
import type { Memory, MemoryDraft } from '../../types';
import { MemoriesPage } from './MemoriesPage';

export type HubTabId = 'album' | 'anniversary' | 'record' | 'tier' | 'schedule' | 'date';

const HUB_TAB_INDEX: Record<HubTabId, number> = {
  album: 0,
  anniversary: 1,
  record: 2,
  tier: 3,
  schedule: 4,
  date: 5,
};

export function StableMemoriesPage({ requestedTab, ...props }: {
  requestedTab?: HubTabId;
  Header: ({ title }: { title?: string }) => React.ReactNode;
  memories: Memory[];
  setMemories: React.Dispatch<React.SetStateAction<Memory[]>>;
  initialMemoryId?: number;
  initialDraft?: MemoryDraft;
  onClearInitial: () => void;
  onClearInitialDraft: () => void;
  onOpenLocation?: (place: string) => void;
}) {
  useEffect(() => {
    if (!requestedTab) return;
    const buttons = document.querySelectorAll<HTMLButtonElement>('.memories-page .hub-tabs button');
    buttons[HUB_TAB_INDEX[requestedTab]]?.click();
  }, [requestedTab]);

  return <MemoriesPage {...props} />;
}
