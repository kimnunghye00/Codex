import { createRoot, type Root } from 'react-dom/client';
import { PartnerProfileCard } from './components/auth/PartnerProfileCard';

let mountedRoot: Root | null = null;
let mountedHost: HTMLElement | null = null;
let scheduled = false;

function cleanupDetachedProfileRoot() {
  if (!mountedRoot || !mountedHost || mountedHost.isConnected) return;
  mountedRoot.unmount();
  mountedRoot = null;
  mountedHost = null;
}

function enhanceProfileSettings() {
  cleanupDetachedProfileRoot();

  const settings = document.querySelector<HTMLElement>('.profile-enabled-settings');
  const myProfile = settings?.querySelector<HTMLElement>('.settings-profile-card');
  if (!settings || !myProfile) return;

  const existing = settings.querySelector<HTMLElement>('.route-partner-profile-root');
  if (existing) {
    mountedHost = existing;
    return;
  }

  if (mountedRoot && mountedHost) {
    mountedRoot.unmount();
    mountedRoot = null;
    mountedHost = null;
  }

  const host = document.createElement('div');
  host.className = 'route-partner-profile-root';
  myProfile.insertAdjacentElement('afterend', host);

  mountedHost = host;
  mountedRoot = createRoot(host);
  mountedRoot.render(<PartnerProfileCard />);
}

function scheduleEnhance() {
  if (scheduled) return;
  scheduled = true;
  window.requestAnimationFrame(() => {
    scheduled = false;
    enhanceProfileSettings();
  });
}

function opensAccountSettings(target: Element | null) {
  return Boolean(
    target?.closest('.header-actions button[aria-label="설정"]')
    || target?.closest('.home-couple-profile-card .home-person')
  );
}

/*
 * Phase-2 stability: settings are opened from a small known set of controls,
 * so avoid observing every subtree mutation in the application.
 */
document.addEventListener('click', (event) => {
  const target = event.target as Element | null;

  if (opensAccountSettings(target)) {
    scheduleEnhance();
    return;
  }

  if (target?.closest('.account-settings header button[aria-label="닫기"]')) {
    window.requestAnimationFrame(cleanupDetachedProfileRoot);
  }
}, true);

window.addEventListener('route-native-back', () => {
  window.requestAnimationFrame(cleanupDetachedProfileRoot);
});

/* Handles hot reloads and a settings panel that is already present. */
scheduleEnhance();
