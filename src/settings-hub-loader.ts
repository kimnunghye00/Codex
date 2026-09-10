let settingsHubReady = false;
let settingsHubLoad: Promise<void> | undefined;

function ensureSettingsHub() {
  if (settingsHubReady) return Promise.resolve();
  if (!settingsHubLoad) {
    settingsHubLoad = import('./settings-hub')
      .then(() => {
        settingsHubReady = true;
      })
      .catch((cause) => {
        settingsHubLoad = undefined;
        throw cause;
      });
  }
  return settingsHubLoad;
}

// The full settings hub owns account/security helpers and therefore pulls in
// additional Firebase code. Keep a tiny capture listener in the startup chunk,
// then load the real hub only when the user actually presses Settings.
document.addEventListener('click', (event) => {
  if (settingsHubReady) return;
  const target = event.target as Element | null;
  const button = target?.closest<HTMLButtonElement>('.header-actions button[aria-label="설정"]');
  if (!button) return;

  event.preventDefault();
  event.stopImmediatePropagation();

  void ensureSettingsHub()
    .then(() => button.click())
    .catch((cause) => {
      console.error('[ROUTE settings lazy load]', cause);
      window.alert('설정을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.');
    });
}, true);
