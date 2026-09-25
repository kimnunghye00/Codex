import { Capacitor } from '@capacitor/core';
import { notificationDestination, notificationRouteUrl, type AppNotification } from '../utils/notifications';

const nativeId = (value: string) => {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619) >>> 0;
  return 20_000_000 + (hash % 900_000_000);
};

export async function requestActivityAlerts(): Promise<boolean> {
  if (Capacitor.isNativePlatform()) {
    try {
      const { LocalNotifications } = await import('@capacitor/local-notifications');
      return (await LocalNotifications.requestPermissions()).display === 'granted';
    } catch { return false; }
  }
  if (typeof Notification === 'undefined' || !window.isSecureContext) return false;
  try {
    return (await Notification.requestPermission()) === 'granted';
  } catch { return false; }
}

export async function activityAlertEnabled(): Promise<boolean> {
  if (Capacitor.isNativePlatform()) {
    try {
      const { LocalNotifications } = await import('@capacitor/local-notifications');
      return (await LocalNotifications.checkPermissions()).display === 'granted';
    } catch { return false; }
  }
  return typeof Notification !== 'undefined' && Notification.permission === 'granted';
}

export async function showPartnerActivityAlert(event: AppNotification) {
  const target = notificationDestination(event.target);
  if (!target || !(await activityAlertEnabled())) return;
  if (Capacitor.isNativePlatform()) {
    try {
      const { LocalNotifications } = await import('@capacitor/local-notifications');
      await LocalNotifications.schedule({ notifications: [{
        id: nativeId(event.id), title: event.title, body: event.detail || '단둘이에서 확인해 주세요.',
        extra: { screen: target.screen, itemId: target.itemId },
      }] });
    } catch (error) { console.warn('[DANDULI native activity alert]', error); }
    return;
  }
  // A web page can issue an alert while its JavaScript is running. This is
  // not background FCM push and does not promise delivery after the page quits.
  try {
    const notification = new Notification(event.title, {
      body: event.detail || '단둘이에서 확인해 주세요.',
      tag: event.id,
      icon: '/route-icon.svg',
    });
    notification.onclick = () => {
      notification.close(); window.focus();
      window.dispatchEvent(new CustomEvent('route-notification-open', { detail: target }));
    };
  } catch (error) { console.warn('[DANDULI web activity alert]', error); }
}

/** Register one native tap handler; no permission requested until the user opts in. */
export function installActivityAlertClicks(): () => void {
  if (!Capacitor.isNativePlatform()) return () => undefined;
  let cancelled = false;
  let remove: (() => Promise<void>) | undefined;
  void import('@capacitor/local-notifications').then(({ LocalNotifications }) =>
    LocalNotifications.addListener('localNotificationActionPerformed', (event) => {
      const target = notificationDestination(event.notification.extra);
      if (target) window.dispatchEvent(new CustomEvent('route-notification-open', { detail: target }));
    }),
  ).then((handle) => {
    if (cancelled) void handle.remove();
    else remove = () => handle.remove();
  }).catch((error) => console.warn('[DANDULI notification tap]', error));
  return () => { cancelled = true; void remove?.(); };
}

export function openActivityFromUrl(): { screen: 'chat' | 'album' | 'date-plan'; itemId: string } | null {
  const url = new URL(window.location.href);
  const target = notificationDestination({ screen: url.searchParams.get('open'), itemId: url.searchParams.get('item') });
  if (target) {
    url.searchParams.delete('open'); url.searchParams.delete('item');
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
  }
  return target;
}

export { notificationRouteUrl };
