import { Component, type ErrorInfo, type ReactNode } from 'react';

type Props = { children: ReactNode };
type State = { error: Error | null; retryKey: number };

function saveDiagnostic(error: Error, info?: ErrorInfo) {
  try {
    const payload = {
      at: new Date().toISOString(),
      message: error.message || String(error),
      stack: error.stack || '',
      componentStack: info?.componentStack || '',
      href: window.location.href,
      userAgent: navigator.userAgent,
    };
    sessionStorage.setItem('route-last-ui-error', JSON.stringify(payload));
  } catch {
    // Diagnostics must never become another source of crashes.
  }
}

export class AppCrashBoundary extends Component<Props, State> {
  state: State = { error: null, retryKey: 0 };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ROUTE UI crash]', error, info);
    saveDiagnostic(error, info);
  }

  private retry = () => {
    this.setState((state) => ({ error: null, retryKey: state.retryKey + 1 }));
  };

  private goHome = () => {
    try {
      sessionStorage.setItem('route-recovered-from-crash', new Date().toISOString());
    } catch {
      // Ignore storage failures.
    }
    window.location.href = '/';
  };

  render() {
    if (this.state.error) {
      return (
        <main className="route-crash-screen" role="alert">
          <section className="route-crash-card">
            <div className="route-crash-mark">R</div>
            <small>ROUTE RECOVERY</small>
            <h1>화면을 다시 불러올게요</h1>
            <p>기능을 여는 중 일시적인 오류가 생겼어요. 앱 전체가 빈 화면이 되지 않도록 안전하게 멈췄습니다.</p>
            <div className="route-crash-actions">
              <button type="button" className="route-crash-primary" onClick={this.retry}>다시 시도</button>
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
    console.error('[ROUTE unhandled promise rejection]', reason);
  });
}
