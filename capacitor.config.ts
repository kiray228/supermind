import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.twomind.mindmap',
  appName: 'SuperMind',
  webDir: 'dist',
  android: {
    allowMixedContent: false,
  },
  plugins: {
    LocalNotifications: {
      smallIcon: 'ic_stat_supermind',
      iconColor: '#007AFF',
    },
    SplashScreen: {
      // короткая заставка: дольше держать её нельзя — пока она на экране, первый кадр WebView
      // (на слабых устройствах — долгий) блокирует окно, и Android показывает «Приложение не отвечает»
      launchShowDuration: 600,
      backgroundColor: '#F2F2F7',
      showSpinner: false,
    },
  },
};

export default config;
