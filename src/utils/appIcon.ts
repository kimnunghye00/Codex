export type RouteAppIconId = 'route' | 'heart' | 'pin-duo' | 'heart-chat' | 'our-route' | 'night' | 'cream' | 'minimal' | 'couple-love' | 'couple-date';

const APP_ICON_IDS: RouteAppIconId[] = ['route', 'heart-chat', 'couple-love', 'couple-date'];

function iconSvg(iconId: RouteAppIconId) {
  const common = 'xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"';
  if (iconId === 'heart') return `<svg ${common}><rect width="64" height="64" rx="16" fill="#FF7266"/><path d="M32 48C25 42 14 34 14 24c0-7 5-12 12-12 4 0 7 2 9 5 2-3 5-5 9-5 7 0 12 5 12 12 0 10-11 18-24 24Z" fill="#FFF9F6"/></svg>`;
  if (iconId === 'pin-duo') return `<svg ${common}><rect width="64" height="64" rx="16" fill="#F7F1E7"/><path d="M25 46s-10-9-10-19a10 10 0 0 1 20 0c0 10-10 19-10 19Z" fill="#3D405B"/><circle cx="25" cy="27" r="4" fill="#FFF9F6"/><path d="M42 48s-9-8-9-17a9 9 0 0 1 18 0c0 9-9 17-9 17Z" fill="#E07A5F"/><circle cx="42" cy="31" r="3.5" fill="#FFF9F6"/><path d="M26 48c5-4 9-5 15-2" fill="none" stroke="#C9A99D" stroke-width="2.5" stroke-linecap="round"/></svg>`;
  if (iconId === 'heart-chat') return `<svg ${common}><rect width="64" height="64" rx="16" fill="#454866"/><path d="M13 16h38a7 7 0 0 1 7 7v18a7 7 0 0 1-7 7H32l-10 7v-7h-9a7 7 0 0 1-7-7V23a7 7 0 0 1 7-7Z" fill="#FFF9F6"/><path d="M32 41c-6-5-11-9-11-14a6 6 0 0 1 11-3 6 6 0 0 1 11 3c0 5-5 9-11 14Z" fill="#FF7266"/></svg>`;
  if (iconId === 'our-route') return `<svg ${common}><rect width="64" height="64" rx="16" fill="#E8F1EC"/><path d="M15 45c4-17 15-8 18-22 2-8 9-10 17-5" fill="none" stroke="#3D405B" stroke-width="4" stroke-linecap="round"/><circle cx="15" cy="45" r="6" fill="#E07A5F" stroke="#FFF" stroke-width="2"/><circle cx="50" cy="18" r="6" fill="#3D405B" stroke="#FFF" stroke-width="2"/><path d="M32 45c-5-4-8-7-8-11a5 5 0 0 1 8-4 5 5 0 0 1 8 4c0 4-3 7-8 11Z" fill="#E07A5F"/></svg>`;
  if (iconId === 'night') return `<svg ${common}><rect width="64" height="64" rx="16" fill="#171A2A"/><path d="M39 12a20 20 0 1 0 13 33A22 22 0 0 1 39 12Z" fill="#999CFF"/><path d="M18 46c7-12 13-8 18-19" fill="none" stroke="#FF8276" stroke-width="3" stroke-linecap="round"/><circle cx="18" cy="46" r="4" fill="#FF8276"/><circle cx="36" cy="27" r="4" fill="#FFF8F0"/></svg>`;
  if (iconId === 'cream') return `<svg ${common}><rect width="64" height="64" rx="16" fill="#F4EBDD"/><circle cx="32" cy="32" r="21" fill="#FFF9F1" stroke="#D8CBBB" stroke-width="2"/><path d="M22 43V20h11c8 0 12 4 12 10 0 5-3 8-8 9l9 8h-8l-9-9v9h-7Zm7-11h4c4 0 6-1 6-4s-2-4-6-4h-4v8Z" fill="#29324A"/><circle cx="47" cy="17" r="4" fill="#E07A5F"/></svg>`;
  if (iconId === 'minimal') return `<svg ${common}><rect width="64" height="64" rx="16" fill="#FCFCFA"/><path d="M20 45V18h13c9 0 14 5 14 12 0 6-4 10-10 11l11 8h-9L29 40v9h-9Zm9-12h4c4 0 6-1 6-4s-2-4-6-4h-4v8Z" fill="#30354D"/><circle cx="48" cy="16" r="5" fill="#E07A5F"/></svg>`;
  return `<svg ${common}><rect width="64" height="64" rx="16" fill="#28314A"/><path d="M15 44c4-15 14-8 18-21 2-7 8-9 16-6" fill="none" stroke="#FF786B" stroke-width="4" stroke-linecap="round"/><circle cx="15" cy="44" r="5" fill="#FFF9F6"/><circle cx="49" cy="17" r="5" fill="#FF786B"/><path d="M27 48V28h9c7 0 11 4 11 9 0 4-2 7-6 8l7 6h-7l-7-7v7h-7Zm7-9h3c3 0 4-1 4-3s-1-3-4-3h-3v6Z" fill="#FFF9F6"/></svg>`;
}

export function normalizeRouteAppIcon(value: string | null): RouteAppIconId {
  return APP_ICON_IDS.includes(value as RouteAppIconId) ? value as RouteAppIconId : 'route';
}

export function updateRouteFavicon(iconId: RouteAppIconId) {
  const asset = iconId === 'heart-chat' ? '/danduli-icon-chat.webp' : iconId === 'couple-love' ? '/danduli-character-love.webp' : iconId === 'couple-date' ? '/danduli-character-date.webp' : iconId === 'route' ? '/danduli-icon-heart.webp' : null;
  const href = asset ?? `data:image/svg+xml,${encodeURIComponent(iconSvg(iconId))}`;
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
