import { useEffect } from 'react';
import type React from 'react';
import type { MemoryDraft } from '../../types';
import type { RealCoupleConnection } from '../../lib/coupleConnection';
import { LocationPage } from './LocationPage';

export type LocationTabId = 'map' | 'footprints';

const LOCATION_TAB_INDEX: Record<LocationTabId, number> = { map: 0, footprints: 1 };

export function StableLocationPage({ requestedTab, ...props }: {
  requestedTab?: LocationTabId;
  Header: ({ title }: { title?: string }) => React.ReactNode;
  connection: RealCoupleConnection | null;
  focusPlace?: string;
  onClearFocus?: () => void;
  onCreateMemory?: (draft: MemoryDraft) => void;
  onActivity?: (title: string, detail?: string) => void;
}) {
  useEffect(() => {
    if (!requestedTab) return;
    const buttons = document.querySelectorAll<HTMLButtonElement>('.location-page .location-tabs button');
    buttons[LOCATION_TAB_INDEX[requestedTab]]?.click();
  }, [requestedTab]);

  return <LocationPage {...props} />;
}
