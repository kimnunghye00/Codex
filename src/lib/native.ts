import { Capacitor } from '@capacitor/core';

export const isNativePlatform = () => Capacitor.isNativePlatform();
export const nativePlatform = () => Capacitor.getPlatform();

const FIRESTORE_BACKGROUND_GRACE_MS = 1_200;
const LOCATION_OPTIONS = {
  enableHighAccuracy: false,
  maximumAge: 60_000,
  timeout: 15_000,
} as const;

export type RouteLocationPosition = {
  coords: {
    latitude: number;
    longitude: number;
    accuracy: number;
  };
  timestamp?: number;
};

export type RouteLocationError = {
  code?: string | number;
  message?: string;
};

export type RouteLocationWatch = {
  stop: () => Promise<void>;
};

let nativeFirestoreDesiredState = true;
let nativeFirestoreAppliedState: boolean | undefined;
let nativeFirestoreWorker: Promise<void> | null = null;
let nativeFirestoreApi: Promise<{
  enableNetwork: (database: import('firebase/firestore').Firestore) => Promise<void>;
  disableNetwork: (database: import('firebase/firestore').Firestore) => Promise<void>;
  db: import('firebase/firestore').Firestore;
}> | null = null;

function loadNativeFirestoreApi() {
  if (!nativeFirestoreApi) {
    nativeFirestoreApi = Promise.all([
      import('firebase/firestore'),
      import('./firebase'),
    ]).then(([firestore, firebase]) => ({
      enableNetwork: firestore.enableNetwork,
      disableNetwork: firestore.disableNetwork,
      db: firebase.db,
    }));
  }
  return nativeFirestoreApi;
}

function setNativeFirestoreNetwork(enabled: boolean) {
  nativeFirestoreDesiredState = enabled;
  if (nativeFirestoreWorker) return nativeFirestoreWorker;

  nativeFirestoreWorker = (async () => {
    try {
      const { enableNetwork, disableNetwork, db } = await loadNativeFirestoreApi();

      while (nativeFirestoreAppliedState !== nativeFirestoreDesiredState) {
        const target = nativeFirestoreDesiredState;
        try {
          if (target) await enableNetwork(db);
          else await disableNetwork(db);
          nativeFirestoreAppliedState = target;
        } catch {
          // Lifecycle network hints are best-effort and must never block the UI.
          break;
        }
      }
    } finally {
      nativeFirestoreWorker = null;
      // The desired state may have changed between the last loop check and
      // worker teardown. Start exactly one follow-up worker if needed.
      if (nativeFirestoreAppliedState !== nativeFirestoreDesiredState) {
        void setNativeFirestoreNetwork(nativeFirestoreDesiredState);
      }
    }
  })();

  return nativeFirestoreWorker;
}

export async function initializeNativeApp() {
  if (!isNativePlatform()) return;

  const root = document.documentElement;
  root.classList.add('route-native', `route-native-${nativePlatform()}`);

  // Native-only plugins are intentionally loaded here instead of at module
  // evaluation time. Web users therefore do not download/parse Capacitor
  // keyboard, status bar, app lifecycle or Firestore code during bootstrap.
  const [{ App }, { Keyboard }, { StatusBar, Style }] = await Promise.all([
    import('@capacitor/app'),
    import('@capacitor/keyboard'),
    import('@capacitor/status-bar'),
  ]);

  if (root.dataset.routeKeyboardWired !== '1') {
    root.dataset.routeKeyboardWired = '1';

    const showKeyboard = (height: number) => {
      root.classList.add('route-keyboard-open');
      root.style.setProperty('--route-keyboard-height', `${Math.max(0, height)}px`);
    };
    const hideKeyboard = () => {
      root.classList.remove('route-keyboard-open');
      root.style.setProperty('--route-keyboard-height', '0px');
    };

    Keyboard.addListener('keyboardWillShow', (info) => showKeyboard(info.keyboardHeight)).catch(() => undefined);
    Keyboard.addListener('keyboardDidShow', (info) => showKeyboard(info.keyboardHeight)).catch(() => undefined);
    Keyboard.addListener('keyboardWillHide', hideKeyboard).catch(() => undefined);
    Keyboard.addListener('keyboardDidHide', hideKeyboard).catch(() => undefined);
  }

  // These cosmetic native calls should not extend time-to-first-render.
  void StatusBar.setOverlaysWebView({ overlay: false }).catch(() => undefined);
  void StatusBar.setStyle({ style: Style.Light }).catch(() => undefined);
  void Keyboard.setAccessoryBarVisible({ isVisible: true }).catch(() => undefined);

  if (root.dataset.routeNativeLifecycleWired !== '1') {
    root.dataset.routeNativeLifecycleWired = '1';
    let networkPauseTimer: number | undefined;

    App.addListener('appStateChange', ({ isActive }) => {
      window.dispatchEvent(new Event(isActive ? 'route-app-resume' : 'route-app-pause'));

      if (networkPauseTimer !== undefined) {
        window.clearTimeout(networkPauseTimer);
        networkPauseTimer = undefined;
      }

      if (isActive) {
        void setNativeFirestoreNetwork(true);
        return;
      }

      // Give foreground writes/backups a brief chance to finish, then stop
      // Firestore traffic. Firestore itself is loaded only if lifecycle work is
      // actually needed, keeping it out of the native bootstrap path as well.
      networkPauseTimer = window.setTimeout(() => {
        networkPauseTimer = undefined;
        void setNativeFirestoreNetwork(false);
      }, FIRESTORE_BACKGROUND_GRACE_MS);
    }).catch(() => undefined);

    let lastBackAt = 0;
    App.addListener('backButton', ({ canGoBack }) => {
      const now = Date.now();
      if (now - lastBackAt < 320) return;
      lastBackAt = now;

      const routeBack = new Event('route-native-back', { cancelable: true });
      window.dispatchEvent(routeBack);
      if (routeBack.defaultPrevented) return;

      if (canGoBack) window.history.back();
      else void App.minimizeApp();
    }).catch(() => undefined);
  }
}

export async function hideNativeSplash() {
  if (!isNativePlatform()) return;
  try {
    const { SplashScreen } = await import('@capacitor/splash-screen');
    await SplashScreen.hide();
  } catch {}
}

export async function ensureCameraPermission() {
  if (!isNativePlatform()) return true;
  try {
    const { Camera } = await import('@capacitor/camera');
    let permissions = await Camera.checkPermissions();
    if (permissions.camera !== 'granted') {
      permissions = await Camera.requestPermissions({ permissions: ['camera'] });
    }
    return permissions.camera === 'granted';
  } catch {
    return false;
  }
}

export async function ensureLocationPermission() {
  if (!isNativePlatform()) return true;
  try {
    const { Geolocation } = await import('@capacitor/geolocation');
    let permissions = await Geolocation.checkPermissions();
    if (permissions.location !== 'granted' && permissions.coarseLocation !== 'granted') {
      permissions = await Geolocation.requestPermissions({ permissions: ['location', 'coarseLocation'] });
    }
    return permissions.location === 'granted' || permissions.coarseLocation === 'granted';
  } catch {
    return false;
  }
}

export async function startRouteLocationWatch(
  onPosition: (position: RouteLocationPosition) => void,
  onError: (error: RouteLocationError) => void,
): Promise<RouteLocationWatch> {
  if (isNativePlatform()) {
    const allowed = await ensureLocationPermission();
    if (!allowed) throw new Error('route-location-permission-denied');

    const { Geolocation } = await import('@capacitor/geolocation');
    let activeId: string | undefined;
    let stopped = false;
    let suspended = false;
    let starting = false;

    const clearActiveWatch = async () => {
      const id = activeId;
      activeId = undefined;
      if (!id) return;
      try { await Geolocation.clearWatch({ id }); } catch {}
    };

    const startNativeWatch = async () => {
      if (stopped || suspended || starting || activeId) return;
      starting = true;
      try {
        const id = await Geolocation.watchPosition(
          LOCATION_OPTIONS,
          (position, error) => {
            if (error) {
              onError({ code: error.code, message: error.message });
              return;
            }
            if (!position) return;
            onPosition({
              coords: {
                latitude: position.coords.latitude,
                longitude: position.coords.longitude,
                accuracy: position.coords.accuracy,
              },
              timestamp: position.timestamp,
            });
          },
        );
        if (stopped || suspended) {
          try { await Geolocation.clearWatch({ id }); } catch {}
        } else {
          activeId = id;
        }
      } finally {
        starting = false;
      }
    };

    const pause = () => {
      suspended = true;
      void clearActiveWatch();
    };
    const resume = () => {
      suspended = false;
      void startNativeWatch();
    };

    window.addEventListener('route-app-pause', pause);
    window.addEventListener('route-app-resume', resume);
    await startNativeWatch();

    return {
      stop: async () => {
        stopped = true;
        suspended = true;
        window.removeEventListener('route-app-pause', pause);
        window.removeEventListener('route-app-resume', resume);
        await clearActiveWatch();
      },
    };
  }

  if (!('geolocation' in navigator)) throw new Error('route-location-unavailable');

  let activeId: number | undefined;
  let stopped = false;
  let suspended = document.visibilityState === 'hidden';

  const clearActiveWatch = () => {
    if (activeId === undefined) return;
    navigator.geolocation.clearWatch(activeId);
    activeId = undefined;
  };

  const startWebWatch = () => {
    if (stopped || suspended || activeId !== undefined) return;
    activeId = navigator.geolocation.watchPosition(
      (position) => onPosition({
        coords: {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
        },
        timestamp: position.timestamp,
      }),
      (error) => onError({ code: error.code, message: error.message }),
      LOCATION_OPTIONS,
    );
  };

  const visibility = () => {
    suspended = document.visibilityState === 'hidden';
    if (suspended) clearActiveWatch();
    else startWebWatch();
  };

  document.addEventListener('visibilitychange', visibility);
  startWebWatch();

  return {
    stop: async () => {
      stopped = true;
      document.removeEventListener('visibilitychange', visibility);
      clearActiveWatch();
    },
  };
}

export async function ensureNotificationPermission() {
  if (!isNativePlatform()) return true;
  try {
    const [{ LocalNotifications }, { PushNotifications }] = await Promise.all([
      import('@capacitor/local-notifications'),
      import('@capacitor/push-notifications'),
    ]);
    let local = await LocalNotifications.checkPermissions();
    if (local.display !== 'granted') local = await LocalNotifications.requestPermissions();

    let push = await PushNotifications.checkPermissions();
    if (push.receive !== 'granted') push = await PushNotifications.requestPermissions();
    if (push.receive === 'granted') await PushNotifications.register();

    return local.display === 'granted';
  } catch {
    return false;
  }
}

export async function nativeImpact() {
  if (!isNativePlatform()) return;
  try {
    const { Haptics, ImpactStyle } = await import('@capacitor/haptics');
    await Haptics.impact({ style: ImpactStyle.Light });
  } catch {}
}
