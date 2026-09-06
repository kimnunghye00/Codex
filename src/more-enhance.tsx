import './appearance-stability';
import { createRoot, type Root } from 'react-dom/client';
import { MoreServices, applySavedRouteAppIcon } from './components/more/MoreServices';

applySavedRouteAppIcon();

let mountedRoot: Root | null = null;
let mountedHost: HTMLElement | null = null;
let scheduled = false;

function cleanupDetachedMoreRoot() {
  if (!mountedRoot || !mountedHost || mountedHost.isConnected) return;
  mountedRoot.unmount();
  mountedRoot = null;
  mountedHost = null;
}

function enhanceMorePage() {
  cleanupDetachedMoreRoot();

  const scroll = document.querySelector<HTMLElement>('.more-page .more-scroll');
  if (!scroll) return;

  const existing = scroll.querySelector<HTMLElement>(':scope > .route-more-root');
  if (existing) {
    mountedHost = existing;
    return;
  }

  if (mountedRoot && mountedHost) {
    mountedRoot.unmount();
    mountedRoot = null;
    mountedHost = null;
  }

  scroll.replaceChildren();
  const host = document.createElement('div');
  host.className = 'route-more-root';
  scroll.appendChild(host);

  mountedHost = host;
  mountedRoot = createRoot(host);
  mountedRoot.render(<MoreServices />);
}

function scheduleEnhance() {
  if (scheduled) return;
  scheduled = true;
  window.requestAnimationFrame(() => {
    scheduled = false;
    enhanceMorePage();
  });
}

function isMoreNavButton(target: Element | null) {
  const button = target?.closest<HTMLButtonElement>('.bottom-nav button');
  return button?.textContent?.trim() === '더보기';
}

/*
 * Phase-2 stability: do not watch the entire DOM tree. More is reachable from
 * one navigation button, so mount only when that transition actually occurs.
 * This prevents every unrelated React render from retriggering enhancement.
 */
document.addEventListener('click', (event) => {
  const target = event.target as Element | null;
  if (isMoreNavButton(target)) {
    scheduleEnhance();
    return;
  }

  if (target?.closest('.bottom-nav button')) {
    window.requestAnimationFrame(cleanupDetachedMoreRoot);
  }
}, true);

window.addEventListener('route-native-back', () => {
  window.requestAnimationFrame(cleanupDetachedMoreRoot);
});

/* Handles hot reloads and cases where the app initially restores the More tab. */
scheduleEnhance();
