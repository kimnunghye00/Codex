export {};

type IdleCapableWindow = Window & {
  requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
};

let scheduled = false;
let warmed = false;

function warmPrimaryFeatures() {
  if (warmed || document.visibilityState === 'hidden') return;
  warmed = true;

  // These chunks live inside the installed APK. Warm them only after startup is
  // idle so the first tap on a primary tab does not replace the current screen
  // with a full-page Suspense loader.
  void Promise.allSettled([
    import('./styles/features/memories'),
    import('./components/memories/MemoriesPage'),
    import('./styles/features/chat'),
    import('./components/chat/ChatPage'),
    import('./styles/features/location'),
    import('./components/location/LocationPage'),
    import('./styles/features/more'),
    import('./components/more/MoreServices'),
  ]).catch(() => undefined);
}

function scheduleWarmup() {
  if (scheduled || warmed) return;
  scheduled = true;

  const run = () => {
    scheduled = false;
    if (document.visibilityState === 'hidden') return;
    warmPrimaryFeatures();
  };

  const idleWindow = window as IdleCapableWindow;
  if (idleWindow.requestIdleCallback) {
    idleWindow.requestIdleCallback(run, { timeout: 1600 });
    return;
  }
  window.setTimeout(run, 900);
}

if (document.visibilityState === 'visible') scheduleWarmup();
else {
  const resume = () => {
    if (document.visibilityState !== 'visible') return;
    document.removeEventListener('visibilitychange', resume);
    scheduleWarmup();
  };
  document.addEventListener('visibilitychange', resume);
}
