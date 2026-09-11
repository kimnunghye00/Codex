export type RouteProfileStyle = 'clean' | 'soft' | 'heart';

export function normalizeRouteProfileStyle(value: string | null | undefined): RouteProfileStyle {
  return value === 'soft' || value === 'heart' ? value : 'clean';
}

export function applyRouteProfileStyle(style: RouteProfileStyle) {
  document.documentElement.dataset.routeProfileStyle = style;
}

export function applySavedRouteProfileStyle() {
  const style = normalizeRouteProfileStyle(localStorage.getItem('route-profile-style'));
  applyRouteProfileStyle(style);
}
