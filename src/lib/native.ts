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

export async function initializeNativeApp() {
  if (!isNativePlatform()) return;

  try {
    await StatusBar.setOverlaysWebView({ overlay: false });
    await StatusBar.setStyle({ style: Style.Light });
  } catch {}

  try {
    await Keyboard.setAccessoryBarVisible({ isVisible: true });
  } catch {}

  try {
    await SplashScreen.hide();
  } catch {}

  App.addListener('backButton', ({ canGoBack }) => {
    if (canGoBack) window.history.back();
    else App.minimizeApp();
  }).catch(() => undefined);
}

export async function ensureCameraPermission() {
  if (!isNativePlatform()) return true;
  try {
    let permissions = await Camera.checkPermissions();
    if (permissions.camera !== 'granted') permissions = await Camera.requestPermissions({ permissions: ['camera', 'photos'] });
    return permissions.camera === 'granted';
  } catch {
    return false;
  }
}

export async function ensureLocationPermission() {
  if (!isNativePlatform()) return true;
  try {
    let permissions = await Geolocation.checkPermissions();
    if (permissions.location !== 'granted') permissions = await Geolocation.requestPermissions();
    return permissions.location === 'granted';
  } catch {
    return false;
  }
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
