import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.ebetstream.mobile',
  appName: 'Ebetstream',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    allowNavigation: [
      'https://acmpt.online',
      'https://*.acmpt.online',
      'https://ebetstream.com',
      'https://*.ebetstream.com',
      'wss://ebetstream.com',
      'http://localhost:*',
      'https://localhost:*',
      'http://127.0.0.1:*',
    ],
    cleartext: true,
  },
  plugins: {
    Camera: {
      permissions: ['camera', 'microphone'],
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#0a0a0f',
    },
  },
  android: {
    allowMixedContent: true,
  },
  ios: {
    contentInset: 'automatic',
  },
};

export default config;
