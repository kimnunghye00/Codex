import { vi } from 'vitest';
vi.stubGlobal('window', { setTimeout, clearTimeout, dispatchEvent: () => true, addEventListener: () => {}, removeEventListener: () => {} });
vi.stubGlobal('document', { addEventListener: () => {}, removeEventListener: () => {}, visibilityState: 'visible' });
