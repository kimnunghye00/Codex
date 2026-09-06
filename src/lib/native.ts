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

export const isNativePlatform = () => Capacitor.isNativePlatform();
export const nativePlatform = () => Capacitor.getPlatform();

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

  // App lifecycle/back listeners are app-lifetime listeners. Guard them so an
  // accidental second native initialization cannot register duplicate handlers.
  if (root.dataset.routeNativeLifecycleWired !== '1') {
    root.dataset.routeNativeLifecycleWired = '1';

    App.addListener('appStateChange', ({ isActive }) => {
      window.dispatchEvent(new Event(isActive ? 'route-app-resume' : 'route-app-pause'));
    }).catch(() => undefined);

    let lastBackAt = 0;
    App.addListener('backButton', ({ canGoBack }) => {
      const now = Date.now();
      if (now - lastBackAt < 320) return;
      lastBackAt = now;

      // Give ROUTE overlays/details/tabs the first chance to consume Android back.
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
  } catch {
    // The web/PWA build has no native splash and older devices can reject a
    // repeated hide call. Neither case should block ROUTE from starting.
  }
}

export async function ensureCameraPermission() {
  if (!isNativePlatform()) return true;
  try {
    let permissions = await Camera.checkPermissions();
    // Gallery selection is handled by the platform picker and must not be tied to
    // camera capture permission. Request only the permission this helper owns.
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

    const id = await Geolocation.watchPosition(
      { enableHighAccuracy: true, maximumAge: 45_000, timeout: 20_000 },
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

    return {
      stop: async () => {
        try { await Geolocation.clearWatch({ id }); } catch {}
      },
    };
  }

  if (!('geolocation' in navigator)) throw new Error('route-location-unavailable');

  const id = navigator.geolocation.watchPosition(
    (position) => onPosition({
      coords: {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
      },
      timestamp: position.timestamp,
    }),
    (error) => onError({ code: error.code, message: error.message }),
    { enableHighAccuracy: true, maximumAge: 45_000, timeout: 20_000 },
  );

  return {
    stop: async () => navigator.geolocation.clearWatch(id),
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
