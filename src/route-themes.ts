type RouteTheme = {
  id: string;
  name: string;
  description: string;
  primary: string;
  accent: string;
  isDefault?: boolean;
};

const STORAGE_KEY = 'route-theme-v2';
const DEFAULT_THEME = 'sunset-route';

const themes: RouteTheme[] = [
  { id: 'sunset-route', name: 'Sunset Route', description: '테라코타 · 웜 샌드 · 크림', primary: '#3D405B', accent: '#E07A5F', isDefault: true },
  { id: 'midnight-walk', name: 'Midnight Walk', description: '차분하고 깊은 야간 테마', primary: '#0E2755', accent: '#66779B' },
  { id: 'forest-trail', name: 'Forest Trail', description: '싱그러운 초록과 크림', primary: '#2F6B45', accent: '#6B9B57' },
  { id: 'spring-blossom', name: 'Spring Blossom', description: '봄꽃처럼 부드러운 핑크', primary: '#C94F76', accent: '#ED6F8C' },
  { id: 'ocean-drive', name: 'Ocean Drive', description: '맑은 바다색과 시원한 블루', primary: '#2F6F8F', accent: '#43AEC4' },
  { id: 'lavender-fog', name: 'Lavender Fog', description: '안개처럼 은은한 라벤더', primary: '#3D405B', accent: '#A788BB' },
  { id: 'autumn-breeze', name: 'Autumn Breeze', description: '따뜻한 가을 오렌지', primary: '#914A36', accent: '#E68634' },
  { id: 'champagne-day', name: 'Champagne Day', description: '샴페인 베이지와 크림', primary: '#8A7256', accent: '#D9B75D' },
  { id: 'mono-track', name: 'Mono Track', description: '절제된 모노톤', primary: '#303236', accent: '#606368' },
  { id: 'neon-night', name: 'Neon Night', description: '퍼플 네온 야간 테마', primary: '#170D2C', accent: '#D130B0' },
];

const validTheme = (value: string | null) => themes.some((theme) => theme.id === value) ? value! : DEFAULT_THEME;
const activeTheme = () => validTheme(localStorage.getItem(STORAGE_KEY));
const themeById = (id: string) => themes.find((theme) => theme.id === id) ?? themes[0];

function applyTheme(id: string) {
  const next = validTheme(id);
  document.documentElement.dataset.routeTheme = next;
  localStorage.setItem(STORAGE_KEY, next);
  localStorage.setItem('meluni-theme', next);
}

function makeThemeButton(theme: RouteTheme, selectedId: string, onSelect: (id: string) => void) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `route-theme-option${theme.id === selectedId ? ' active' : ''}`;
  button.dataset.routeThemeOption = theme.id;
  button.style.setProperty('--option-primary', theme.primary);
  button.style.setProperty('--option-accent', theme.accent);

  const swatch = document.createElement('span');
  swatch.className = 'route-theme-swatch';
  swatch.style.setProperty('--swatch-primary', theme.primary);
  swatch.style.setProperty('--swatch-accent', theme.accent);

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
  preview.style.setProperty('--preview-primary', theme.primary);
  preview.style.setProperty('--preview-accent', theme.accent);
  preview.style.setProperty('--preview-soft', `color-mix(in srgb, ${theme.accent} 23%, white)`);
  preview.style.setProperty('--preview-bg', `color-mix(in srgb, ${theme.accent} 10%, white)`);
}

function makePreview(theme: RouteTheme) {
  const preview = document.createElement('div');
  preview.className = 'route-theme-preview';
  preview.innerHTML = '<div class="route-theme-preview-phone"><div class="route-theme-preview-top"><strong>ROUTE.</strong><span>● ●</span></div><div class="route-theme-preview-hero"><small>OUR ROUTE</small><b>우리의 오늘</b><span>선택한 테마가 앱 전체에 적용돼요.</span></div><div class="route-theme-preview-row"><div class="route-theme-preview-card"><small>우리의 시간</small><b>D+821</b></div><div class="route-theme-preview-action"><b>♥ 최근 추억</b></div></div></div>';
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
  heading.innerHTML = '<small>ROUTE THEME</small><h2>테마 선택</h2><p>색상 조합을 미리 보고 원하는 테마를 선택하세요.</p>';
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
    options.querySelectorAll<HTMLButtonElement>('[data-route-theme-option]').forEach((button) => {
      button.classList.toggle('active', button.dataset.routeThemeOption === pendingId);
    });
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

const initialTheme = activeTheme();
document.documentElement.dataset.routeTheme = initialTheme;
if (!localStorage.getItem(STORAGE_KEY)) localStorage.setItem(STORAGE_KEY, DEFAULT_THEME);
