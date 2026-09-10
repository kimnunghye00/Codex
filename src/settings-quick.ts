import { signOut } from 'firebase/auth';
import { auth } from './lib/firebaseAuth';
import './settings-quick.css';

type QuickSetting = {
  icon: string;
  title: string;
  target: string;
  description: string;
};

declare global {
  interface Window {
    __routeQuickSettingsBypass?: boolean;
  }
}

const QUICK_GRID: QuickSetting[] = [
  { icon: '👤', title: '내 프로필', target: '내 프로필', description: '이름 · 사진' },
  { icon: '🔔', title: '알림', target: '알림 및 최근 활동', description: '알림 관리' },
  { icon: '🎨', title: '테마', target: '테마', description: '화면 꾸미기' },
  { icon: '📱', title: '앱 아이콘', target: '앱 아이콘', description: '아이콘 변경' },
  { icon: '🔐', title: '비밀번호', target: '비밀번호 변경', description: '비밀번호 변경' },
  { icon: '📍', title: '위치', target: '위치 및 발자취', description: '위치 공유' },
  { icon: '💾', title: '대화 백업', target: '대화내용 백업', description: '내보내기' },
  { icon: '🌙', title: '다크 모드', target: '시스템 다크 모드 연동', description: '화면 모드' },
];

const FREQUENT_ROWS: QuickSetting[] = [
  { icon: '💬', title: '채팅 알림', target: '채팅 알림', description: '새 메시지 알림을 빠르게 확인해요.' },
  { icon: '🎂', title: '기념일 알림', target: '기념일 알림', description: '다가오는 기념일과 약속 알림을 관리해요.' },
  { icon: '🖼️', title: '사진 및 영상 화질', target: '사진 및 영상 화질', description: '전송 화질과 데이터 사용량을 설정해요.' },
  { icon: '🔒', title: '앱 잠금', target: '앱 잠금', description: 'ROUTE 실행 시 잠금 사용 여부를 설정해요.' },
];

function closeQuickSettings() {
  document.querySelector('.route-quick-settings-backdrop')?.remove();
  document.body.classList.remove('route-quick-settings-open');
}

async function logoutFromQuickSettings() {
  if (!auth.currentUser) {
    closeQuickSettings();
    return;
  }
  if (!window.confirm('ROUTE에서 로그아웃할까요?')) return;

  try {
    await signOut(auth);
    closeQuickSettings();
  } catch (cause) {
    console.error('[ROUTE logout]', cause);
    window.alert('로그아웃하지 못했어요. 네트워크 연결을 확인한 뒤 다시 시도해 주세요.');
  }
}

function settingsButton() {
  return document.querySelector<HTMLButtonElement>('.header-actions button[aria-label="설정"]');
}

function openFullSettings(target?: string) {
  closeQuickSettings();
  const trigger = settingsButton();
  if (!trigger) return;

  window.__routeQuickSettingsBypass = true;
  trigger.click();

  if (!target) return;
  window.setTimeout(() => {
    const rows = Array.from(document.querySelectorAll<HTMLElement>('.route-settings-row'));
    const row = rows.find((item) => item.textContent?.replace(/\s+/g, ' ').trim().includes(target));
    const interactive = row?.matches('button') ? row as HTMLButtonElement : row?.querySelector<HTMLButtonElement>('button');
    interactive?.click();
  }, 20);
}

function quickGridButton(item: QuickSetting) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'route-quick-setting';
  button.setAttribute('aria-label', `${item.title} 설정 열기`);
  button.innerHTML = `<span class="route-quick-setting-icon" aria-hidden="true">${item.icon}</span><span>${item.title}</span>`;
  button.addEventListener('click', () => openFullSettings(item.target));
  return button;
}

function frequentRow(item: QuickSetting) {
  const button = document.createElement('button');
  button.type = 'button';
  button.innerHTML = `<span aria-hidden="true">${item.icon}</span><span><b>${item.title}</b><small>${item.description}</small></span><span class="route-quick-settings-chevron" aria-hidden="true">›</span>`;
  button.addEventListener('click', () => openFullSettings(item.target));
  return button;
}

function openQuickSettings() {
  closeQuickSettings();

  const backdrop = document.createElement('div');
  backdrop.className = 'route-quick-settings-backdrop';
  backdrop.setAttribute('role', 'dialog');
  backdrop.setAttribute('aria-modal', 'true');
  backdrop.setAttribute('aria-label', '빠른 설정');

  const panel = document.createElement('section');
  panel.className = 'route-quick-settings';

  const header = document.createElement('header');
  header.innerHTML = '<button type="button" class="route-quick-settings-back" aria-label="빠른 설정 닫기">‹</button><strong>설정</strong><span></span>';
  header.querySelector<HTMLButtonElement>('button')?.addEventListener('click', closeQuickSettings);

  const body = document.createElement('div');
  body.className = 'route-quick-settings-body';
  body.innerHTML = '<div class="route-quick-settings-intro"><small>QUICK SETTINGS</small><h1>자주 쓰는 설정</h1><p>자주 변경하는 항목은 바로 열고, 나머지는 전체 설정에서 확인할 수 있어요.</p></div>';

  const grid = document.createElement('div');
  grid.className = 'route-quick-settings-grid';
  grid.append(...QUICK_GRID.map(quickGridButton));

  const frequentTitle = document.createElement('div');
  frequentTitle.className = 'route-quick-settings-frequent';
  frequentTitle.textContent = '자주 찾는 항목';

  const list = document.createElement('div');
  list.className = 'route-quick-settings-list';
  list.append(...FREQUENT_ROWS.map(frequentRow));

  const all = document.createElement('button');
  all.type = 'button';
  all.className = 'route-quick-settings-all';
  all.innerHTML = '<span aria-hidden="true">⚙️</span><span><b>전체 설정</b><small>계정, 알림, 채팅, 화면, 보안, 앱 정보를 모두 확인해요.</small></span><span class="route-quick-settings-chevron" aria-hidden="true">›</span>';
  all.addEventListener('click', () => openFullSettings());

  const logout = document.createElement('button');
  logout.type = 'button';
  logout.className = 'route-quick-settings-all !mt-3 !border-[#f0d9db] !text-[#c34c56]';
  logout.setAttribute('aria-label', 'ROUTE 로그아웃');
  logout.innerHTML = '<span class="!bg-[#fff0f1] !text-[#c34c56]" aria-hidden="true">↪</span><span><b>로그아웃</b><small>이 기기에서 현재 ROUTE 계정의 로그인 상태를 종료해요.</small></span><span class="route-quick-settings-chevron" aria-hidden="true">›</span>';
  logout.addEventListener('click', () => void logoutFromQuickSettings());

  body.append(grid, frequentTitle, list, all, logout);
  panel.append(header, body);
  backdrop.append(panel);
  backdrop.addEventListener('pointerdown', (event) => {
    if (event.target === backdrop) closeQuickSettings();
  });
  document.body.append(backdrop);
  document.body.classList.add('route-quick-settings-open');
}

document.addEventListener('click', (event) => {
  const target = event.target as Element | null;
  const button = target?.closest<HTMLButtonElement>('.header-actions button[aria-label="설정"]');
  if (!button) return;

  if (window.__routeQuickSettingsBypass) {
    window.__routeQuickSettingsBypass = false;
    return;
  }

  event.preventDefault();
  event.stopImmediatePropagation();
  openQuickSettings();
}, true);

window.addEventListener('route-native-back', (event) => {
  if (!document.querySelector('.route-quick-settings-backdrop')) return;
  event.preventDefault();
  closeQuickSettings();
});
