type RouteTheme = {
  id: string;
  name: string;
  description: string;
  primary: string;
  accent: string;
};

const STORAGE_KEY = 'route-theme';
const DEFAULT_THEME = 'navy-coral';

const themes: RouteTheme[] = [
  { id: 'navy-coral', name: 'Navy + Coral', description: '기본 · 신뢰감 + 따뜻한 감정', primary: '#1F2A44', accent: '#FF6F61' },
  { id: 'deep-green-sand', name: 'Deep Green + Sand Beige', description: '아늑한 공간감 + 안정감', primary: '#355C4B', accent: '#D9C7A3' },
  { id: 'blue-gray-lavender', name: 'Blue Gray + Lavender', description: '부드러움 + 현대적 감성', primary: '#5E718D', accent: '#B7A7D9' },
  { id: 'charcoal-mint', name: 'Charcoal + Mint', description: '미니멀 + 디지털 연결감', primary: '#2B2E34', accent: '#8ED1C6' },
  { id: 'burgundy-ivory', name: 'Burgundy + Warm Ivory', description: '성숙한 사랑 + 부드러움', primary: '#7A3E48', accent: '#F7EFEA' },
];

const validTheme = (value: string | null) => themes.some((theme) => theme.id === value) ? value! : DEFAULT_THEME;

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

  const primary = document.createElement('i');
  primary.className = 'route-theme-color';
  primary.style.background = theme.primary;
  primary.setAttribute('aria-hidden', 'true');

  const accent = document.createElement('i');
  accent.className = 'route-theme-color';
  accent.style.background = theme.accent;
  accent.setAttribute('aria-hidden', 'true');

  const copy = document.createElement('span');
  copy.className = 'route-theme-copy';
  const title = document.createElement('b');
  title.textContent = theme.name;
  const description = document.createElement('small');
  description.textContent = theme.description;
  copy.append(title, description);

  const check = document.createElement('span');
  check.className = 'route-theme-check';
  check.textContent = theme.id === activeId ? '✓' : '';
  check.setAttribute('aria-hidden', 'true');

  button.append(primary, accent, copy, check);
  button.addEventListener('click', () => applyTheme(theme.id));
  return button;
}

function renderThemePicker() {
  const containers = document.querySelectorAll<HTMLElement>('#theme-settings .theme-options');
  if (!containers.length) return;
  const activeId = validTheme(localStorage.getItem(STORAGE_KEY));

  containers.forEach((container) => {
    const alreadyRoutePicker = container.classList.contains('route-theme-options')
      && container.querySelectorAll('[data-route-theme-option]').length === themes.length;

    if (alreadyRoutePicker) {
      container.querySelectorAll<HTMLElement>('[data-route-theme-option]').forEach((button) => {
        const active = button.dataset.routeThemeOption === activeId;
        button.classList.toggle('active', active);
        if (button.getAttribute('aria-pressed') !== String(active)) button.setAttribute('aria-pressed', String(active));
        const check = button.querySelector<HTMLElement>('.route-theme-check');
        const nextCheck = active ? '✓' : '';
        if (check && check.textContent !== nextCheck) check.textContent = nextCheck;
      });
      return;
    }

    container.classList.add('route-theme-options');
    container.replaceChildren(...themes.map((theme) => makeThemeButton(theme, activeId)));
  });
}

const initialTheme = validTheme(localStorage.getItem(STORAGE_KEY));
document.documentElement.dataset.routeTheme = initialTheme;
if (!localStorage.getItem(STORAGE_KEY)) localStorage.setItem(STORAGE_KEY, DEFAULT_THEME);

const observer = new MutationObserver(() => renderThemePicker());

function start() {
  renderThemePicker();
  observer.observe(document.body, { childList: true, subtree: true });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start, { once: true });
} else {
  start();
}
