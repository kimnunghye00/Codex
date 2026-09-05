import { Capacitor, registerPlugin } from '@capacitor/core';
import './appearance-stability';

type IconId = 'route' | 'heart' | 'night' | 'cream';
type RouteAppIconPlugin = {
  setIcon(options: { icon: IconId }): Promise<{ icon: IconId }>;
  getIcon(): Promise<{ icon: IconId }>;
};

const RouteAppIcon = registerPlugin<RouteAppIconPlugin>('RouteAppIcon');
let changing = false;

function iconIdFromButton(button: HTMLButtonElement): IconId | null {
  const preview = button.querySelector<HTMLElement>('.more-app-icon-preview');
  if (!preview) return null;
  if (preview.classList.contains('heart')) return 'heart';
  if (preview.classList.contains('night')) return 'night';
  if (preview.classList.contains('cream')) return 'cream';
  if (preview.classList.contains('route')) return 'route';
  return null;
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
    console.warn('[ROUTE app icon state]', cause);
  }
}

document.addEventListener('click', (event) => {
  const target = event.target as Element | null;
  const button = target?.closest<HTMLButtonElement>('.app-icon-picker button');
  if (!button || !Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') return;

  // Let React's onClick continue so the picker immediately reflects the new choice.
  // The native plugin handles only the launcher component switch.
  event.preventDefault();
  if (changing) return;

  const icon = iconIdFromButton(button);
  if (!icon) return;
  changing = true;
  button.setAttribute('aria-busy', 'true');
  updateNotice('앱 아이콘을 변경하고 있어요…');

  void RouteAppIcon.setIcon({ icon })
    .then((result) => {
      notifyIcon(result.icon);
      updateNotice('핸드폰 홈 화면의 ROUTE 아이콘을 변경했어요. 런처에 따라 반영에 몇 초 걸릴 수 있어요.');
    })
    .catch((cause) => {
      console.error('[ROUTE app icon]', cause);
      updateNotice('앱 아이콘 변경에 실패했어요. 잠시 뒤 다시 선택해 주세요.');
      void syncNativeIconState();
    })
    .finally(() => {
      changing = false;
      button.removeAttribute('aria-busy');
    });
}, true);

void syncNativeIconState();
