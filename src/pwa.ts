import { Capacitor } from '@capacitor/core';

type InstallChoice = { outcome: 'accepted' | 'dismissed'; platform: string };

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<InstallChoice>;
};

let deferredInstallPrompt: BeforeInstallPromptEvent | null = null;

export function isStandaloneWebApp() {
  return window.matchMedia('(display-mode: standalone)').matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
}

export function canInstallRouteWebApp() {
  return !Capacitor.isNativePlatform() && !isStandaloneWebApp() && Boolean(deferredInstallPrompt);
}

export async function installRouteWebApp(): Promise<'installed' | 'accepted' | 'dismissed' | 'browser-menu' | 'native'> {
  if (Capacitor.isNativePlatform()) return 'native';
  if (isStandaloneWebApp()) return 'installed';
  if (!deferredInstallPrompt) return 'browser-menu';

  const prompt = deferredInstallPrompt;
  deferredInstallPrompt = null;
  await prompt.prompt();
  const choice = await prompt.userChoice;
  window.dispatchEvent(new CustomEvent('route-pwa-install-state'));
  return choice.outcome;
}

async function clearDevelopmentServiceWorkers() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));
  } catch (error) {
    console.warn('[ROUTE PWA] development service worker cleanup failed', error);
  }
}

export function initializeRoutePwa() {
  if (Capacitor.isNativePlatform()) return;

  // Vite/Codespaces development already has its own live-reload pipeline.
  // A previously registered PWA service worker can keep serving stale app shells
  // or interfere with HMR, which may look like the page is endlessly refreshing.
  // Never keep a ROUTE service worker active while running `npm run dev`.
  if (import.meta.env.DEV) {
    void clearDevelopmentServiceWorkers();
    return;
  }

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredInstallPrompt = event as BeforeInstallPromptEvent;
    window.dispatchEvent(new CustomEvent('route-pwa-install-state'));
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    window.dispatchEvent(new CustomEvent('route-pwa-install-state'));
  });

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      const base = import.meta.env.BASE_URL || '/';
      void navigator.serviceWorker.register(`${base}sw.js`, { scope: base }).catch((error) => {
        console.warn('[ROUTE PWA] service worker registration failed', error);
      });
    }, { once: true });
  }
}
