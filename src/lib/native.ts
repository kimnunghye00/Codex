import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Camera } from '@capacitor/camera';
import { Geolocation } from '@capacitor/geolocation';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { Keyboard } from '@capacitor/keyboard';
import { LocalNotifications } from '@capacitor/local-notifications';
import { PushNotifications } from '@capacitor/push-notifications';
import { SplashScreen } from '@capacitor/splash-screen';
import { StatusBar, Style } from '@capacitor/status-bar';
import { disableNetwork, enableNetwork } from 'firebase/firestore';
import { db } from './firebase';

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

export async function initializeNativeApp() {
  if (!isNativePlatform()) return;

  const root = document.documentElement;
  root.classList.add('route-native', `route-native-${nativePlatform()}`);

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

  try {
    await StatusBar.setOverlaysWebView({ overlay: false });
    await StatusBar.setStyle({ style: Style.Light });
  } catch {}

  try {
    await Keyboard.setAccessoryBarVisible({ isVisible: true });
  } catch {}

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
        void enableNetwork(db).catch(() => undefined);
        return;
      }

      // Give foreground writes/backups a brief chance to finish, then stop
      // Firestore network traffic while ROUTE is backgrounded. Listeners catch
      // up automatically after enableNetwork() on resume.
      networkPauseTimer = window.setTimeout(() => {
        networkPauseTimer = undefined;
        void disableNetwork(db).catch(() => undefined);
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
      else App.minimizeApp();
    }).catch(() => undefined);
  }
}

export async function hideNativeSplash() {
  if (!isNativePlatform()) return;
  try {
    await SplashScreen.hide();
  } catch {}
}

export async function ensureCameraPermission() {
  if (!isNativePlatform()) return true;
  try {
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
  try { await Haptics.impact({ style: ImpactStyle.Light }); } catch {}
}
