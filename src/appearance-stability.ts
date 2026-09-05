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
    intro.classList.remove(...VALID_ICONS);
    intro.classList.add(icon);
    intro.textContent = icon === 'heart' ? '♥' : 'R';
  }

  document.querySelectorAll<HTMLButtonElement>('.app-icon-picker button').forEach((button) => {
    const preview = button.querySelector<HTMLElement>('.more-app-icon-preview');
    const buttonIcon = VALID_ICONS.find((id) => preview?.classList.contains(id));
    const active = buttonIcon === icon;
    button.classList.toggle('active', active);
    button.querySelectorAll(':scope > small').forEach((small) => small.remove());
    if (active) {
      const label = document.createElement('small');
      label.textContent = '사용 중';
      button.appendChild(label);
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

const moreObserver = new MutationObserver(() => {
  const saved = iconFromUnknown(localStorage.getItem('route-app-icon'));
  syncIconDom(saved);
  neutralizeLegacyTheme();
});
moreObserver.observe(document.documentElement, { childList: true, subtree: true });
