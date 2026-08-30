type RouteTheme = {
  id: string;
  name: string;
  description: string;
  primary: string;
  accent: string;
  isDefault?: boolean;
};

// v2 intentionally uses a new key so the redesigned theme system starts
// everyone on ROUTE's official default, Navy + Coral, once.
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

function activeTheme() {
  return validTheme(localStorage.getItem(STORAGE_KEY));
}

function applyTheme(id: string) {
  const next = validTheme(id);
  document.documentElement.dataset.routeTheme = next;
  localStorage.setItem(STORAGE_KEY, next);
  renderThemePicker();
}

function makeThemeButton(theme: RouteTheme, activeId: string) {
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
  button.addEventListener('click', () => applyTheme(theme.id));
  return button;
}

function renderThemePicker() {
  const containers = document.querySelectorAll<HTMLElement>('#theme-settings .theme-options');
  if (!containers.length) return;
  const selected = activeTheme();

  containers.forEach((container) => {
    const validPicker = container.classList.contains('route-theme-options')
      && container.querySelectorAll('[data-route-theme-option]').length === themes.length;

    if (!validPicker) {
      container.className = 'theme-options route-theme-options';
      container.replaceChildren(...themes.map((theme) => makeThemeButton(theme, selected)));
      return;
    }

    container.querySelectorAll<HTMLElement>('[data-route-theme-option]').forEach((button) => {
      const isActive = button.dataset.routeThemeOption === selected;
      button.classList.toggle('active', isActive);
      button.setAttribute('aria-pressed', String(isActive));
      const check = button.querySelector<HTMLElement>('.route-theme-check');
      if (check) check.textContent = isActive ? '✓' : '';
    });
  });
}

// This is the actual app default. Old MELUNI/default-theme keys are ignored.
const initialTheme = activeTheme();
document.documentElement.dataset.routeTheme = initialTheme;
if (!localStorage.getItem(STORAGE_KEY)) localStorage.setItem(STORAGE_KEY, DEFAULT_THEME);

let renderQueued = false;
const queueRender = () => {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    renderThemePicker();
  });
};

const observer = new MutationObserver(queueRender);

function start() {
  renderThemePicker();
  observer.observe(document.body, { childList: true, subtree: true });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start, { once: true });
} else {
  start();
}
