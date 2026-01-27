import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.deite.app',
  appName: 'Deite : AI Journel',
  webDir: 'build',
  android: {
    allowNavigation: [
      'https://accounts.google.com',
      'https://*.google.com',
      'https://*.googleapis.com',
      'https://deitedatabase.firebaseapp.com',
      'https://*.firebaseapp.com'
    ]
  }
};

export default config;
