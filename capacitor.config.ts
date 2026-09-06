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
      // Native auto-hide is the last-resort launch guard. src/main.tsx still
      // hides the splash as soon as ROUTE paints, but a module-load failure can
      // no longer strand the user behind the native splash forever.
      launchShowDuration: 1800,
      launchAutoHide: true,
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
