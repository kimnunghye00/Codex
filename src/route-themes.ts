type RouteTheme = {
  id: string;
  name: string;
  description: string;
  primary: string;
  accent: string;
  isDefault?: boolean;
};

const STORAGE_KEY = 'route-theme-v2';
const DEFAULT_THEME = 'navy-coral';

const themes: RouteTheme[] = [
  { id: 'navy-coral', name: 'Navy + Coral', description: 'ROUTE 기본 테마', primary: '#1F2A44', accent: '#FF6F61', isDefault: true },
  { id: 'deep-green-sand', name: 'Deep Green + Sand Beige', description: '아늑함 + 안정감', primary: '#355C4B', accent: '#D9C7A3' },
  { id: 'blue-gray-lavender', name: 'Blue Gray + Lavender', description: '부드러움 + 현대적 감성', primary: '#5E718D', accent: '#B7A7D9' },
  { id: 'charcoal-mint', name: 'Charcoal + Mint', description: '미니멀 + 연결감', primary: '#2B2E34', accent: '#8ED1C6' },
  { id: 'burgundy-ivory', name: 'Burgundy + Warm Ivory', description: '성숙함 + 부드러움', primary: '#7A3E48', accent: '#F7EFEA' },
];

const validTheme = (value: string | null) => themes.some((theme) => theme.id === value) ? value! : DEFAULT_THEME;
const activeTheme = () => validTheme(localStorage.getItem(STORAGE_KEY));
const themeById = (id: string) => themes.find((theme) => theme.id === id) ?? themes[0];

function applyTheme(id: string) {
  const next = validTheme(id);
  document.documentElement.dataset.routeTheme = next;
  localStorage.setItem(STORAGE_KEY, next);
}

function makeThemeButton(theme: RouteTheme, selectedId: string, onSelect: (id: string) => void) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `route-theme-option${theme.id === selectedId ? ' active' : ''}`;
  button.dataset.routeThemeOption = theme.id;
  button.setAttribute('aria-pressed', String(theme.id === selectedId));
  button.style.setProperty('--option-primary', theme.primary);
  button.style.setProperty('--option-accent', theme.accent);

  const swatch = document.createElement('span');
  swatch.className = 'route-theme-swatch';
  swatch.style.setProperty('--swatch-primary', theme.primary);
  swatch.style.setProperty('--swatch-accent', theme.accent);
  swatch.setAttribute('aria-hidden', 'true');

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

  const check = document.createElement('span');
  check.className = 'route-theme-check';
  check.textContent = theme.id === selectedId ? '✓' : '';
  check.setAttribute('aria-hidden', 'true');

  button.append(swatch, copy, check);
  button.addEventListener('click', () => onSelect(theme.id));
  return button;
}

function makePreview(theme: RouteTheme) {
  const preview = document.createElement('div');
  preview.className = 'route-theme-preview';
  preview.setAttribute('aria-live', 'polite');

  const phone = document.createElement('div');
  phone.className = 'route-theme-preview-phone';

  const top = document.createElement('div');
  top.className = 'route-theme-preview-top';
  const brand = document.createElement('strong');
  brand.textContent = 'ROUTE.';
  const dots = document.createElement('span');
  dots.textContent = '●  ●';
  top.append(brand, dots);

  const hero = document.createElement('div');
  hero.className = 'route-theme-preview-hero';
  const heroSmall = document.createElement('small');
  heroSmall.textContent = 'OUR ROUTE';
  const heroTitle = document.createElement('b');
  heroTitle.textContent = '우리의 오늘';
  const heroCopy = document.createElement('span');
  heroCopy.textContent = '선택한 테마가 이런 느낌으로 적용돼요.';
  hero.append(heroSmall, heroTitle, heroCopy);

  const row = document.createElement('div');
  row.className = 'route-theme-preview-row';
  const card = document.createElement('div');
  card.className = 'route-theme-preview-card';
  card.innerHTML = '<small>우리의 시간</small><b>D+821</b><span>2024.06.01부터</span>';
  const action = document.createElement('div');
  action.className = 'route-theme-preview-action';
  action.innerHTML = '<span>♥</span><b>최근 추억</b>';
  row.append(card, action);

  const nav = document.createElement('div');
  nav.className = 'route-theme-preview-nav';
  nav.innerHTML = '<span class="active">⌂<small>홈</small></span><span>♡<small>추억</small></span><span>○<small>채팅</small></span><span>⌖<small>위치</small></span>';

  phone.append(top, hero, row, nav);
  preview.append(phone);
  updatePreview(preview, theme);
  return preview;
}

function updatePreview(preview: HTMLElement, theme: RouteTheme) {
  preview.style.setProperty('--preview-primary', theme.primary);
  preview.style.setProperty('--preview-accent', theme.accent);
  preview.style.setProperty('--preview-accent-soft', `color-mix(in srgb, ${theme.accent} 24%, white)`);
  preview.dataset.previewTheme = theme.id;
  preview.setAttribute('aria-label', `${theme.name} 테마 미리보기`);
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
  overlay.setAttribute('role', 'presentation');

  const sheet = document.createElement('section');
  sheet.className = 'route-theme-sheet';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.setAttribute('aria-labelledby', 'route-theme-sheet-title');

  const handle = document.createElement('div');
  handle.className = 'route-theme-sheet-handle';
  handle.setAttribute('aria-hidden', 'true');

  const header = document.createElement('div');
  header.className = 'route-theme-sheet-header';

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'route-theme-sheet-close';
  close.setAttribute('aria-label', '선택한 테마 적용하고 닫기');
  close.textContent = '×';

  const heading = document.createElement('div');
  const eyebrow = document.createElement('small');
  eyebrow.textContent = 'ROUTE THEME';
  const title = document.createElement('h2');
  title.id = 'route-theme-sheet-title';
  title.textContent = '테마 선택';
  const description = document.createElement('p');
  description.textContent = '테마를 눌러 미리 확인한 뒤, X 또는 바깥 화면을 누르면 적용돼요.';
  heading.append(eyebrow, title, description);
  header.append(close, heading);

  const preview = makePreview(themeById(pendingId));
  const options = document.createElement('div');
  options.className = 'route-theme-sheet-options';

  const updateSelectedState = () => {
    const selectedTheme = themeById(pendingId);
    updatePreview(preview, selectedTheme);
    options.querySelectorAll<HTMLButtonElement>('[data-route-theme-option]').forEach((button) => {
      const isActive = button.dataset.routeThemeOption === pendingId;
      button.classList.toggle('active', isActive);
      button.setAttribute('aria-pressed', String(isActive));
      const check = button.querySelector<HTMLElement>('.route-theme-check');
      if (check) check.textContent = isActive ? '✓' : '';
    });
  };

  const selectTheme = (id: string) => {
    pendingId = validTheme(id);
    updateSelectedState();
  };
  options.append(...themes.map((theme) => makeThemeButton(theme, pendingId, selectTheme)));

  const note = document.createElement('p');
  note.className = 'route-theme-sheet-note';
  note.textContent = '선택만으로는 아직 적용되지 않아요 · 창을 닫으면 적용됩니다.';

  const commitAndClose = () => {
    applyTheme(pendingId);
    removeThemeSheet();
    document.removeEventListener('keydown', onKeyDown);
  };

  close.addEventListener('click', commitAndClose);
  overlay.addEventListener('pointerdown', (event) => {
    if (event.target === overlay) commitAndClose();
  });

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') commitAndClose();
  };
  document.addEventListener('keydown', onKeyDown);

  sheet.append(handle, header, preview, options, note);
  overlay.append(sheet);
  document.body.append(overlay);
  document.body.classList.add('route-theme-sheet-open');
  close.focus();
}

function wireThemeButton() {
  const moreButtons = document.querySelectorAll<HTMLButtonElement>('.more-grid-button');
  moreButtons.forEach((button) => {
    const label = button.querySelector('b')?.textContent?.trim();
    if (label !== '테마' || button.dataset.routeThemeTrigger === 'true') return;
    button.dataset.routeThemeTrigger = 'true';
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      openThemeSheet();
    });
  });
}

function hideLegacyThemeSection() {
  const section = document.getElementById('theme-settings');
  if (section) section.classList.add('route-theme-legacy-hidden');
}

const initialTheme = activeTheme();
document.documentElement.dataset.routeTheme = initialTheme;
if (!localStorage.getItem(STORAGE_KEY)) localStorage.setItem(STORAGE_KEY, DEFAULT_THEME);

let renderQueued = false;
const refresh = () => {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    hideLegacyThemeSection();
    wireThemeButton();
  });
};

const observer = new MutationObserver(refresh);

function start() {
  hideLegacyThemeSection();
  wireThemeButton();
  observer.observe(document.body, { childList: true, subtree: true });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start, { once: true });
} else {
  start();
}
