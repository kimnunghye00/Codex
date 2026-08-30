import { auth } from './lib/firebase';
import { loadLocationVisits, type LocationVisit } from './utils/location';

const LEAFLET_SCRIPT_ID = 'route-home-map-leaflet-script';
const LEAFLET_STYLE_ID = 'route-home-map-leaflet-style';

type LeafletMap = {
  remove: () => void;
  fitBounds: (bounds: unknown, options?: unknown) => void;
  setView: (latLng: [number, number], zoom: number) => void;
  invalidateSize: () => void;
};

type LeafletLayerGroup = {
  addTo: (map: LeafletMap) => LeafletLayerGroup;
};

type LeafletApi = {
  map: (element: HTMLElement, options?: unknown) => LeafletMap;
  tileLayer: (url: string, options?: unknown) => { addTo: (map: LeafletMap) => unknown };
  layerGroup: () => LeafletLayerGroup;
  circleMarker: (latLng: [number, number], options?: unknown) => { addTo: (group: LeafletLayerGroup) => { bindPopup: (html: string) => unknown } };
  polyline: (latLngs: [number, number][], options?: unknown) => { addTo: (group: LeafletLayerGroup) => unknown };
  latLngBounds: (latLngs: [number, number][]) => unknown;
};

const leafletApi = () => (window as typeof window & { L?: LeafletApi }).L;

function loadLeaflet() {
  return new Promise<LeafletApi>((resolve, reject) => {
    const ready = leafletApi();
    if (ready) return resolve(ready);

    if (!document.getElementById(LEAFLET_STYLE_ID)) {
      const link = document.createElement('link');
      link.id = LEAFLET_STYLE_ID;
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      link.crossOrigin = '';
      document.head.appendChild(link);
    }

    const existing = document.getElementById(LEAFLET_SCRIPT_ID) as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener('load', () => {
        const loaded = leafletApi();
        if (loaded) resolve(loaded);
        else reject(new Error('Leaflet failed to initialize'));
      }, { once: true });
      existing.addEventListener('error', () => reject(new Error('Leaflet failed to load')), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.id = LEAFLET_SCRIPT_ID;
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    script.crossOrigin = '';
    script.onload = () => {
      const loaded = leafletApi();
      if (loaded) resolve(loaded);
      else reject(new Error('Leaflet failed to initialize'));
    };
    script.onerror = () => reject(new Error('Leaflet failed to load'));
    document.body.appendChild(script);
  });
}

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character] ?? character));
}

function formatVisit(visit: LocationVisit) {
  const date = new Date(visit.arrivedAt);
  return `${date.getMonth() + 1}월 ${date.getDate()}일 ${new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit' }).format(date)}`;
}

function openHomeMap() {
  if (document.querySelector('.home-map-overlay')) return;

  const overlay = document.createElement('div');
  overlay.className = 'home-map-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', '우리의 지도');

  const panel = document.createElement('section');
  panel.className = 'home-map-overlay-panel';

  const header = document.createElement('header');
  const heading = document.createElement('div');
  const eyebrow = document.createElement('small');
  eyebrow.textContent = 'OUR ROUTE';
  const title = document.createElement('h2');
  title.textContent = '우리의 지도';
  const description = document.createElement('p');
  description.textContent = '기록된 위치를 지도에서 바로 확인할 수 있어요.';
  heading.append(eyebrow, title, description);

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'home-map-overlay-close';
  close.setAttribute('aria-label', '닫기');
  close.textContent = '×';
  header.append(heading, close);

  const mapWrap = document.createElement('div');
  mapWrap.className = 'home-map-overlay-map-wrap';
  const mapElement = document.createElement('div');
  mapElement.className = 'home-map-overlay-map';
  const status = document.createElement('div');
  status.className = 'home-map-overlay-status';
  status.textContent = '지도를 불러오는 중이에요…';
  mapWrap.append(mapElement, status);

  const footer = document.createElement('div');
  footer.className = 'home-map-overlay-footer';
  footer.innerHTML = '<strong>방문 기록</strong><span>위치 탭에서 공유를 켜면 기록이 쌓여요.</span>';

  panel.append(header, mapWrap, footer);
  overlay.append(panel);
  document.body.append(overlay);
  document.body.classList.add('home-map-overlay-open');

  let map: LeafletMap | undefined;
  const closeOverlay = () => {
    map?.remove();
    overlay.remove();
    document.body.classList.remove('home-map-overlay-open');
    document.removeEventListener('keydown', onKeyDown);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') closeOverlay();
  };
  close.addEventListener('click', closeOverlay);
  overlay.addEventListener('pointerdown', (event) => {
    if (event.target === overlay) closeOverlay();
  });
  document.addEventListener('keydown', onKeyDown);

  void loadLeaflet().then((L) => {
    map = L.map(mapElement, { zoomControl: true, attributionControl: true });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map);

    const uid = auth.currentUser?.uid ?? '';
    const visits = uid ? loadLocationVisits(uid) : [];
    const layer = L.layerGroup().addTo(map);

    if (!visits.length) {
      map.setView([37.5665, 126.978], 12);
      status.textContent = '아직 저장된 위치 기록이 없어요.';
    } else {
      const points = visits.map((visit) => [visit.latitude, visit.longitude] as [number, number]);
      if (points.length > 1) L.polyline(points, { color: '#FF6F61', weight: 4, opacity: 0.72 }).addTo(layer);
      visits.forEach((visit, index) => {
        const current = index === 0 && !visit.leftAt;
        const popup = `<strong>${escapeHtml(visit.placeName || '위치 기록')}</strong><br>${escapeHtml(formatVisit(visit))}`;
        L.circleMarker([visit.latitude, visit.longitude], {
          radius: current ? 10 : 7,
          color: '#ffffff',
          weight: 3,
          fillColor: current ? '#FF6F61' : '#1F2A44',
          fillOpacity: 1,
        }).addTo(layer).bindPopup(popup);
      });
      if (points.length === 1) map.setView(points[0], 16);
      else map.fitBounds(L.latLngBounds(points), { padding: [34, 34], maxZoom: 16 });
      status.remove();
    }
    window.setTimeout(() => map?.invalidateSize(), 40);
  }).catch(() => {
    status.textContent = '지도를 불러오지 못했어요. 인터넷 연결을 확인해 주세요.';
  });

  close.focus();
}

function wireHomeMapCard() {
  const card = document.querySelector<HTMLButtonElement>('.home-map-card');
  if (!card || card.dataset.routeHomeMapOverlay === 'true') return;
  card.dataset.routeHomeMapOverlay = 'true';
  card.setAttribute('aria-label', '우리의 지도 바로 열기');
  card.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    openHomeMap();
  }, true);
}

let queued = false;
const refresh = () => {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => {
    queued = false;
    wireHomeMapCard();
  });
};

const observer = new MutationObserver(refresh);
function start() {
  wireHomeMapCard();
  observer.observe(document.body, { childList: true, subtree: true });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
else start();
