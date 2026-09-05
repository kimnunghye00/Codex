import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import Root from './Root';
import { AppCrashBoundary, installGlobalCrashDiagnostics } from './AppCrashBoundary';
import { authPersistenceReady } from './lib/firebase';
import { initializeNativeApp } from './lib/native';
import { preparePersistentBackup, startPersistentBackup } from './lib/persistentBackup';
import { initializeCrossDeviceAlbumSync } from './lib/crossDeviceAlbumSync';
import { initializeRoutePwa } from './pwa';
import { installPersistentStorageObserver } from './utils/persistenceSignal';
import './styles.css';
import './auth-onboarding.css';
import './nickname.css';
import './ai-test.css';
import './chat-typing.css';
import './chat-tools.css';
import './chat-extras.css';
import './notifications.css';
import './location.css';
import './home-simple.css';
import './home-dashboard.css';
import './home-couple-tools.css';
import './home-couple-layout.css';
import './memories-hub.css';
import './more.css';
import './more-services.css';
import './route-brand.css';
import './route-themes.css';
import './couple-connect.css';
import './home-map-overlay.css';
import './close-standard.css';
import './mobile-apk-fixes.css';
import './mobile-polish-v3.css';
import './crash-recovery.css';
// Contrast safety first, then runtime appearance/layout overrides.
import './route-theme-accessibility.css';
import './system-dark.css';
import './home-brand-polish-v5.css';
import './layout-polish-v4.css';
// Final product tokens and home composition must win over legacy feature CSS.
import './route-design-system-v6.css';
// Final non-home product polish: Memories, Chat, Location and More.
import './route-product-polish-v7.css';
// Last-mile responsive QA: clipping, Korean text, touch targets and safe areas.
import './route-final-qa-v8.css';
// Cross-feature interaction feedback must remain visible above all legacy layers.
import './route-feature-flow-v9.css';
// Place-centered story view connects visits, memories, dates and schedules.
import './route-place-timeline-v10.css';
import './web-desktop.css';
// Desktop browsers present the app inside a real phone-sized viewport.
// The home itself intentionally keeps the established 58/42 split layout
// from home-couple-layout.css, matching the approved reference screen.
import './route-web-phone-preview-v12.css';
// Native-only phase-1 stability guards intentionally load after all visual layers.
import './route-stability-v15.css';

import './input-ime-stability';
import './route-themes';
import './home-map-overlay';
import './native-back-ui';
import './app-icon-native';
import './profile-enhance';
import './couple-date-enhance';
import './settings-hub';
import './mobile-polish-v3';
import './more-enhance';

const DESKTOP_PREVIEW_PARAM = 'routeMobilePreview';

function shouldUseDesktopPhonePreview() {
  const params = new URLSearchParams(window.location.search);
  return window.self === window.top
    && /^https?:$/.test(window.location.protocol)
    && window.matchMedia('(min-width: 900px)').matches
    && !params.has(DESKTOP_PREVIEW_PARAM);
}

function mountDesktopPhonePreview() {
  if (!shouldUseDesktopPhonePreview()) return false;

  const root = document.getElementById('root');
  if (!root) return false;

  document.documentElement.classList.add('route-desktop-phone-mode');

  const preview = document.createElement('div');
  preview.className = 'route-desktop-phone-preview';

  const frame = document.createElement('div');
  frame.className = 'route-desktop-phone-frame';

  const iframe = document.createElement('iframe');
  const url = new URL(window.location.href);
  url.searchParams.set(DESKTOP_PREVIEW_PARAM, '1');
  iframe.src = url.toString();
  iframe.title = 'ROUTE 모바일 화면';
  iframe.setAttribute('allow', 'geolocation; camera; microphone; clipboard-read; clipboard-write');

  frame.appendChild(iframe);
  preview.appendChild(frame);
  root.replaceChildren(preview);
  return true;
}

async function bootstrap() {
  installGlobalCrashDiagnostics();
  installPersistentStorageObserver();

  // On desktop web, show the exact responsive mobile app instead of stretching
  // the layout into a tablet/desktop dashboard. The iframe is same-origin, so
  // auth and local app data remain shared with the normal web app.
  if (mountDesktopPhonePreview()) return;

  void initializeNativeApp();
  await authPersistenceReady;
  initializeRoutePwa();

  // Restore durable Firebase records before React reads local caches.
  // This is what makes reinstalling the app recover recent ROUTE data.
  await preparePersistentBackup();
  startPersistentBackup();
  initializeCrossDeviceAlbumSync();

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <AppCrashBoundary>
        <Root />
      </AppCrashBoundary>
    </StrictMode>,
  );
}

void bootstrap();
