export type RouteAppIconId = 'route' | 'heart' | 'night' | 'cream';

const APP_ICON_META: Record<RouteAppIconId, { mark: string; background: string; foreground: string }> = {
  route: { mark: 'R', background: '#1F2A44', foreground: '#FF6F61' },
  heart: { mark: '♥', background: '#FF6F61', foreground: '#FFF7F5' },
  night: { mark: 'R', background: '#171A2A', foreground: '#9699FF' },
  cream: { mark: 'R', background: '#F4EBDD', foreground: '#1F2A44' },
};

export function normalizeRouteAppIcon(value: string | null): RouteAppIconId {
  return value === 'heart' || value === 'night' || value === 'cream' ? value : 'route';
}

export function updateRouteFavicon(iconId: RouteAppIconId) {
  const icon = APP_ICON_META[iconId];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="${icon.background}"/><text x="32" y="41" text-anchor="middle" font-family="Arial,sans-serif" font-size="32" font-weight="800" fill="${icon.foreground}">${icon.mark}</text></svg>`;
  const href = `data:image/svg+xml,${encodeURIComponent(svg)}`;
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.appendChild(link);
  }
  link.href = href;
}

export function applySavedRouteAppIcon() {
  updateRouteFavicon(normalizeRouteAppIcon(localStorage.getItem('route-app-icon')));
}
