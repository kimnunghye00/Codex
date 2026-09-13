import { Component, type ErrorInfo, type ReactNode } from 'react';

type Props = { children: ReactNode };
type State = { error: Error | null; retryKey: number; crashCount: number };

const CRASH_HISTORY_KEY = 'route-ui-crash-history';
const CRASH_WINDOW_MS = 60_000;

function readRecentCrashCount() {
  try {
    const now = Date.now();
    const raw = JSON.parse(sessionStorage.getItem(CRASH_HISTORY_KEY) || '[]') as number[];
    const recent = raw.filter((timestamp) => Number.isFinite(timestamp) && now - timestamp < CRASH_WINDOW_MS);
    sessionStorage.setItem(CRASH_HISTORY_KEY, JSON.stringify(recent));
    return recent.length;
  } catch {
    return 0;
  }
}

function recordCrash() {
  try {
    const now = Date.now();
    const raw = JSON.parse(sessionStorage.getItem(CRASH_HISTORY_KEY) || '[]') as number[];
    const recent = raw.filter((timestamp) => Number.isFinite(timestamp) && now - timestamp < CRASH_WINDOW_MS);
    recent.push(now);
    sessionStorage.setItem(CRASH_HISTORY_KEY, JSON.stringify(recent.slice(-5)));
    return recent.length;
  } catch {
    return 1;
  }
}

function saveDiagnostic(error: Error, info?: ErrorInfo) {
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

export class AppCrashBoundary extends Component<Props, State> {
  state: State = { error: null, retryKey: 0, crashCount: readRecentCrashCount() };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[DANDULI UI crash]', error, info);
    saveDiagnostic(error, info);
    const crashCount = recordCrash();
    this.setState({ crashCount });
  }

  private retry = () => {
    if (this.state.crashCount >= 3) {
      window.location.reload();
      return;
    }
    this.setState((state) => ({ error: null, retryKey: state.retryKey + 1 }));
  };

  private reloadApp = () => {
    try { sessionStorage.setItem('route-recovered-from-crash', new Date().toISOString()); } catch {}
    window.location.reload();
  };

  private goHome = () => {
    try {
      sessionStorage.setItem('route-recovered-from-crash', new Date().toISOString());
    } catch {
      // Ignore storage failures.
    }
    window.location.replace('/');
  };

  render() {
    if (this.state.error) {
      const repeated = this.state.crashCount >= 3;
      return (
        <main className="route-crash-screen" role="alert">
          <section className="route-crash-card">
            <div className="route-crash-mark">단</div>
            <small>단둘이 RECOVERY</small>
            <h1>{repeated ? '앱을 안전하게 다시 시작할게요' : '화면을 다시 불러올게요'}</h1>
            <p>{repeated
              ? '같은 화면 오류가 반복되어 현재 데이터를 지우지 않고 앱 화면만 새로 시작하는 것이 안전해요.'
              : '기능을 여는 중 일시적인 오류가 생겼어요. 앱 전체가 빈 화면이 되지 않도록 안전하게 멈췄습니다.'}</p>
            <div className="route-crash-actions">
              {!repeated && <button type="button" className="route-crash-primary" onClick={this.retry}>다시 시도</button>}
              <button type="button" className={repeated ? 'route-crash-primary' : undefined} onClick={this.reloadApp}>앱 다시 시작</button>
              <button type="button" onClick={this.goHome}>홈으로 돌아가기</button>
            </div>
            <details>
              <summary>오류 정보</summary>
              <code>{this.state.error.message || '알 수 없는 화면 오류'}</code>
            </details>
          </section>
        </main>
      );
    }

    return <div key={this.state.retryKey} className="route-app-root">{this.props.children}</div>;
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
