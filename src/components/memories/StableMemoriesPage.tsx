import type React from 'react';
import type { Memory, MemoryDraft } from '../../types';
import { MemoriesPage, type HubTabId } from './MemoriesPage';

export type { HubTabId } from './MemoriesPage';

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
  return <MemoriesPage requestedTab={requestedTab} {...props} />;
}
