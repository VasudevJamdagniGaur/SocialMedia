import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'therapist.deite.app',
  appName: 'Detea',
  webDir: 'build',
  plugins: {
    FirebaseAuthentication: {
      skipNativeAuth: true,
      providers: ['google.com'],
    },
  },
  android: {
    allowNavigation: [
      'https://accounts.google.com',
      'https://*.google.com',
      'https://*.googleapis.com',
      'https://deitedatabase.firebaseapp.com',
      'https://*.firebaseapp.com',
      'https://deitedatabase.web.app',
      'https://*.web.app',
      'https://newsapi.org',
      'https://*.cloudfunctions.net',
    ],
  },
};

export default config;
