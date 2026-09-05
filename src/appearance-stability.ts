import './route-appearance-stability-v17.css';
import './route-theme-preview-stability-v18.css';
import './route-runtime-stability-v19.css';
import './recovery-runtime';

type AppIconId = 'route' | 'heart' | 'night' | 'cream';

const LEGACY_THEME_KEY = 'meluni-theme';
const VALID_ICONS: AppIconId[] = ['route', 'heart', 'night', 'cream'];

function neutralizeLegacyTheme() {
  const root = document.documentElement;
  if (root.dataset.meluniTheme !== 'default') root.dataset.meluniTheme = 'default';
  if (localStorage.getItem(LEGACY_THEME_KEY) !== 'default') localStorage.setItem(LEGACY_THEME_KEY, 'default');
}

function iconFromUnknown(value: unknown): AppIconId {
  return typeof value === 'string' && VALID_ICONS.includes(value as AppIconId) ? value as AppIconId : 'route';
}

function syncIconDom(icon: AppIconId) {
  const intro = document.querySelector<HTMLElement>('.more-service-intro > .more-app-icon-preview');
  if (intro) {
    VALID_ICONS.forEach((id) => intro.classList.toggle(id, id === icon));
    const mark = icon === 'heart' ? '♥' : 'R';
    if (intro.textContent !== mark) intro.textContent = mark;
  }

  document.querySelectorAll<HTMLButtonElement>('.app-icon-picker button').forEach((button) => {
    const preview = button.querySelector<HTMLElement>('.more-app-icon-preview');
    const buttonIcon = VALID_ICONS.find((id) => preview?.classList.contains(id));
    const active = buttonIcon === icon;
    button.classList.toggle('active', active);

    const currentLabel = Array.from(button.children).find((child) => child.tagName === 'SMALL') as HTMLElement | undefined;
    if (active && !currentLabel) {
      const label = document.createElement('small');
      label.textContent = '사용 중';
      button.appendChild(label);
    } else if (active && currentLabel?.textContent !== '사용 중') {
      currentLabel.textContent = '사용 중';
    } else if (!active && currentLabel) {
      currentLabel.remove();
    }
  });
}

neutralizeLegacyTheme();

const legacyThemeObserver = new MutationObserver(() => neutralizeLegacyTheme());
legacyThemeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-meluni-theme'] });

window.addEventListener('storage', (event) => {
  if (event.key === LEGACY_THEME_KEY) neutralizeLegacyTheme();
  if (event.key === 'route-app-icon') syncIconDom(iconFromUnknown(event.newValue));
});

window.addEventListener('route-app-icon-changed', (event) => {
  const icon = iconFromUnknown((event as CustomEvent<unknown>).detail);
  syncIconDom(icon);
});

let moreSyncQueued = false;
const moreObserver = new MutationObserver(() => {
  if (moreSyncQueued) return;
  moreSyncQueued = true;
  window.requestAnimationFrame(() => {
    moreSyncQueued = false;
    const saved = iconFromUnknown(localStorage.getItem('route-app-icon'));
    syncIconDom(saved);
    neutralizeLegacyTheme();
  });
});
moreObserver.observe(document.documentElement, { childList: true, subtree: true });
