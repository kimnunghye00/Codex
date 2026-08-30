const NAVER_MAP_SCRIPT_ID = 'route-naver-map-sdk';
const ROUTE_NAVER_MAP_CLIENT_ID = 'z3njcg8upv';

export type NaverLatLng = { lat: () => number; lng: () => number };
export type NaverBounds = { extend: (point: NaverLatLng) => void };
export type NaverMap = {
  setCenter: (point: NaverLatLng) => void;
  setZoom: (zoom: number) => void;
  fitBounds: (bounds: NaverBounds, options?: { top?: number; right?: number; bottom?: number; left?: number }) => void;
  destroy?: () => void;
};
export type NaverOverlay = { setMap: (map: NaverMap | null) => void };
export type NaverInfoWindow = { open: (map: NaverMap, anchor: NaverOverlay) => void; close: () => void };

type NaverEventApi = {
  addListener: (target: unknown, eventName: string, handler: () => void) => unknown;
  trigger: (target: unknown, eventName: string, payload?: unknown) => void;
};

type NaverMapsNamespace = {
  Map: new (element: HTMLElement | string, options: Record<string, unknown>) => NaverMap;
  LatLng: new (lat: number, lng: number) => NaverLatLng;
  LatLngBounds: new () => NaverBounds;
  Marker: new (options: Record<string, unknown>) => NaverOverlay;
  Polyline: new (options: Record<string, unknown>) => NaverOverlay;
  InfoWindow: new (options: Record<string, unknown>) => NaverInfoWindow;
  Event: NaverEventApi;
  Position: { TOP_RIGHT: unknown };
};

export type NaverApi = { maps: NaverMapsNamespace };

export type NaverMapDiagnostic = {
  clientIdConfigured: boolean;
  clientIdSource: 'env' | 'route-default';
  hostname: string;
  origin: string;
};

export function naverApi() {
  return (window as typeof window & { naver?: NaverApi }).naver;
}

export function naverMapDiagnostic(): NaverMapDiagnostic {
  const envClientId = String(import.meta.env.VITE_NAVER_MAP_CLIENT_ID ?? '').trim();
  return {
    clientIdConfigured: Boolean(envClientId || ROUTE_NAVER_MAP_CLIENT_ID),
    clientIdSource: envClientId ? 'env' : 'route-default',
    hostname: window.location.hostname,
    origin: window.location.origin,
  };
}

function clientId() {
  return String(import.meta.env.VITE_NAVER_MAP_CLIENT_ID ?? '').trim() || ROUTE_NAVER_MAP_CLIENT_ID;
}

export function loadNaverMaps() {
  return new Promise<NaverApi>((resolve, reject) => {
    const ready = naverApi();
    if (ready?.maps) return resolve(ready);

    const key = clientId();
    if (!key) return reject(new Error('NAVER_CLIENT_ID_MISSING'));

    document.getElementById(NAVER_MAP_SCRIPT_ID)?.remove();

    let settled = false;
    const finishReject = (message: string) => {
      if (settled) return;
      settled = true;
      document.getElementById(NAVER_MAP_SCRIPT_ID)?.remove();
      reject(new Error(message));
    };

    const timeout = window.setTimeout(() => finishReject('NAVER_MAP_LOAD_TIMEOUT'), 12000);
    const previousAuthFailure = (window as typeof window & { navermap_authFailure?: () => void }).navermap_authFailure;
    (window as typeof window & { navermap_authFailure?: () => void }).navermap_authFailure = () => {
      previousAuthFailure?.();
      window.clearTimeout(timeout);
      finishReject('NAVER_MAP_AUTH_FAILED');
    };

    const script = document.createElement('script');
    script.id = NAVER_MAP_SCRIPT_ID;
    script.async = true;
    script.defer = true;
    script.crossOrigin = 'anonymous';
    script.src = `https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=${encodeURIComponent(key)}`;
    script.onload = () => {
      if (settled) return;
      window.clearTimeout(timeout);
      const loaded = naverApi();
      if (!loaded?.maps) return finishReject('NAVER_MAP_INIT_FAILED');
      settled = true;
      resolve(loaded);
    };
    script.onerror = () => {
      window.clearTimeout(timeout);
      finishReject('NAVER_MAP_SCRIPT_FAILED');
    };
    document.head.appendChild(script);
  });
}
