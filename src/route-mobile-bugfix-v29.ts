const HUB_DEFAULT_ORDER = ['앨범', '기념일', '기록', '티어', '일정', '데이트'];
const originalScrollIntoView = Element.prototype.scrollIntoView;

function installChatScrollGuard() {
  if (document.documentElement.dataset.routeChatScrollGuard === '1') return;
  document.documentElement.dataset.routeChatScrollGuard = '1';

  const markIntent = (event: Event) => {
    const target = event.target instanceof Element ? event.target.closest('.chat-page .messages') as HTMLElement | null : null;
    if (!target) return;
    const distance = target.scrollHeight - target.scrollTop - target.clientHeight;
    target.dataset.routeUserAwayFromBottom = distance > 96 ? '1' : '0';
  };

  document.addEventListener('touchmove', markIntent, { passive: true, capture: true });
  document.addEventListener('wheel', markIntent, { passive: true, capture: true });
  document.addEventListener('pointerup', markIntent, { passive: true, capture: true });

  Element.prototype.scrollIntoView = function routeGuardedScrollIntoView(arg?: boolean | ScrollIntoViewOptions) {
    const parent = this.parentElement?.closest('.chat-page .messages') as HTMLElement | null;
    if (parent?.dataset.routeUserAwayFromBottom === '1') return;
    return originalScrollIntoView.call(this, arg as ScrollIntoViewOptions);
  };
}

function labels(panel: HTMLElement) {
  return Array.from(panel.querySelectorAll<HTMLElement>('.hub-order-row b')).map((item) => item.textContent?.trim() || '');
}

function resetHubOrder(panel: HTMLElement) {
  let attempts = 0;
  const step = () => {
    if (!panel.isConnected || attempts++ > 60) return;
    const current = labels(panel);
    const mismatch = HUB_DEFAULT_ORDER.findIndex((label, index) => current[index] !== label);
    if (mismatch < 0) return;
    const desiredIndex = current.indexOf(HUB_DEFAULT_ORDER[mismatch]);
    if (desiredIndex <= mismatch) return;
    const rows = Array.from(panel.querySelectorAll<HTMLElement>('.hub-order-row'));
    const upButton = rows[desiredIndex]?.querySelector<HTMLButtonElement>('span button:first-child');
    if (!upButton || upButton.disabled) return;
    upButton.click();
    window.setTimeout(step, 20);
  };
  step();
}

function wireHubOrderPanel(panel: HTMLElement) {
  if (panel.dataset.routeFixedFooter === '1') return;
  const rows = panel.querySelectorAll('.hub-order-row');
  if (!rows.length) return;
  panel.dataset.routeFixedFooter = '1';
  panel.classList.add('route-order-fixed-shell');

  const footer = document.createElement('footer');
  footer.className = 'route-hub-order-footer';

  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'route-hub-order-reset';
  reset.textContent = '기본 순서';
  reset.addEventListener('click', () => resetHubOrder(panel));

  const done = document.createElement('button');
  done.type = 'button';
  done.className = 'route-hub-order-done';
  done.textContent = '완료';
  done.addEventListener('click', () => panel.querySelector<HTMLButtonElement>('header > button')?.click());

  footer.append(reset, done);
  panel.appendChild(footer);
}

function installHubOrderFix() {
  const scan = () => document.querySelectorAll<HTMLElement>('.hub-order-panel').forEach(wireHubOrderPanel);
  scan();
  const observer = new MutationObserver(scan);
  observer.observe(document.body, { childList: true, subtree: true });
}

export function installRouteMobileBugfixV29() {
  installChatScrollGuard();
  installHubOrderFix();
}
