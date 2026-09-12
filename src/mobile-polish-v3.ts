import './route-mobile-bugfix-v29.css';
import { installRouteMobileBugfixV29 } from './route-mobile-bugfix-v29';

function replaceAppointmentLabels(root: ParentNode = document) {
  const selectors = [
    '.route-hub .hub-tabs button',
    '.route-hub .hub-head h1',
    '.route-hub .hub-section-head h2',
    '.route-hub .hub-section-head button',
    '.route-hub .hub-order-row b',
    '.route-hub .hub-order-panel label',
    '.route-more-services .more-service-grid button b',
  ];
  root.querySelectorAll<HTMLElement>(selectors.join(',')).forEach((element) => {
    for (const node of Array.from(element.childNodes)) {
      if (node.nodeType !== Node.TEXT_NODE) continue;
      const text = node.textContent || '';
      if (text.includes('데이트')) node.textContent = text.replaceAll('데이트', '약속');
    }
    if (element.childNodes.length === 1 && element.textContent?.includes('데이트')) {
      element.textContent = element.textContent.replaceAll('데이트', '약속');
    }
  });
}

function improveHubOrderPanel() {
  const panel = document.querySelector<HTMLElement>('.hub-order-backdrop .hub-order-panel:not(.compact)');
  if (!panel || panel.dataset.routePolished === '1') return;
  panel.dataset.routePolished = '1';
  const header = panel.querySelector('header');
  const close = header?.querySelector<HTMLButtonElement>('button');
  close?.setAttribute('aria-label', '탭 순서 편집 닫기');

  const existingFooter = panel.querySelector<HTMLElement>('.hub-order-footer, .route-hub-order-footer');
  if (!existingFooter) {
    const footer = document.createElement('div');
    footer.className = 'hub-order-footer';
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'hub-order-reset';
    reset.textContent = '기본 순서';
    reset.addEventListener('click', () => {
      try {
        const uid = Object.keys(localStorage).find((key) => key.startsWith('route-hub-tabs:'))?.split(':').slice(1).join(':');
        if (uid) localStorage.removeItem(`route-hub-tabs:${uid}`);
      } catch { /* noop */ }
      window.location.reload();
    });
    const done = document.createElement('button');
    done.type = 'button';
    done.className = 'primary hub-order-done';
    done.textContent = '완료';
    done.addEventListener('click', () => close?.click());
    footer.append(reset, done);
    panel.append(footer);
  }

  const backdrop = panel.closest<HTMLElement>('.hub-order-backdrop');
  backdrop?.addEventListener('pointerdown', (event) => {
    if (event.target === backdrop) close?.click();
  });
}

function closeStaleHubPopupOnTabChange() {
  document.querySelectorAll<HTMLButtonElement>('.route-hub .hub-tabs button').forEach((button) => {
    if (button.dataset.routeCloseWired === '1') return;
    button.dataset.routeCloseWired = '1';
    button.addEventListener('click', () => {
      document.querySelector<HTMLButtonElement>('.hub-order-panel header button')?.click();
    }, true);
  });
}

function polish() {
  replaceAppointmentLabels();
  improveHubOrderPanel();
  closeStaleHubPopupOnTabChange();
}

const FEATURE_ROOT = '.route-hub, .route-more-services';
let scheduled = false;

function schedulePolish() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    polish();
  });
}

function mutationTouchesFeature(record: MutationRecord) {
  const target = record.target;
  if (target instanceof Element && target.closest(FEATURE_ROOT)) return true;
  return Array.from(record.addedNodes).some((node) => {
    if (!(node instanceof Element)) return false;
    return node.matches(FEATURE_ROOT)
      || Boolean(node.closest(FEATURE_ROOT))
      || Boolean(node.querySelector(FEATURE_ROOT));
  });
}

const observer = new MutationObserver((records) => {
  if (records.some(mutationTouchesFeature)) schedulePolish();
});

function start() {
  polish();
  installRouteMobileBugfixV29();
  observer.observe(document.body, { childList: true, subtree: true });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start, { once: true });
} else {
  start();
}
