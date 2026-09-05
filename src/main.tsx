import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import Root from './Root';
import { AppCrashBoundary, installGlobalCrashDiagnostics } from './AppCrashBoundary';
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
import './web-desktop.css';
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

import './route-themes';
import './home-map-overlay';
import './native-back-ui';
import './app-icon-native';
import './profile-enhance';
import './couple-date-enhance';
import './settings-hub';
import './mobile-polish-v3';
import './more-enhance';

async function bootstrap() {
  installGlobalCrashDiagnostics();
  installPersistentStorageObserver();
  void initializeNativeApp();
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
