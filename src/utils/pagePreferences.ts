export type HomePagePreferences = { anniversaries: boolean; schedules: boolean; memories: boolean };
export type DateMapPreferences = { searchScope: 'map' | 'nationwide'; numbered: boolean; connectStops: boolean };

export const DEFAULT_HOME_PREFERENCES: HomePagePreferences = { anniversaries: true, schedules: true, memories: true };
export const DEFAULT_MAP_PREFERENCES: DateMapPreferences = { searchScope: 'map', numbered: true, connectStops: true };
const key = (uid: string, page: 'home' | 'map') => `danduli-page-preferences:${uid}:${page}`;

function read(uid: string, page: 'home' | 'map'): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key(uid, page)) ?? '{}');
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  } catch { return {}; }
}

export function loadHomePagePreferences(uid: string): HomePagePreferences {
  const value = read(uid, 'home');
  return {
    anniversaries: typeof value.anniversaries === 'boolean' ? value.anniversaries : true,
    schedules: typeof value.schedules === 'boolean' ? value.schedules : true,
    memories: typeof value.memories === 'boolean' ? value.memories : true,
  };
}

export function loadDateMapPreferences(uid: string): DateMapPreferences {
  const value = read(uid, 'map');
  return {
    searchScope: value.searchScope === 'nationwide' ? 'nationwide' : 'map',
    numbered: typeof value.numbered === 'boolean' ? value.numbered : true,
    connectStops: typeof value.connectStops === 'boolean' ? value.connectStops : true,
  };
}

export function savePagePreferences(uid: string, page: 'home' | 'map', value: HomePagePreferences | DateMapPreferences) {
  try { localStorage.setItem(key(uid, page), JSON.stringify(value)); return true; }
  catch { return false; }
}
