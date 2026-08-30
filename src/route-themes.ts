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

function applyTheme(id: string) {
  const next = validTheme(id);
  document.documentElement.dataset.routeTheme = next;
  localStorage.setItem(STORAGE_KEY, next);
}

function makeThemeButton(theme: RouteTheme, activeId: string, onSelect: (id: string) => void) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `route-theme-option${theme.id === activeId ? ' active' : ''}`;
  button.dataset.routeThemeOption = theme.id;
  button.setAttribute('aria-pressed', String(theme.id === activeId));

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
  check.textContent = theme.id === activeId ? '✓' : '';
  check.setAttribute('aria-hidden', 'true');

  button.append(swatch, copy, check);
  button.addEventListener('click', () => onSelect(theme.id));
  return button;
}

function closeThemeSheet() {
  document.querySelector('.route-theme-overlay')?.remove();
  document.body.classList.remove('route-theme-sheet-open');
}

function openThemeSheet() {
  closeThemeSheet();
  const selected = activeTheme();

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
  const heading = document.createElement('div');
  const eyebrow = document.createElement('small');
  eyebrow.textContent = 'ROUTE THEME';
  const title = document.createElement('h2');
  title.id = 'route-theme-sheet-title';
  title.textContent = '테마 선택';
  const description = document.createElement('p');
  description.textContent = '원하는 컬러 조합을 선택하면 앱 전체에 바로 적용돼요.';
  heading.append(eyebrow, title, description);

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'route-theme-sheet-close';
  close.setAttribute('aria-label', '테마 선택 닫기');
  close.textContent = '×';
  close.addEventListener('click', closeThemeSheet);
  header.append(heading, close);

  const options = document.createElement('div');
  options.className = 'route-theme-sheet-options';

  const selectTheme = (id: string) => {
    applyTheme(id);
    closeThemeSheet();
  };
  options.append(...themes.map((theme) => makeThemeButton(theme, selected, selectTheme)));

  const note = document.createElement('p');
  note.className = 'route-theme-sheet-note';
  note.textContent = 'Navy + Coral이 ROUTE의 기본 테마입니다.';

  sheet.append(handle, header, options, note);
  overlay.append(sheet);
  document.body.append(overlay);
  document.body.classList.add('route-theme-sheet-open');

  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) closeThemeSheet();
  });

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      closeThemeSheet();
      document.removeEventListener('keydown', onKeyDown);
    }
  };
  document.addEventListener('keydown', onKeyDown);
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
