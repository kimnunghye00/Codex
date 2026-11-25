import type { ErrorInfo } from 'react';

export function saveDiagnostic(error: Error, info?: ErrorInfo) {
  try {
    const payload = {
      at: new Date().toISOString(),
      message: error.message || String(error),
      stack: error.stack || '',
      componentStack: info?.componentStack || '',
      href: window.location.href,
      userAgent: navigator.userAgent,
      online: navigator.onLine,
    };
    sessionStorage.setItem('route-last-ui-error', JSON.stringify(payload));
  } catch {
    // Diagnostics must never become another source of crashes.
  }
}

export function installGlobalCrashDiagnostics() {
  window.addEventListener('error', (event) => {
    const error = event.error instanceof Error ? event.error : new Error(event.message || 'window error');
    saveDiagnostic(error);
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    const error = reason instanceof Error ? reason : new Error(typeof reason === 'string' ? reason : 'Unhandled promise rejection');
    saveDiagnostic(error);
    console.error('[DANDULI unhandled promise rejection]', reason);
  });
}
