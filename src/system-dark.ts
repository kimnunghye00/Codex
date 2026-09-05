export const SYSTEM_DARK_KEY = 'route-setting-system-dark';

const systemDarkQuery = window.matchMedia('(prefers-color-scheme: dark)');

export function isSystemDarkEnabled() {
  return localStorage.getItem(SYSTEM_DARK_KEY) === '1';
}

export function applySystemDarkMode() {
  const enabled = isSystemDarkEnabled();
  const active = enabled && systemDarkQuery.matches;
  const root = document.documentElement;

  root.dataset.routeSystemDarkEnabled = enabled ? '1' : '0';
  if (active) root.dataset.routeSystemDark = '1';
  else delete root.dataset.routeSystemDark;

  window.dispatchEvent(new CustomEvent('route-system-dark-applied', {
    detail: { enabled, active, systemDark: systemDarkQuery.matches },
  }));
}

export function setSystemDarkEnabled(enabled: boolean) {
  localStorage.setItem(SYSTEM_DARK_KEY, enabled ? '1' : '0');
  applySystemDarkMode();
}

const handleSystemAppearanceChange = () => applySystemDarkMode();
systemDarkQuery.addEventListener('change', handleSystemAppearanceChange);

applySystemDarkMode();
