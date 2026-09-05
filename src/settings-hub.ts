import { EmailAuthProvider, reauthenticateWithCredential, updatePassword } from 'firebase/auth';
import { auth } from './lib/firebase';
import { SYSTEM_DARK_KEY, isSystemDarkEnabled, setSystemDarkEnabled } from './system-dark';

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

function closePasswordChange() {
  document.querySelector('.route-password-backdrop')?.remove();
  document.body.classList.remove('route-password-change-open');
}

function passwordChangeMessage(error: unknown) {
  const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : '';
  if (code === 'auth/invalid-credential' || code === 'auth/wrong-password') return '현재 비밀번호가 올바르지 않아요.';
  if (code === 'auth/weak-password') return '새 비밀번호는 6자 이상으로 설정해 주세요.';
  if (code === 'auth/requires-recent-login') return '보안을 위해 로그아웃 후 다시 로그인한 뒤 시도해 주세요.';
  if (code === 'auth/too-many-requests') return '시도가 너무 많아요. 잠시 후 다시 시도해 주세요.';
  if (code === 'auth/network-request-failed') return '네트워크 연결을 확인한 뒤 다시 시도해 주세요.';
  return code ? `비밀번호를 변경하지 못했어요. (${code})` : '비밀번호를 변경하지 못했어요. 잠시 후 다시 시도해 주세요.';
}

function openPasswordChange() {
  closeHub();
  closePasswordChange();
  const user = auth.currentUser;
  if (!user) return alert('로그인 상태를 확인할 수 없어요. 다시 로그인한 뒤 시도해 주세요.');

  const backdrop = document.createElement('div');
  backdrop.className = 'route-password-backdrop';
  backdrop.setAttribute('role', 'dialog');
  backdrop.setAttribute('aria-modal', 'true');
  backdrop.setAttribute('aria-label', '비밀번호 변경');

  const panel = document.createElement('div');
  panel.className = 'route-password-panel';
  panel.innerHTML = `
    <header>
      <button type="button" class="route-password-back" aria-label="비밀번호 변경 닫기">‹</button>
      <strong>비밀번호 변경</strong>
      <span></span>
    </header>
    <form class="route-password-form">
      <div class="route-password-intro">
        <span>🔐</span>
        <div><b>로그인 비밀번호를 바꿔요</b><small>현재 비밀번호를 확인한 뒤 새 비밀번호로 안전하게 변경해요.</small></div>
      </div>
      <label>현재 비밀번호<input name="currentPassword" required type="password" autocomplete="current-password" minlength="6" placeholder="현재 비밀번호" /></label>
      <label>새 비밀번호<input name="newPassword" required type="password" autocomplete="new-password" minlength="6" placeholder="6자 이상 입력하세요" /></label>
      <label>새 비밀번호 확인<input name="newPasswordConfirm" required type="password" autocomplete="new-password" minlength="6" placeholder="새 비밀번호를 한 번 더" /></label>
      <p class="route-password-feedback" role="status"></p>
      <button class="route-password-submit" type="submit">비밀번호 변경</button>
    </form>`;

  const form = panel.querySelector<HTMLFormElement>('.route-password-form')!;
  const submit = panel.querySelector<HTMLButtonElement>('.route-password-submit')!;
  const feedback = panel.querySelector<HTMLParagraphElement>('.route-password-feedback')!;
  panel.querySelector<HTMLButtonElement>('.route-password-back')?.addEventListener('click', closePasswordChange);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (submit.disabled) return;
    const data = new FormData(form);
    const currentPassword = String(data.get('currentPassword') ?? '');
    const newPassword = String(data.get('newPassword') ?? '');
    const newPasswordConfirm = String(data.get('newPasswordConfirm') ?? '');
    feedback.className = 'route-password-feedback';
    feedback.textContent = '';

    if (newPassword.length < 6) {
      feedback.textContent = '새 비밀번호는 6자 이상으로 설정해 주세요.';
      feedback.classList.add('error');
      return;
    }
    if (newPassword !== newPasswordConfirm) {
      feedback.textContent = '새 비밀번호가 서로 달라요.';
      feedback.classList.add('error');
      return;
    }
    if (currentPassword === newPassword) {
      feedback.textContent = '현재 비밀번호와 다른 새 비밀번호를 입력해 주세요.';
      feedback.classList.add('error');
      return;
    }
    if (!user.email) {
      feedback.textContent = '비밀번호 로그인 정보를 찾을 수 없어요. 로그인 화면의 비밀번호 찾기를 이용해 주세요.';
      feedback.classList.add('error');
      return;
    }

    submit.disabled = true;
    submit.textContent = '변경 중...';
    void (async () => {
      try {
        const credential = EmailAuthProvider.credential(user.email!, currentPassword);
        await reauthenticateWithCredential(user, credential);
        await updatePassword(user, newPassword);
        form.reset();
        feedback.textContent = '비밀번호가 변경됐어요. 다음 로그인부터 새 비밀번호를 사용해 주세요.';
        feedback.classList.add('success');
      } catch (cause) {
        feedback.textContent = passwordChangeMessage(cause);
        feedback.classList.add('error');
      } finally {
        submit.disabled = false;
        submit.textContent = '비밀번호 변경';
      }
    })();
  });

  backdrop.append(panel);
  backdrop.addEventListener('pointerdown', (event) => { if (event.target === backdrop) closePasswordChange(); });
  document.body.append(backdrop);
  document.body.classList.add('route-password-change-open');
  window.setTimeout(() => panel.querySelector<HTMLInputElement>('input[name="currentPassword"]')?.focus(), 0);
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

function settingRow(icon: string, title: string, description: string, action: () => void, badge?: string) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'route-settings-row';
  button.innerHTML = `<span class="route-settings-row-icon">${icon}</span><span class="route-settings-row-copy"><b>${title}</b><small>${description}</small></span>${badge ? `<em>${badge}</em>` : ''}<span class="route-settings-chevron">›</span>`;
  button.addEventListener('click', action);
  return button;
}

function toggleRow(
  icon: string,
  title: string,
  description: string,
  key: string,
  defaultValue: boolean,
  onChange?: (active: boolean) => void,
) {
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
    onChange?.(active);
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
      settingRow('🔐', '비밀번호 변경', '현재 비밀번호 확인 후 새 비밀번호 설정', openPasswordChange),
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
      toggleRow('🌙', '시스템 다크 모드 연동', '기기의 다크/라이트 모드에 자동으로 맞춤', SYSTEM_DARK_KEY, isSystemDarkEnabled(), setSystemDarkEnabled),
    ]),
    section('개인 / 보안', [
      toggleRow('🔒', '앱 잠금', 'ROUTE 실행 시 잠금 사용', 'route-setting-app-lock', false),
      settingRow('📍', '위치 및 발자취', '위치 공유와 발자취 설정 확인', () => {
        closeHub();
        clickByText('.bottom-nav button', '위치');
      }),
    ]),
    section('앱 정보', [
      settingRow('ⓘ', 'ROUTE 정보', 'Android, iOS, Windows, Web에서 같은 ROUTE 사용', () => alert('ROUTE 멀티플랫폼 테스트 버전\nAndroid는 APK, iOS는 iOS 빌드, Windows는 EXE 설치 파일로 업데이트할 수 있어요.')),
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
  if (document.querySelector('.route-password-backdrop')) {
    event.preventDefault();
    closePasswordChange();
    return;
  }
  if (!document.querySelector('.route-settings-hub-backdrop')) return;
  event.preventDefault();
  closeHub();
});
