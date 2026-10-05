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
      iconColor: '#FF4A2B',
    },
    SplashScreen: {
      launchShowDuration: 600,
      backgroundColor: '#ee2a3a',
      showSpinner: false,
    },
  },
};

export default config;
