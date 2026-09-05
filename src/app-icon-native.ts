import { Capacitor, registerPlugin } from '@capacitor/core';

type IconId = 'route' | 'heart' | 'night' | 'cream';
type RouteAppIconPlugin = { setIcon(options: { icon: IconId }): Promise<{ icon: IconId }> };

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

function updateNotice(message: string) {
  window.setTimeout(() => {
    const notice = document.querySelector<HTMLElement>('.more-sheet-notice');
    if (notice) notice.textContent = message;
  }, 20);
}

document.addEventListener('click', (event) => {
  const target = event.target as Element | null;
  const button = target?.closest<HTMLButtonElement>('.app-icon-picker button');
  if (!button || !Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') return;

  // The icon selector must be handled only by ROUTE. Prevent WebView/file/installer navigation.
  event.preventDefault();
  event.stopImmediatePropagation();
  if (changing) return;

  const icon = iconIdFromButton(button);
  if (!icon) return;
  changing = true;
  button.disabled = true;
  updateNotice('앱 아이콘을 변경하고 있어요…');

  void RouteAppIcon.setIcon({ icon })
    .then(() => {
      localStorage.setItem('route-app-icon', icon);
      updateNotice('핸드폰 홈 화면의 ROUTE 아이콘을 변경했어요. 런처 반영에는 몇 초 걸릴 수 있어요.');
    })
    .catch((cause) => {
      console.error('[ROUTE app icon]', cause);
      updateNotice('앱 아이콘 변경에 실패했어요. 앱을 종료하지 말고 다시 선택해 주세요.');
    })
    .finally(() => {
      changing = false;
      button.disabled = false;
    });
}, true);
