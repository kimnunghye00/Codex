import { installRouteWebApp, isStandaloneWebApp } from './pwa';

let bypassSettingsHub = false;

function clickByText(selector: string, text: string) {
  const elements = Array.from(document.querySelectorAll<HTMLButtonElement>(selector));
  const found = elements.find((button) => button.textContent?.replace(/\s+/g, ' ').trim().includes(text));
  found?.click();
  return Boolean(found);
}

function closeHub() {
  document.querySelector('.route-settings-hub-backdrop')?.remove();
  document.body.classList.remove('route-settings-hub-open');
}

function openOriginalProfileSettings() {
  closeHub();
  bypassSettingsHub = true;
  document.querySelector<HTMLButtonElement>('.header-actions button[aria-label="설정"]')?.click();
  queueMicrotask(() => { bypassSettingsHub = false; });
}

function navigateMoreAndOpen(label: string) {
  closeHub();
  clickByText('.bottom-nav button', '더보기');
  window.setTimeout(() => clickByText('.more-service-grid button', label), 100);
}

function openChatBackup() {
  closeHub();
  clickByText('.bottom-nav button', '채팅');
  window.setTimeout(() => {
    const menu = document.querySelector<HTMLButtonElement>('.chat-call-actions button[aria-label="대화 메뉴"]');
    menu?.click();
    window.setTimeout(() => clickByText('.chat-tools-menu button', '기능 / 옵션'), 80);
  }, 100);
}

async function installWindowsApp() {
  const result = await installRouteWebApp();
  if (result === 'accepted') return;
  if (result === 'installed') return alert('ROUTE가 이미 Windows 앱으로 설치되어 있어요.');
  if (result === 'dismissed') return;
  if (result === 'native') return alert('Android/iOS 앱에서는 이 메뉴가 필요하지 않아요.');
  alert('Chrome 또는 Edge 오른쪽 위의 앱 설치 아이콘을 누르거나, 메뉴에서 “ROUTE 설치”를 선택해 주세요.');
}

function settingRow(icon: string, title: string, description: string, action: () => void, badge?: string) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'route-settings-row';
  button.innerHTML = `<span class="route-settings-row-icon">${icon}</span><span class="route-settings-row-copy"><b>${title}</b><small>${description}</small></span>${badge ? `<em>${badge}</em>` : ''}<span class="route-settings-chevron">›</span>`;
  button.addEventListener('click', action);
  return button;
}

function toggleRow(icon: string, title: string, description: string, key: string, defaultValue: boolean) {
  const row = document.createElement('div');
  row.className = 'route-settings-row route-settings-toggle-row';
  const saved = localStorage.getItem(key);
  let active = saved == null ? defaultValue : saved === '1';
  row.innerHTML = `<span class="route-settings-row-icon">${icon}</span><span class="route-settings-row-copy"><b>${title}</b><small>${description}</small></span><button class="route-switch ${active ? 'on' : ''}" type="button" role="switch" aria-checked="${active}"><i></i></button>`;
  const toggle = row.querySelector<HTMLButtonElement>('.route-switch')!;
  toggle.addEventListener('click', () => {
    active = !active;
    toggle.classList.toggle('on', active);
    toggle.setAttribute('aria-checked', String(active));
    localStorage.setItem(key, active ? '1' : '0');
  });
  return row;
}

function section(title: string, children: HTMLElement[]) {
  const wrap = document.createElement('section');
  wrap.className = 'route-settings-section';
  const heading = document.createElement('h3');
  heading.textContent = title;
  const list = document.createElement('div');
  list.className = 'route-settings-list';
  list.append(...children);
  wrap.append(heading, list);
  return wrap;
}

function openSettingsHub() {
  closeHub();
  const backdrop = document.createElement('div');
  backdrop.className = 'route-settings-hub-backdrop';
  backdrop.setAttribute('role', 'dialog');
  backdrop.setAttribute('aria-modal', 'true');

  const panel = document.createElement('div');
  panel.className = 'route-settings-hub';
  const header = document.createElement('header');
  header.innerHTML = '<button type="button" class="route-settings-back" aria-label="설정 닫기">‹</button><strong>설정</strong><span></span>';
  header.querySelector('button')?.addEventListener('click', closeHub);

  const body = document.createElement('div');
  body.className = 'route-settings-body';

  body.append(
    section('계정', [
      settingRow('👤', '내 프로필', '이름, 생년월일, 사진, 별명 수정', openOriginalProfileSettings),
      settingRow('💞', '상대방 프로필 및 연결', '연결 상태, 상대방 프로필과 별명 관리', openOriginalProfileSettings),
    ]),
    section('알림', [
      settingRow('🔔', '알림 및 최근 활동', 'ROUTE 알림 확인과 읽음 관리', () => {
        closeHub();
        bypassSettingsHub = true;
        document.querySelector<HTMLButtonElement>('.header-actions .notification-button')?.click();
        queueMicrotask(() => { bypassSettingsHub = false; });
      }),
      toggleRow('🎂', '기념일 알림', '다가오는 기념일과 약속 알림 받기', 'route-setting-anniversary-alerts', true),
      toggleRow('💬', '채팅 알림', '새 메시지 알림 받기', 'route-setting-chat-alerts', true),
    ]),
    section('채팅 및 데이터', [
      settingRow('💾', '대화내용 백업', '대화내용 내보내기 및 불러오기', openChatBackup),
      settingRow('🖼️', '사진 및 영상 화질', '전송 화질과 데이터 사용량 설정', openChatBackup),
      settingRow('😊', '이모티콘', '보유 이모티콘과 순서 관리', () => navigateMoreAndOpen('이모티콘')),
    ]),
    section('화면 및 꾸미기', [
      settingRow('🎨', '테마', '10가지 4색 조합과 앱 미리보기', () => navigateMoreAndOpen('테마')),
      settingRow('📱', '앱 아이콘', '홈 화면 ROUTE 아이콘 변경', () => navigateMoreAndOpen('앱 아이콘')),
      toggleRow('🌙', '시스템 다크 모드 연동', '기기 화면 모드를 참고해 표시', 'route-setting-system-dark', false),
    ]),
    section('앱 및 설치', [
      settingRow('🖥️', 'Windows 앱 설치', isStandaloneWebApp() ? '이 PC에 ROUTE가 설치되어 있어요' : '웹 버전을 Windows 앱처럼 설치', () => void installWindowsApp(), isStandaloneWebApp() ? '설치됨' : 'WEB'),
      settingRow('🌐', '웹 버전', '브라우저에서도 같은 계정과 데이터를 사용', () => alert(`현재 ROUTE 웹 주소\n${window.location.origin}${window.location.pathname}`)),
    ]),
    section('개인 / 보안', [
      toggleRow('🔒', '앱 잠금', 'ROUTE 실행 시 잠금 사용', 'route-setting-app-lock', false),
      settingRow('📍', '위치 및 발자취', '위치 공유와 발자취 설정 확인', () => {
        closeHub();
        clickByText('.bottom-nav button', '위치');
      }),
    ]),
    section('앱 정보', [
      settingRow('ⓘ', 'ROUTE 정보', 'Android, iOS, Windows, Web에서 같은 ROUTE 사용', () => alert('ROUTE 멀티플랫폼 테스트 버전\nAndroid는 APK 업데이트, Windows는 웹 앱 설치, Web은 브라우저에서 바로 사용할 수 있어요.')),
      settingRow('❓', '도움말', '자주 묻는 질문과 문제 해결', () => alert('문제가 생기면 오류 화면과 함께 알려주세요. ROUTE 기능별로 확인할 수 있어요.')),
    ]),
  );

  panel.append(header, body);
  backdrop.append(panel);
  backdrop.addEventListener('pointerdown', (event) => { if (event.target === backdrop) closeHub(); });
  document.body.append(backdrop);
  document.body.classList.add('route-settings-hub-open');
}

document.addEventListener('click', (event) => {
  if (bypassSettingsHub) return;
  const target = event.target as Element | null;
  const button = target?.closest<HTMLButtonElement>('.header-actions button[aria-label="설정"]');
  if (!button) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  openSettingsHub();
}, true);

window.addEventListener('route-native-back', (event) => {
  if (!document.querySelector('.route-settings-hub-backdrop')) return;
  event.preventDefault();
  closeHub();
});
