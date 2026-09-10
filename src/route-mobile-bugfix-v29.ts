const HUB_DEFAULT_ORDER = ['앨범', '기념일', '기록', '티어', '일정', '약속'];
const originalScrollIntoView = Element.prototype.scrollIntoView;
const CHAT_WHEEL_LINE_PX = 56;
const CHAT_WHEEL_PAGE_RATIO = 0.82;

function findChatScroller(event: Event) {
  return event.target instanceof Element ? event.target.closest('.chat-page .messages') as HTMLElement | null : null;
}

function installChatScrollGuard() {
  if (document.documentElement.dataset.routeChatScrollGuard === '1') return;
  document.documentElement.dataset.routeChatScrollGuard = '1';

  const markIntent = (event: Event) => {
    const target = findChatScroller(event);
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

function installChatWheelNormalization() {
  if (document.documentElement.dataset.routeChatWheelNormalization === '1') return;
  document.documentElement.dataset.routeChatWheelNormalization = '1';

  document.addEventListener('wheel', (event) => {
    const scroller = findChatScroller(event);
    if (!scroller || !event.deltaY || !window.matchMedia('(pointer: fine)').matches) return;

    // Browsers do not guarantee that WheelEvent.deltaY is expressed in pixels.
    // Windows mouse wheels commonly report DOM_DELTA_LINE. The chat component's
    // old multiplier treated that small line count as pixels, so one wheel notch
    // moved only a tiny distance. Normalize line/page deltas here and leave
    // pixel-mode trackpads to the browser/React scroll path.
    if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) {
      event.preventDefault();
      scroller.scrollTop += event.deltaY * CHAT_WHEEL_LINE_PX;
      return;
    }

    if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
      event.preventDefault();
      scroller.scrollTop += event.deltaY * scroller.clientHeight * CHAT_WHEEL_PAGE_RATIO;
    }
  }, { passive: false, capture: true });
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

  const existingFooter = panel.querySelector<HTMLElement>('.hub-order-footer');
  if (existingFooter) return;

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
  installChatWheelNormalization();
  installHubOrderFix();
}
