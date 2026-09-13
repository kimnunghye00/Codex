import { Capacitor, registerPlugin } from '@capacitor/core';
import type { RouteAppIconId } from './utils/appIcon';

type IconId = RouteAppIconId;
type RouteAppIconPlugin = {
  setIcon(options: { icon: IconId }): Promise<{ icon: IconId }>;
  getIcon(): Promise<{ icon: IconId }>;
};

const RouteAppIcon = registerPlugin<RouteAppIconPlugin>('RouteAppIcon');
let changing = false;

function iconIdFromButton(button: HTMLButtonElement): IconId | null {
  const value = button.dataset.iconId;
  return value === 'route' || value === 'heart' || value === 'pin-duo' || value === 'heart-chat' || value === 'our-route' || value === 'night' || value === 'cream' || value === 'minimal'
    ? value
    : null;
}

function notifyIcon(icon: IconId) {
  localStorage.setItem('route-app-icon', icon);
  window.dispatchEvent(new CustomEvent<IconId>('route-app-icon-changed', { detail: icon }));
}

function updateNotice(message: string) {
  window.setTimeout(() => {
    const notice = document.querySelector<HTMLElement>('.more-sheet-notice');
    if (notice) notice.textContent = message;
  }, 20);
}

async function syncNativeIconState() {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') return;
  try {
    const result = await RouteAppIcon.getIcon();
    notifyIcon(result.icon);
  } catch (cause) {
    console.warn('[DANDULI app icon state]', cause);
  }
}

if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android') {
  document.addEventListener('click', (event) => {
    const target = event.target as Element | null;
    const button = target?.closest<HTMLButtonElement>('.app-icon-picker button[data-icon-id]');
    if (!button) return;

    event.preventDefault();
    if (changing) {
      event.stopPropagation();
      return;
    }

    const icon = iconIdFromButton(button);
    if (!icon) return;
    const picker = button.closest<HTMLElement>('.app-icon-picker');
    changing = true;
    picker?.setAttribute('aria-busy', 'true');
    button.setAttribute('aria-busy', 'true');
    updateNotice('앱 아이콘을 변경하고 있어요…');

    void RouteAppIcon.setIcon({ icon })
      .then((result) => {
        notifyIcon(result.icon);
        updateNotice('핸드폰 홈 화면의 단둘이 아이콘을 변경했어요. 런처에 따라 반영에 몇 초 걸릴 수 있어요.');
      })
      .catch((cause) => {
        console.error('[DANDULI app icon]', cause);
        updateNotice('앱 아이콘 변경에 실패했어요. 잠시 뒤 다시 선택해 주세요.');
        void syncNativeIconState();
      })
      .finally(() => {
        changing = false;
        picker?.removeAttribute('aria-busy');
        button.removeAttribute('aria-busy');
      });
  }, true);

  void syncNativeIconState();
}
