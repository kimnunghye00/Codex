const NAVER_MAP_SCRIPT_ID = 'route-naver-map-sdk';

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
  Map: new (element: HTMLElement, options: Record<string, unknown>) => NaverMap;
  LatLng: new (lat: number, lng: number) => NaverLatLng;
  LatLngBounds: new () => NaverBounds;
  Marker: new (options: Record<string, unknown>) => NaverOverlay;
  Polyline: new (options: Record<string, unknown>) => NaverOverlay;
  InfoWindow: new (options: Record<string, unknown>) => NaverInfoWindow;
  Event: NaverEventApi;
  Position: { TOP_RIGHT: unknown };
};

export type NaverApi = { maps: NaverMapsNamespace };

export function naverApi() {
  return (window as typeof window & { naver?: NaverApi }).naver;
}

export function loadNaverMaps() {
  return new Promise<NaverApi>((resolve, reject) => {
    const ready = naverApi();
    if (ready?.maps) return resolve(ready);

    const clientId = String(import.meta.env.VITE_NAVER_MAP_CLIENT_ID ?? '').trim();
    if (!clientId) return reject(new Error('VITE_NAVER_MAP_CLIENT_ID is missing'));

    const oldScript = document.getElementById(NAVER_MAP_SCRIPT_ID) as HTMLScriptElement | null;
    if (oldScript && !naverApi()?.maps) oldScript.remove();

    const previousAuthFailure = (window as typeof window & { navermap_authFailure?: () => void }).navermap_authFailure;
    (window as typeof window & { navermap_authFailure?: () => void }).navermap_authFailure = () => {
      previousAuthFailure?.();
      document.getElementById(NAVER_MAP_SCRIPT_ID)?.remove();
      reject(new Error('NAVER Maps authentication failed'));
    };

    const script = document.createElement('script');
    script.id = NAVER_MAP_SCRIPT_ID;
    script.async = true;
    script.src = `https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=${encodeURIComponent(clientId)}`;
    script.onload = () => {
      const loaded = naverApi();
      if (loaded?.maps) resolve(loaded);
      else {
        script.remove();
        reject(new Error('NAVER Maps failed to initialize'));
      }
    };
    script.onerror = () => {
      script.remove();
      reject(new Error('NAVER Maps failed to load'));
    };
    document.head.appendChild(script);
  });
}
