let bypassChatQuickSettings = false;

function closeChatQuickSettings() {
  document.querySelector('.route-chat-quick-settings-backdrop')?.remove();
  document.body.classList.remove('route-chat-quick-settings-open');
}

function findButtonByText(selector: string, text: string) {
  return Array.from(document.querySelectorAll<HTMLButtonElement>(selector))
    .find((button) => button.textContent?.replace(/\s+/g, ' ').trim().includes(text));
}

function openOriginalChatSettings(targetLabel?: string) {
  closeChatQuickSettings();
  bypassChatQuickSettings = true;
  const featureButton = findButtonByText('.chat-tools-menu > button', '기능 / 옵션');
  featureButton?.click();
  queueMicrotask(() => { bypassChatQuickSettings = false; });

  if (!targetLabel) return;
  window.setTimeout(() => {
    if (targetLabel === '이모티콘 설정') {
      document.querySelector<HTMLButtonElement>('.chat-setting-link')?.click();
      return;
    }
    const cards = Array.from(document.querySelectorAll<HTMLElement>('.chat-setting-card'));
    const target = cards.find((card) => card.textContent?.includes(targetLabel));
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    target.classList.add('route-chat-setting-focus');
    window.setTimeout(() => target.classList.remove('route-chat-setting-focus'), 900);
  }, 80);
}

function quickButton(icon: string, title: string, description: string, action: () => void) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'route-chat-quick-item';
  button.innerHTML = `<span class="route-chat-quick-icon">${icon}</span><span><b>${title}</b><small>${description}</small></span><em>›</em>`;
  button.addEventListener('click', action);
  return button;
}

function openChatQuickSettings() {
  closeChatQuickSettings();

  const backdrop = document.createElement('div');
  backdrop.className = 'route-chat-quick-settings-backdrop';
  backdrop.setAttribute('role', 'dialog');
  backdrop.setAttribute('aria-modal', 'true');
  backdrop.setAttribute('aria-label', '대화방 빠른 설정');

  const sheet = document.createElement('section');
  sheet.className = 'route-chat-quick-settings';
  sheet.innerHTML = `
    <header>
      <div><small>CHAT SETTINGS</small><h2>대화방 설정</h2></div>
      <button type="button" class="route-chat-quick-close" aria-label="닫기">×</button>
    </header>
    <div class="route-chat-quick-intro">
      <b>자주 쓰는 설정</b>
      <small>대화방에서 자주 바꾸는 기능만 먼저 모았어요.</small>
    </div>
    <div class="route-chat-quick-list"></div>
    <button type="button" class="route-chat-all-settings">
      <span>⚙️</span>
      <span><b>전체 대화방 설정</b><small>배경, 글꼴, 화질, 백업, 이모티콘 설정을 모두 확인</small></span>
      <em>›</em>
    </button>`;

  const list = sheet.querySelector<HTMLElement>('.route-chat-quick-list')!;
  list.append(
    quickButton('🎨', '대화방 배경', '대화방 분위기와 배경 변경', () => openOriginalChatSettings('배경')),
    quickButton('Aa', '글자 크기', '메시지 글자 크기 조절', () => openOriginalChatSettings('글꼴 크기')),
    quickButton('🖼️', '사진·영상 화질', '전송 화질과 데이터 사용량 설정', () => openOriginalChatSettings('사진 및 영상 전송 퀄리티')),
    quickButton('💾', '대화내용 백업', '대화 내보내기 및 불러오기', () => openOriginalChatSettings('대화내용 백업')),
    quickButton('😊', '이모티콘 설정', '순서 변경과 구매 복원', () => openOriginalChatSettings('이모티콘 설정')),
  );

  sheet.querySelector<HTMLButtonElement>('.route-chat-quick-close')?.addEventListener('click', closeChatQuickSettings);
  sheet.querySelector<HTMLButtonElement>('.route-chat-all-settings')?.addEventListener('click', () => openOriginalChatSettings());
  backdrop.addEventListener('pointerdown', (event) => { if (event.target === backdrop) closeChatQuickSettings(); });
  backdrop.append(sheet);
  document.body.append(backdrop);
  document.body.classList.add('route-chat-quick-settings-open');
}

document.addEventListener('click', (event) => {
  if (bypassChatQuickSettings) return;
  const target = event.target as Element | null;
  const button = target?.closest<HTMLButtonElement>('.chat-tools-menu > button');
  if (!button || !button.textContent?.includes('기능 / 옵션')) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  openChatQuickSettings();
}, true);

window.addEventListener('route-native-back', (event) => {
  if (!document.querySelector('.route-chat-quick-settings-backdrop')) return;
  event.preventDefault();
  closeChatQuickSettings();
});
