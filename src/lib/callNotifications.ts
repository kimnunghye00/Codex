import { ensureNotificationPermission, isNativePlatform } from './native';
import type { CoupleCallKind } from './coupleCall';

const webNotifications = new Map<string, Notification>();

function notificationId(callId: string) {
  let hash = 17;
  for (let index = 0; index < callId.length; index += 1) hash = ((hash * 31) + callId.charCodeAt(index)) >>> 0;
  return 1_000_000 + (hash % 1_000_000_000);
}

function notificationCopy(partnerName: string, kind: CoupleCallKind) {
  return {
    title: kind === 'video' ? `${partnerName}님의 영상통화` : `${partnerName}님의 전화`,
    body: kind === 'video' ? '단둘이 영상통화가 왔어요.' : '단둘이 전화가 왔어요.',
  };
}

export async function prepareIncomingCallNotifications() {
  if (isNativePlatform()) return ensureNotificationPermission();
  if (typeof Notification === 'undefined') return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  try {
    return await Notification.requestPermission() === 'granted';
  } catch {
    return false;
  }
}

export async function showIncomingCallNotification(callId: string, partnerName: string, kind: CoupleCallKind) {
  const copy = notificationCopy(partnerName, kind);

  if (isNativePlatform()) {
    try {
      const allowed = await ensureNotificationPermission();
      if (!allowed) return false;
      const { LocalNotifications } = await import('@capacitor/local-notifications');
      await LocalNotifications.schedule({
        notifications: [{
          id: notificationId(callId),
          title: copy.title,
          body: copy.body,
          extra: {
            type: 'incoming-call',
            callId,
            kind,
          },
        }],
      });
      return true;
    } catch (cause) {
      console.warn('[DANDULI incoming call notification]', cause);
      return false;
    }
  }

  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return false;
  try {
    webNotifications.get(callId)?.close();
    const notification = new Notification(copy.title, {
      body: copy.body,
      tag: `danduli-call-${callId}`,
      requireInteraction: true,
    });
    notification.onclick = () => {
      window.focus();
      notification.close();
    };
    webNotifications.set(callId, notification);
    return true;
  } catch (cause) {
    console.warn('[DANDULI web call notification]', cause);
    return false;
  }
}

export async function clearIncomingCallNotification(callId: string) {
  webNotifications.get(callId)?.close();
  webNotifications.delete(callId);

  if (!isNativePlatform()) return;
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    await LocalNotifications.cancel({
      notifications: [{ id: notificationId(callId) }],
    });
  } catch {
    // The notification may already have been dismissed by the user.
  }
}
