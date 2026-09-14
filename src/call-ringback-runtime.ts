import './call-ice-runtime';
import { startOutgoingRingback, stopOutgoingRingback } from './lib/callRingback';

const CALL_REQUEST_EVENT = 'danduli-call-request';
let active = false;
let startedAt = 0;
let stopCheckTimer: number | undefined;

function clearStopCheck() {
  if (stopCheckTimer !== undefined) {
    window.clearTimeout(stopCheckTimer);
    stopCheckTimer = undefined;
  }
}

function stop() {
  if (!active) return;
  active = false;
  clearStopCheck();
  stopOutgoingRingback();
}

function inspectCallUi() {
  if (!active) return;
  const layer = document.querySelector('.danduli-call-layer');
  const status = document.querySelector('.danduli-call-top small')?.textContent?.trim() ?? '';

  if (/^\d+:\d{2}$/.test(status)) {
    stop();
    return;
  }

  if (/(거절|종료|끊어|실패|연결이 끊)/.test(status)) {
    stop();
    return;
  }

  if (!layer && Date.now() - startedAt > 500) stop();
}

function start() {
  active = true;
  startedAt = Date.now();
  void startOutgoingRingback();
  clearStopCheck();
  stopCheckTimer = window.setTimeout(inspectCallUi, 650);
}

window.addEventListener(CALL_REQUEST_EVENT, start);
window.addEventListener('pagehide', stop);
window.addEventListener('beforeunload', stop);

document.addEventListener('click', (event) => {
  if (!active) return;
  const target = event.target instanceof Element ? event.target.closest('button') : null;
  const label = target?.getAttribute('aria-label') ?? '';
  if (label === '통화 종료') stop();
}, true);

const observer = new MutationObserver(inspectCallUi);
observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
