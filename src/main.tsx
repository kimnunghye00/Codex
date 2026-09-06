import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import Root from './Root';
import { AppCrashBoundary, installGlobalCrashDiagnostics } from './AppCrashBoundary';
import { applySavedRouteAppIcon } from './components/more/MoreServices';
import { authPersistenceReady } from './lib/firebase';
import { hideNativeSplash, initializeNativeApp } from './lib/native';
import { preparePersistentBackup, startPersistentBackup } from './lib/persistentBackup';
import { initializeCrossDeviceAlbumSync } from './lib/crossDeviceAlbumSync';
import { initializeRoutePwa } from './pwa';
import { initializeRuntimeRecovery } from './recovery-runtime';
import { installPersistentStorageObserver } from './utils/persistenceSignal';
import './styles.css';
import './auth-onboarding.css';
import './nickname.css';
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
// Phase-2 chat/media fixes must win over legacy bubble sizing and backgrounds.
import './route-chat-stability-v16.css';
// Network/recovery feedback is loaded directly; the obsolete appearance wrapper is gone.
import './route-runtime-stability-v19.css';

import './input-ime-stability';
import './route-themes';
import './home-map-overlay';
import './native-back-ui';
import './app-icon-native';
import './couple-date-enhance';
import './settings-hub';
import './mobile-polish-v3';
// Real-device post-deploy polish must win over the phase-4/5 runtime CSS loaded above.
import './route-post-deploy-polish-v20.css';
// App-wide stability layer owns shared gutters, header/nav geometry and overflow guards.
import './route-ui-stability-v23.css';

const DESKTOP_PREVIEW_PARAM = 'routeMobilePreview';
const NATIVE_SPLASH_FAILSAFE_MS = 2500;

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

function mountBootstrapShell() {
  const root = document.getElementById('root');
  if (!root) return;

  const shell = document.createElement('div');
  shell.setAttribute('role', 'status');
  shell.setAttribute('aria-live', 'polite');
  shell.style.cssText = [
    'min-height:100dvh',
    'box-sizing:border-box',
    'display:flex',
    'flex-direction:column',
    'align-items:center',
    'justify-content:center',
    'gap:12px',
    'padding:32px',
    'background:#fffaf8',
    'color:#3d405b',
    'font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
    'text-align:center',
  ].join(';');

  const brand = document.createElement('strong');
  brand.textContent = 'ROUTE.';
  brand.style.cssText = 'font-size:26px;letter-spacing:-1px;font-weight:900';

  const message = document.createElement('span');
  message.textContent = '우리의 기록을 준비하고 있어요';
  message.style.cssText = 'font-size:12px;line-height:1.5;color:#777687';

  const indicator = document.createElement('span');
  indicator.textContent = '•••';
  indicator.setAttribute('aria-hidden', 'true');
  indicator.style.cssText = 'font-size:13px;letter-spacing:4px;color:#e07a5f';

  shell.append(brand, message, indicator);
  root.replaceChildren(shell);
}

function mountBootstrapFailure() {
  const root = document.getElementById('root');
  if (!root) return;

  const shell = document.createElement('div');
  shell.setAttribute('role', 'alert');
  shell.style.cssText = [
    'min-height:100dvh',
    'box-sizing:border-box',
    'display:flex',
    'flex-direction:column',
    'align-items:center',
    'justify-content:center',
    'gap:12px',
    'padding:32px',
    'background:#fffaf8',
    'color:#3d405b',
    'font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
    'text-align:center',
  ].join(';');

  const brand = document.createElement('strong');
  brand.textContent = 'ROUTE.';
  brand.style.cssText = 'font-size:26px;letter-spacing:-1px;font-weight:900';

  const message = document.createElement('span');
  message.textContent = '앱을 준비하는 중 문제가 생겼어요. 다시 실행해 주세요.';
  message.style.cssText = 'max-width:280px;font-size:12px;line-height:1.6;color:#777687';

  const retry = document.createElement('button');
  retry.type = 'button';
  retry.textContent = '다시 시도';
  retry.style.cssText = 'min-height:44px;padding:0 20px;border:0;border-radius:14px;background:#3d405b;color:white;font-size:12px;font-weight:800';
  retry.addEventListener('click', () => window.location.reload());

  shell.append(brand, message, retry);
  root.replaceChildren(shell);
}

function waitForFirstPaint() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

async function bootstrap() {
  installGlobalCrashDiagnostics();
  installPersistentStorageObserver();
  applySavedRouteAppIcon();

  // On desktop web, show the exact responsive mobile app instead of stretching
  // the layout into a tablet/desktop dashboard. The iframe is same-origin, so
  // auth and local app data remain shared with the normal web app.
  if (mountDesktopPhonePreview()) return;

  // If Firebase recovery takes longer than expected, this shell is already
  // present when the native splash fail-safe disappears, preventing a white flash.
  mountBootstrapShell();
  const splashFailsafe = window.setTimeout(() => {
    void hideNativeSplash();
  }, NATIVE_SPLASH_FAILSAFE_MS);

  try {
    await initializeNativeApp();
    await authPersistenceReady;

    // Account isolation is a hard bootstrap barrier. React cannot read global
    // message/memory caches until ownership is verified or stale caches are reset.
    await initializeRuntimeRecovery();
    initializeRoutePwa();

    // Restore durable Firebase records before React reads local caches.
    await preparePersistentBackup();
    startPersistentBackup();
    initializeCrossDeviceAlbumSync();

    const root = document.getElementById('root');
    if (!root) throw new Error('ROUTE_ROOT_MISSING');

    createRoot(root).render(
      <StrictMode>
        <AppCrashBoundary>
          <Root />
        </AppCrashBoundary>
      </StrictMode>,
    );

    // Do not reveal the WebView until React has had two paint opportunities.
    await waitForFirstPaint();
  } catch (error) {
    console.error('[ROUTE bootstrap]', error);
    mountBootstrapFailure();
    await waitForFirstPaint();
  } finally {
    window.clearTimeout(splashFailsafe);
    await hideNativeSplash();
  }
}

void bootstrap();
