import { auth } from './lib/firebase';
import { loadLocationVisits, type LocationVisit } from './utils/location';
import { loadNaverMaps, type NaverMap, type NaverOverlay } from './utils/naverMaps';

function escapeHtml(value: string) {
  return value.replace(/[&<>'\"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '\"': '&quot;' }[character] ?? character));
}

function formatVisit(visit: LocationVisit) {
  const date = new Date(visit.arrivedAt);
  return `${date.getMonth() + 1}월 ${date.getDate()}일 ${new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit' }).format(date)}`;
}

function markerHtml(current: boolean) {
  const color = current ? '#FF6F61' : '#1F2A44';
  const size = current ? 20 : 16;
  return `<div style="width:${size}px;height:${size}px;border:3px solid #fff;border-radius:50%;background:${color};box-shadow:0 3px 10px #0003"></div>`;
}

export function openHomeMap() {
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
  description.textContent = '기록된 위치를 네이버 지도에서 바로 확인할 수 있어요.';
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
  status.textContent = '네이버 지도를 불러오는 중이에요…';
  mapWrap.append(mapElement, status);

  const footer = document.createElement('div');
  footer.className = 'home-map-overlay-footer';
  footer.innerHTML = '<strong>방문 기록</strong><span>위치 탭에서 공유를 켜면 기록이 쌓여요.</span>';

  panel.append(header, mapWrap, footer);
  overlay.append(panel);
  document.body.append(overlay);
  document.body.classList.add('home-map-overlay-open');

  let map: NaverMap | undefined;
  let mapOverlays: NaverOverlay[] = [];
  let resizeObserver: ResizeObserver | undefined;

  const closeOverlay = () => {
    resizeObserver?.disconnect();
    mapOverlays.forEach((item) => item.setMap(null));
    mapOverlays = [];
    map?.destroy?.();
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

  void loadNaverMaps().then((naver) => {
    const center = new naver.maps.LatLng(37.5666103, 126.9783882);

    requestAnimationFrame(() => {
      map = new naver.maps.Map(mapElement, {
        center,
        zoom: 15,
        gl: false,
        zoomControl: true,
        zoomControlOptions: { position: naver.maps.Position.TOP_RIGHT },
      });

      const refreshSize = () => {
        if (!map) return;
        naver.maps.Event.trigger(map, 'resize');
      };

      window.setTimeout(refreshSize, 60);
      window.setTimeout(refreshSize, 180);
      resizeObserver = new ResizeObserver(refreshSize);
      resizeObserver.observe(mapElement);

      const uid = auth.currentUser?.uid ?? '';
      const visits = uid ? loadLocationVisits(uid) : [];

      if (!visits.length) {
        status.textContent = '아직 저장된 위치 기록이 없어요.';
        return;
      }

      const points = visits.map((visit) => new naver.maps.LatLng(visit.latitude, visit.longitude));
      if (points.length > 1) {
        const path = new naver.maps.Polyline({
          map,
          path: points,
          strokeColor: '#FF6F61',
          strokeWeight: 5,
          strokeOpacity: 0.8,
        });
        mapOverlays.push(path);
      }

      visits.forEach((visit, index) => {
        const current = index === 0 && !visit.leftAt;
        const marker = new naver.maps.Marker({
          map,
          position: points[index],
          icon: {
            content: markerHtml(current),
            anchor: { x: current ? 10 : 8, y: current ? 10 : 8 },
          },
        });
        const info = new naver.maps.InfoWindow({
          content: `<div style="padding:10px 12px;font-size:12px;line-height:1.45"><strong>${escapeHtml(visit.placeName || '위치 기록')}</strong><br><span>${escapeHtml(formatVisit(visit))}</span></div>`,
          borderWidth: 0,
          backgroundColor: '#fff',
        });
        naver.maps.Event.addListener(marker, 'click', () => info.open(map as NaverMap, marker));
        mapOverlays.push(marker);
      });

      if (points.length === 1) {
        map.setCenter(points[0]);
        map.setZoom(17);
      } else {
        const bounds = new naver.maps.LatLngBounds();
        points.forEach((point) => bounds.extend(point));
        map.fitBounds(bounds, { top: 46, right: 46, bottom: 46, left: 46 });
      }
      status.remove();
    });
  }).catch((error) => {
    console.error('[ROUTE NAVER map]', error);
    status.textContent = String(import.meta.env.VITE_NAVER_MAP_CLIENT_ID ?? '').trim()
      ? '네이버 지도를 불러오지 못했어요. 등록한 Web 서비스 URL을 확인해 주세요.'
      : '네이버 지도 Client ID가 아직 설정되지 않았어요.';
  });

  close.focus();
}

function handleHomeMapClick(event: Event) {
  const target = event.target instanceof Element ? event.target : null;
  const card = target?.closest('.home-map-card');
  if (!card) return;

  event.preventDefault();
  event.stopPropagation();
  if ('stopImmediatePropagation' in event) event.stopImmediatePropagation();
  openHomeMap();
}

function handleHomeMapKeyboard(event: KeyboardEvent) {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  const target = event.target instanceof Element ? event.target : null;
  const card = target?.closest('.home-map-card');
  if (!card) return;

  event.preventDefault();
  event.stopPropagation();
  openHomeMap();
}

document.addEventListener('click', handleHomeMapClick, true);
document.addEventListener('keydown', handleHomeMapKeyboard, true);
