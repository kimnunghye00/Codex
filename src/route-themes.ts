type RouteTheme = {
  id: string;
  name: string;
  description: string;
  colors: [string, string, string, string];
  isDefault?: boolean;
};

const STORAGE_KEY = 'route-theme-v2';
const DEFAULT_THEME = 'sunset-route';

const themes: RouteTheme[] = [
  { id: 'sunset-route', name: 'Sunset Route', description: '테라코타 · 웜 샌드 · 크림 · 딥 브릭', colors: ['#E07A5F', '#F4F1DE', '#FAF8F5', '#3D405B'], isDefault: true },
  { id: 'midnight-walk', name: 'Midnight Walk', description: '미드나잇 · 다크 블루 · 문라이트 · 나이트', colors: ['#0E2755', '#4B5F86', '#FAF8E5', '#1E2338'] },
  { id: 'forest-trail', name: 'Forest Trail', description: '포레스트 · 그린 · 크림 · 딥 그린', colors: ['#2F6B45', '#6B9B57', '#AFBF95', '#35513A'] },
  { id: 'spring-blossom', name: 'Spring Blossom', description: '봄꽃 핑크 4단 조합', colors: ['#D95F82', '#ED8FA8', '#F2B6C7', '#F8DDE6'] },
  { id: 'ocean-drive', name: 'Ocean Drive', description: '오션 블루 · 터키석 · 화이트 · 딥 블루', colors: ['#3F8EC6', '#43AEC4', '#CBE8EE', '#2F6F8F'] },
  { id: 'lavender-fog', name: 'Lavender Fog', description: '라벤더 · 퍼플 · 브라이트 포그 · 딥 브릭', colors: ['#9E8FC5', '#A788BB', '#E7DDF0', '#3D405B'] },
  { id: 'autumn-breeze', name: 'Autumn Breeze', description: '테라코타 · 샌드 · 크림 · 딥 브릭', colors: ['#E07A5F', '#E89B47', '#F4F1DE', '#914A36'] },
  { id: 'champagne-day', name: 'Champagne Day', description: '웜 샌드 · 샴페인 · 크림 · 웜 화이트', colors: ['#E4CDA7', '#D9B75D', '#FAF8F5', '#EADCCB'] },
  { id: 'mono-track', name: 'Mono Track', description: '화이트 · 그레이 · 차콜 · 블랙', colors: ['#EFEFEF', '#909398', '#606368', '#000000'] },
  { id: 'neon-night', name: 'Neon Night', description: '딥 퍼플 · 네온 바이올렛 · 드림 블루 · 네온 핑크', colors: ['#170D2C', '#6F2DBD', '#243B6B', '#D130B0'] },
];

type ThemePreviewPalette = {
  primary: string;
  primaryLight: string;
  soft: string;
  background: string;
  surface: string;
  surfaceElevated: string;
  text: string;
  muted: string;
  border: string;
  accent: string;
  emotion: string;
};

const previewPalettes: Record<string, ThemePreviewPalette> = {
  'sunset-route': { primary:'#3D405B', primaryLight:'#B8563F', soft:'#F4E8DE', background:'#FAF8F5', surface:'#FFFFFF', surfaceElevated:'#FFFFFF', text:'#34364C', muted:'#625D58', border:'#D9CFC4', accent:'#A84D38', emotion:'#B8563F' },
  'midnight-walk': { primary:'#526A9B', primaryLight:'#8297C7', soft:'#27364E', background:'#101725', surface:'#1A2435', surfaceElevated:'#202C40', text:'#F8FAFC', muted:'#CBD5E1', border:'#43526A', accent:'#526A9B', emotion:'#E8D99A' },
  'forest-trail': { primary:'#2F6B45', primaryLight:'#4F825B', soft:'#E3EDD8', background:'#F3F8ED', surface:'#FFFFFF', surfaceElevated:'#FFFFFF', text:'#294433', muted:'#55635A', border:'#C9D8BE', accent:'#2F6B45', emotion:'#3F774E' },
  'spring-blossom': { primary:'#9F3159', primaryLight:'#BE4F73', soft:'#F8E4EA', background:'#FFF6F8', surface:'#FFFFFF', surfaceElevated:'#FFFFFF', text:'#5E3342', muted:'#765461', border:'#E9CBD4', accent:'#A43B61', emotion:'#A83A61' },
  'ocean-drive': { primary:'#2F6F8F', primaryLight:'#3D829F', soft:'#E0F1F5', background:'#F2FAFC', surface:'#FFFFFF', surfaceElevated:'#FFFFFF', text:'#24556C', muted:'#4F7080', border:'#C3DEE5', accent:'#2F6F8F', emotion:'#2E7892' },
  'lavender-fog': { primary:'#5E527A', primaryLight:'#7B69A1', soft:'#EEE7F5', background:'#F8F5FB', surface:'#FFFFFF', surfaceElevated:'#FFFFFF', text:'#4D4660', muted:'#696276', border:'#D7CDE2', accent:'#6F5A9C', emotion:'#705B91' },
  'autumn-breeze': { primary:'#8A442F', primaryLight:'#B85C3F', soft:'#F7E3D3', background:'#FFF7EE', surface:'#FFFFFF', surfaceElevated:'#FFFFFF', text:'#60382D', muted:'#765349', border:'#E5C6B1', accent:'#A84C2D', emotion:'#A74B2C' },
  'champagne-day': { primary:'#715C43', primaryLight:'#8A7356', soft:'#F4E9D2', background:'#FFFCF4', surface:'#FFFFFF', surfaceElevated:'#FFFFFF', text:'#51463B', muted:'#6D6257', border:'#DED2BE', accent:'#715C43', emotion:'#7A6544' },
  'mono-track': { primary:'#303236', primaryLight:'#55595F', soft:'#ECEDEF', background:'#F6F6F6', surface:'#FFFFFF', surfaceElevated:'#FFFFFF', text:'#202124', muted:'#595D62', border:'#CFD1D4', accent:'#45484D', emotion:'#4E5257' },
  'neon-night': { primary:'#6F2DBD', primaryLight:'#9B62D7', soft:'#2D1748', background:'#100A20', surface:'#1B1030', surfaceElevated:'#24143E', text:'#FBF7FF', muted:'#D8C7E8', border:'#57366F', accent:'#7D3CBF', emotion:'#C44AAE' },
};

const validTheme = (value: string | null) => themes.some((theme) => theme.id === value) ? value! : DEFAULT_THEME;
const activeTheme = () => validTheme(localStorage.getItem(STORAGE_KEY));
const themeById = (id: string) => themes.find((theme) => theme.id === id) ?? themes[0];

const LEGACY_INLINE_THEME_VARS = [
  '--primary', '--primary-light', '--primary-soft', '--background', '--surface', '--surface-elevated',
  '--text-primary', '--text-secondary', '--border', '--emotion', '--route-accent', '--route-accent-soft',
  '--accent-text', '--on-primary', '--on-accent', '--control-bg', '--placeholder',
] as const;

function applyTheme(id: string) {
  const next = validTheme(id);

  // Older builds wrote palette colors directly on <html>. Inline styles outrank the
  // stylesheet and caused combinations such as green-on-green or dark-on-dark.
  // Clear those values first and let the contrast-safe semantic palette CSS own them.
  LEGACY_INLINE_THEME_VARS.forEach((name) => document.documentElement.style.removeProperty(name));

  document.documentElement.dataset.routeTheme = next;
  localStorage.setItem(STORAGE_KEY, next);

  // The old three-theme system uses data-meluni-theme. Keep it neutral so its dark/
  // lavender rules can never overwrite the current ROUTE palette.
  document.documentElement.dataset.meluniTheme = 'default';
}

function makeThemeButton(theme: RouteTheme, selectedId: string, onSelect: (id: string) => void) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `route-theme-option${theme.id === selectedId ? ' active' : ''}`;
  button.dataset.routeThemeOption = theme.id;
  button.style.setProperty('--option-primary', theme.colors[3]);
  button.style.setProperty('--option-accent', theme.colors[0]);

  const swatch = document.createElement('span');
  swatch.className = 'route-theme-swatch four-color';
  theme.colors.forEach((color) => {
    const chip = document.createElement('i');
    chip.style.background = color;
    swatch.appendChild(chip);
  });

  const copy = document.createElement('span');
  copy.className = 'route-theme-copy';
  const titleRow = document.createElement('span');
  titleRow.className = 'route-theme-title-row';
  const title = document.createElement('b');
  title.textContent = theme.name;
  titleRow.append(title);
  if (theme.isDefault) {
    const badge = document.createElement('em');
    badge.textContent = '기본';
    titleRow.append(badge);
  }
  const description = document.createElement('small');
  description.textContent = theme.description;
  copy.append(titleRow, description);
  button.append(swatch, copy);
  button.addEventListener('click', () => onSelect(theme.id));
  return button;
}

function previewTextColor(hex: string) {
  const value = hex.replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(value)) return '#FFFFFF';
  const red = Number.parseInt(value.slice(0, 2), 16);
  const green = Number.parseInt(value.slice(2, 4), 16);
  const blue = Number.parseInt(value.slice(4, 6), 16);
  const brightness = (red * 299 + green * 587 + blue * 114) / 1000;
  return brightness > 160 ? '#263044' : '#FFFFFF';
}

function updatePreview(preview: HTMLElement, theme: RouteTheme) {
  const palette = previewPalettes[theme.id] ?? previewPalettes[DEFAULT_THEME];
  preview.style.setProperty('--preview-accent', palette.accent);
  preview.style.setProperty('--preview-soft', palette.soft);
  preview.style.setProperty('--preview-bg', palette.background);
  preview.style.setProperty('--preview-primary', palette.primary);
  preview.style.setProperty('--preview-primary-light', palette.primaryLight);
  preview.style.setProperty('--preview-surface', palette.surface);
  preview.style.setProperty('--preview-surface-elevated', palette.surfaceElevated);
  preview.style.setProperty('--preview-text', palette.text);
  preview.style.setProperty('--preview-muted', palette.muted);
  preview.style.setProperty('--preview-border', palette.border);
  preview.style.setProperty('--preview-emotion', palette.emotion);
  preview.style.setProperty('--preview-on-primary', previewTextColor(palette.primary));
  preview.style.setProperty('--preview-on-accent', previewTextColor(palette.accent));
}

function makePreview(theme: RouteTheme) {
  const preview = document.createElement('div');
  preview.className = 'route-theme-preview';
  preview.innerHTML = `
    <div class="route-theme-preview-tabs" role="tablist" aria-label="테마 미리보기 화면">
      <button type="button" class="active" role="tab" aria-selected="true" data-route-preview-tab="home">홈</button>
      <button type="button" role="tab" aria-selected="false" tabindex="-1" data-route-preview-tab="chat">대화방</button>
    </div>

    <div class="route-theme-preview-stage">
      <div class="route-theme-preview-screen active" role="tabpanel" data-route-preview-screen="home">
        <div class="route-theme-preview-phone route-theme-preview-home route-theme-preview-real-home">
          <div class="route-theme-preview-home-topbar">
            <strong>ROUTE.</strong>
            <span><i></i><i></i></span>
          </div>

          <div class="route-theme-preview-home-grid">
            <div class="route-theme-preview-map">
              <div class="route-theme-preview-map-grid"></div>
              <span class="route-theme-preview-map-road road-one"></span>
              <span class="route-theme-preview-map-road road-two"></span>
              <span class="route-theme-preview-map-river"></span>
              <span class="route-theme-preview-map-label label-route">ROUTE</span>
              <span class="route-theme-preview-map-label label-cafe">카페</span>
              <span class="route-theme-preview-map-label label-park">공원</span>
              <div class="route-theme-preview-location-card">
                <span class="route-theme-preview-pin-dot">●</span>
                <span><b>상대방 · 위치 공유</b><small>최근 위치를 확인해보세요</small></span>
              </div>
              <div class="route-theme-preview-map-person">
                <span class="route-theme-preview-map-halo"></span>
                <span class="route-theme-preview-map-avatar">상</span>
                <b>▼</b>
              </div>
              <span class="route-theme-preview-locate">◎</span>
            </div>

            <aside class="route-theme-preview-home-side">
              <section class="route-theme-preview-couple-card">
                <div class="route-theme-preview-person me">
                  <span class="route-theme-preview-person-avatar">나</span>
                  <b>능희</b>
                </div>
                <svg viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden="true"><path d="M0 20 C22 20 29 6 50 6 C71 6 78 20 100 20"></path></svg>
                <span class="route-theme-preview-heart">♥</span>
                <div class="route-theme-preview-person partner">
                  <span class="route-theme-preview-person-avatar">상</span>
                  <b>상대방</b>
                </div>
                <div class="route-theme-preview-time">
                  <small>우리의 시간</small>
                  <strong>D+821</strong>
                  <em>2024.06.15</em>
                </div>
              </section>

              <section class="route-theme-preview-schedule">
                <header><span>▣</span><b>우리 일정</b><small>전체보기 ›</small></header>
                <div class="route-theme-preview-schedule-row">
                  <span><b>오늘</b><small>19:00</small></span>
                  <p><strong>저녁 데이트</strong><small>우리의 약속</small></p>
                  <em>약속</em>
                </div>
              </section>

              <section class="route-theme-preview-memory">
                <header><span>▧</span><b>우리의 추억</b><small>전체보기 ›</small></header>
                <div>
                  <i class="tile-a"></i><i class="tile-b"></i><i class="tile-c"></i><i class="tile-d"></i>
                </div>
              </section>

              <section class="route-theme-preview-recent-chat">
                <header><span>●</span><b>최근 대화</b><small>전체보기 ›</small></header>
                <div><span class="route-theme-preview-chat-avatar">상</span><p><b>상대방</b><small>오늘 저녁 같이 먹을래?</small></p></div>
              </section>
            </aside>
          </div>

          <div class="route-theme-preview-home-nav">
            <span class="active"><i>⌂</i><b>홈</b></span>
            <span><i>♡</i><b>추억</b></span>
            <span><i>○</i><b>대화</b></span>
            <span><i>⌖</i><b>지도</b></span>
            <span><i>•••</i><b>더보기</b></span>
          </div>
        </div>
      </div>

      <div class="route-theme-preview-screen" role="tabpanel" data-route-preview-screen="chat" hidden>
        <div class="route-theme-preview-phone route-theme-preview-chat">
          <div class="route-theme-preview-chat-top">
            <span class="route-theme-preview-avatar">♥</span>
            <span class="route-theme-preview-chat-copy"><b>우리 대화</b><small>함께한 지 821일</small></span>
            <span class="route-theme-preview-chat-actions">♡ ⋯</span>
          </div>
          <div class="route-theme-preview-chat-pin"><span>📅</span><b>이번 주 토요일 · 데이트</b></div>
          <div class="route-theme-preview-chat-body">
            <div class="route-theme-preview-message received">
              <span class="route-theme-preview-mini-avatar">♥</span>
              <div><small>상대방</small><p>오늘 저녁 같이 먹을래?</p></div>
            </div>
            <div class="route-theme-preview-message mine">
              <div><p>좋아! 끝나고 연락할게 ♥</p><small>오후 6:42</small></div>
            </div>
          </div>
          <div class="route-theme-preview-composer"><span>＋</span><em>메시지 보내기</em><b>GIF</b></div>
        </div>
      </div>
    </div>`;

  const selectScreen = (screen: 'home' | 'chat') => {
    preview.querySelectorAll<HTMLButtonElement>('[data-route-preview-tab]').forEach((button) => {
      const active = button.dataset.routePreviewTab === screen;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
      button.tabIndex = active ? 0 : -1;
    });
    preview.querySelectorAll<HTMLElement>('[data-route-preview-screen]').forEach((panel) => {
      const active = panel.dataset.routePreviewScreen === screen;
      panel.classList.toggle('active', active);
      panel.hidden = !active;
    });
  };

  preview.querySelectorAll<HTMLButtonElement>('[data-route-preview-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      const screen = button.dataset.routePreviewTab;
      if (screen !== 'home' && screen !== 'chat') return;
      selectScreen(screen);
    });
  });

  updatePreview(preview, theme);
  return preview;
}

function removeThemeSheet() {
  document.querySelector('.route-theme-overlay')?.remove();
  document.body.classList.remove('route-theme-sheet-open');
}

function openThemeSheet() {
  removeThemeSheet();
  let pendingId = activeTheme();
  const overlay = document.createElement('div');
  overlay.className = 'route-theme-overlay';
  const sheet = document.createElement('section');
  sheet.className = 'route-theme-sheet';
  const handle = document.createElement('div');
  handle.className = 'route-theme-sheet-handle';
  const header = document.createElement('div');
  header.className = 'route-theme-sheet-header';
  const heading = document.createElement('div');
  heading.innerHTML = '<small>ROUTE THEME</small><h2>테마 선택</h2><p>홈과 대화방 미리보기를 확인하고 4색 조합을 비교하세요.</p>';
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'route-theme-sheet-close';
  close.setAttribute('aria-label', '테마 적용하고 닫기');
  close.textContent = '×';
  header.append(heading, close);
  const preview = makePreview(themeById(pendingId));
  const options = document.createElement('div');
  options.className = 'route-theme-sheet-options';
  const refresh = () => {
    const selected = themeById(pendingId);
    updatePreview(preview, selected);
    options.querySelectorAll<HTMLButtonElement>('[data-route-theme-option]').forEach((button) => button.classList.toggle('active', button.dataset.routeThemeOption === pendingId));
  };
  options.append(...themes.map((theme) => makeThemeButton(theme, pendingId, (id) => { pendingId = id; refresh(); })));
  const note = document.createElement('p');
  note.className = 'route-theme-sheet-note';
  note.textContent = '닫으면 선택한 테마가 저장되고 다음 실행에도 유지돼요.';
  const commit = () => { applyTheme(pendingId); removeThemeSheet(); };
  close.addEventListener('click', commit);
  overlay.addEventListener('pointerdown', (event) => { if (event.target === overlay) commit(); });
  sheet.append(handle, header, preview, options, note);
  overlay.append(sheet);
  document.body.append(overlay);
  document.body.classList.add('route-theme-sheet-open');
}

function isThemeButton(target: EventTarget | null) {
  const button = target instanceof Element ? target.closest('button') : null;
  if (!button) return false;
  const text = button.textContent?.trim() ?? '';
  return text === '테마' || text.startsWith('테마');
}

document.addEventListener('click', (event) => {
  if (!isThemeButton(event.target)) return;
  const button = (event.target as Element).closest('button');
  if (!button?.closest('.more-page, .route-more-services')) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  openThemeSheet();
}, true);

applyTheme(activeTheme());