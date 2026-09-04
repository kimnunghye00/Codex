function clickFirst(selectors: string[]) {
  for (const selector of selectors) {
    const button = document.querySelector<HTMLButtonElement>(selector);
    if (button) { button.click(); return true; }
  }
  return false;
}

window.addEventListener('route-native-back', (event) => {
  if (event.defaultPrevented) return;

  // Close the most specific/innermost UI first. This listener is loaded before React,
  // so Android back is consumed before the root tab history gets a chance to move.
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
    '.detail-menu > div ~ button',
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
  }
});
