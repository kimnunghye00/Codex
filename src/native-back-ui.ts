import { isNativePlatform } from './lib/native';

type LocalTabHistory = { scope: 'hub' | 'location'; label: string };
const localTabHistory: LocalTabHistory[] = [];
const MAX_LOCAL_TAB_HISTORY = 30;

function rememberLocalTab(entry: LocalTabHistory) {
  localTabHistory.push(entry);
  if (localTabHistory.length > MAX_LOCAL_TAB_HISTORY) {
    localTabHistory.splice(0, localTabHistory.length - MAX_LOCAL_TAB_HISTORY);
  }
}

function clickFirst(selectors: string[]) {
  for (const selector of selectors) {
    const button = document.querySelector<HTMLButtonElement>(selector);
    if (button) { button.click(); return true; }
  }
  return false;
}

function restorePreviousLocalTab() {
  const scope: LocalTabHistory['scope'] | null = document.querySelector('.hub-tabs') ? 'hub' : document.querySelector('.location-tabs') ? 'location' : null;
  if (!scope) return false;
  for (let index = localTabHistory.length - 1; index >= 0; index -= 1) {
    const entry = localTabHistory[index];
    if (entry.scope !== scope) continue;
    localTabHistory.splice(index, 1);
    const selector = scope === 'hub' ? '.hub-tabs button' : '.location-tabs button';
    const button = Array.from(document.querySelectorAll<HTMLButtonElement>(selector)).find((item) => item.textContent?.trim() === entry.label);
    if (button) { button.click(); return true; }
  }
  return false;
}

function installNativeBackUi() {
  if (!isNativePlatform()) return;
  if (document.documentElement.dataset.routeNativeBackUi === '1') return;
  document.documentElement.dataset.routeNativeBackUi = '1';

  // Remember only real user tab changes. Programmatic navigation from More is
  // intentionally ignored so Back returns to More instead of a hidden tab.
  document.addEventListener('click', (event) => {
    if (!event.isTrusted) return;
    const target = event.target as Element | null;
    const hubButton = target?.closest<HTMLButtonElement>('.hub-tabs button');
    if (hubButton && !hubButton.classList.contains('active')) {
      const current = document.querySelector<HTMLButtonElement>('.hub-tabs button.active');
      if (current?.textContent?.trim()) rememberLocalTab({ scope: 'hub', label: current.textContent.trim() });
      return;
    }
    const locationButton = target?.closest<HTMLButtonElement>('.location-tabs button');
    if (locationButton && !locationButton.classList.contains('active')) {
      const current = document.querySelector<HTMLButtonElement>('.location-tabs button.active');
      if (current?.textContent?.trim()) rememberLocalTab({ scope: 'location', label: current.textContent.trim() });
    }
  }, true);

  window.addEventListener('route-native-back', (event) => {
    if (event.defaultPrevented) return;

    const handled = clickFirst([
      '.confirm-backdrop .confirm-dialog button:not(.danger)',
      '.more-sheet-backdrop .more-sheet-head button[aria-label="닫기"]',
      '.lightbox[role="dialog"] button[aria-label="닫기"]',
      '.chat-tools-backdrop .chat-tools-back',
      '.chat-tools-backdrop .chat-tools-close',
      '.chat-extra-backdrop .chat-extra-close',
      '.chat-extra-backdrop .call-end',
      '.hub-order-backdrop .hub-order-panel > header > button',
      '[role="dialog"] button[aria-label="닫기"]',
    ]);

    if (handled) {
      event.preventDefault();
      return;
    }

    const memoryMenu = document.querySelector('.memory-detail .detail-menu > div');
    if (memoryMenu) {
      document.querySelector<HTMLButtonElement>('.memory-detail .detail-menu > button[aria-label="추억 메뉴"]')?.click();
      event.preventDefault();
      return;
    }

    const memoryDetail = document.querySelector('.memory-detail');
    if (memoryDetail) {
      document.querySelector<HTMLButtonElement>('.memory-detail button[aria-label="목록으로"]')?.click();
      event.preventDefault();
      return;
    }

    if (restorePreviousLocalTab()) event.preventDefault();
  });
}

installNativeBackUi();
