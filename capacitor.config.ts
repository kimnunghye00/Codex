import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.route.couple',
  appName: 'ROUTE',
  webDir: 'dist',
  backgroundColor: '#fffaf8',
  android: {
    allowMixedContent: false,
    // Android WebView의 기본 InputConnection을 사용해야 한글 조합 입력이 안정적입니다.
    captureInput: false,
  },
  ios: {
    contentInset: 'automatic',
    scrollEnabled: true,
  },
  server: {
    hostname: 'localhost',
    androidScheme: 'https',
  },
  plugins: {
    SplashScreen: {
      // React/Firebase bootstrap이 끝날 때까지 네이티브 스플래시를 유지하고
      // src/main.tsx에서 첫 화면이 실제로 그려진 뒤 직접 숨깁니다.
      launchShowDuration: 0,
      launchAutoHide: false,
      backgroundColor: '#fffaf8',
      showSpinner: false,
    },
    Keyboard: {
      resize: 'body',
      style: 'light',
      resizeOnFullScreen: true,
    },
    StatusBar: {
      style: 'light',
      backgroundColor: '#fffaf8',
      overlaysWebView: false,
    },
    LocalNotifications: {
      smallIcon: 'ic_stat_route',
      iconColor: '#ff6f61',
    },
  },
};

export default config;
