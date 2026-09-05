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

function updatePreview(preview: HTMLElement, theme: RouteTheme) {
  preview.style.setProperty('--preview-accent', theme.colors[0]);
  preview.style.setProperty('--preview-soft', theme.colors[1]);
  preview.style.setProperty('--preview-bg', theme.colors[2]);
  preview.style.setProperty('--preview-primary', theme.colors[3]);
}

function makePreview(theme: RouteTheme) {
  const preview = document.createElement('div');
  preview.className = 'route-theme-preview';
  preview.innerHTML = '<div class="route-theme-preview-phone"><div class="route-theme-preview-top"><strong>ROUTE.</strong><span>● ●</span></div><div class="route-theme-preview-hero"><small>OUR ROUTE</small><b>우리의 오늘</b><span>4가지 색이 앱 전체에 함께 적용돼요.</span></div><div class="route-theme-preview-row"><div class="route-theme-preview-card"><small>우리의 시간</small><b>D+821</b></div><div class="route-theme-preview-action"><b>♥ 최근 추억</b></div></div></div>';
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
  heading.innerHTML = '<small>ROUTE THEME</small><h2>테마 선택</h2><p>각 테마의 4색 조합을 확인하고 미리보기로 비교하세요.</p>';
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