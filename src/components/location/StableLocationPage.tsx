import type React from 'react';
import type { MemoryDraft } from '../../types';
import type { RealCoupleConnection } from '../../lib/coupleConnection';
import { LocationPage, type LocationTabId } from './LocationPage';

export type { LocationTabId } from './LocationPage';

export function StableLocationPage({ requestedTab, ...props }: {
  requestedTab?: LocationTabId;
  Header: ({ title }: { title?: string }) => React.ReactNode;
  connection: RealCoupleConnection | null;
  focusPlace?: string;
  onClearFocus?: () => void;
  onCreateMemory?: (draft: MemoryDraft) => void;
  onActivity?: (title: string, detail?: string) => void;
}) {
  return <LocationPage requestedTab={requestedTab} {...props} />;
}
