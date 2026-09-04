import { Capacitor, registerPlugin } from '@capacitor/core';

type IconId = 'route' | 'heart' | 'night' | 'cream';
type RouteAppIconPlugin = { setIcon(options: { icon: IconId }): Promise<{ icon: IconId }> };

const RouteAppIcon = registerPlugin<RouteAppIconPlugin>('RouteAppIcon');

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
  const icon = iconIdFromButton(button);
  if (!icon) return;

  void RouteAppIcon.setIcon({ icon })
    .then(() => updateNotice('핸드폰 홈 화면의 ROUTE 앱 아이콘까지 변경했어요. 런처에 따라 반영까지 잠시 걸릴 수 있어요.'))
    .catch((cause) => {
      console.error('[ROUTE app icon]', cause);
      updateNotice('핸드폰 앱 아이콘을 변경하지 못했어요. 새 APK 설치 후 다시 시도해 주세요.');
    });
}, true);
