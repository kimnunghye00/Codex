import { auth } from './lib/firebase';
import { loadLocationVisits } from './utils/location';

const ROUTE_MAP_ORIGIN = 'https://meluni-f4e00.web.app';
const ROUTE_MAP_HOST = `${ROUTE_MAP_ORIGIN}/naver-map-host.html`;
const MAP_READY_TIMEOUT_MS = 12_000;

type MapHostMessage = {
  source?: string;
  type?: string;
  origin?: string;
  code?: string;
};

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

  const mapFrame = document.createElement('iframe');
  mapFrame.className = 'home-map-overlay-map';
  mapFrame.title = 'ROUTE 우리의 지도';
  mapFrame.src = ROUTE_MAP_HOST;
  mapFrame.loading = 'eager';
  mapFrame.style.border = '0';
  mapFrame.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');

  const status = document.createElement('div');
  status.className = 'home-map-overlay-status';
  status.textContent = '네이버 지도를 불러오는 중이에요…';
  mapWrap.append(mapFrame, status);

  const footer = document.createElement('div');
  footer.className = 'home-map-overlay-footer';
  footer.innerHTML = '<strong>방문 기록</strong><span>위치 탭에서 공유를 켜면 기록이 쌓여요.</span>';

  panel.append(header, mapWrap, footer);
  overlay.append(panel);
  document.body.append(overlay);
  document.body.classList.add('home-map-overlay-open');

  const uid = auth.currentUser?.uid ?? '';
  const visits = uid ? loadLocationVisits(uid) : [];
  let ready = false;
  let closed = false;
  let mapTimeout: number | undefined;
  let resizeObserver: ResizeObserver | undefined;

  const clearMapTimeout = () => {
    if (mapTimeout !== undefined) window.clearTimeout(mapTimeout);
    mapTimeout = undefined;
  };

  const postMapMessage = (payload: Record<string, unknown>) => {
    if (closed) return;
    mapFrame.contentWindow?.postMessage({ source: 'route-map-parent', ...payload }, ROUTE_MAP_ORIGIN);
  };

  const renderVisits = () => {
    postMapMessage({ type: 'render', visits, mode: 'map' });
  };

  const receiveMapMessage = (event: MessageEvent<MapHostMessage>) => {
    if (closed) return;
    if (event.origin !== ROUTE_MAP_ORIGIN) return;
    if (event.source !== mapFrame.contentWindow) return;
    if (event.data?.source !== 'route-map-host') return;

    if (event.data.type === 'host-ready' || event.data.type === 'sdk-loading') {
      status.textContent = '네이버 지도 인증을 확인하는 중이에요…';
      return;
    }

    if (event.data.type === 'ready') {
      ready = true;
      clearMapTimeout();
      renderVisits();
      if (visits.length) status.remove();
      else status.textContent = '아직 저장된 위치 기록이 없어요.';
      return;
    }

    clearMapTimeout();
    ready = false;
    if (event.data.type === 'auth-error') {
      status.textContent = '네이버 지도 인증이 거부됐어요. 지도 서비스 설정을 확인해 주세요.';
      return;
    }
    if (event.data.type === 'script-error') {
      status.textContent = '네이버 지도 SDK에 연결하지 못했어요. 네트워크를 확인한 뒤 다시 열어 주세요.';
      return;
    }
    if (event.data.type === 'init-error') {
      status.textContent = '네이버 지도를 초기화하지 못했어요. 잠시 후 다시 열어 주세요.';
    }
  };

  const onResize = () => {
    if (ready) postMapMessage({ type: 'resize' });
  };

  const closeOverlay = () => {
    if (closed) return;
    closed = true;
    clearMapTimeout();
    resizeObserver?.disconnect();
    window.removeEventListener('message', receiveMapMessage);
    window.removeEventListener('resize', onResize);
    document.removeEventListener('keydown', onKeyDown);
    overlay.remove();
    document.body.classList.remove('home-map-overlay-open');
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') closeOverlay();
  };

  close.addEventListener('click', closeOverlay);
  overlay.addEventListener('pointerdown', (event) => {
    if (event.target === overlay) closeOverlay();
  });
  document.addEventListener('keydown', onKeyDown);
  window.addEventListener('message', receiveMapMessage);
  window.addEventListener('resize', onResize);

  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(onResize);
    resizeObserver.observe(mapWrap);
  }

  mapTimeout = window.setTimeout(() => {
    if (ready || closed) return;
    status.textContent = '네이버 지도 응답이 늦어지고 있어요. 네트워크를 확인한 뒤 다시 열어 주세요.';
  }, MAP_READY_TIMEOUT_MS);

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
