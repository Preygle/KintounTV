/// <reference types="vite/client" />

interface ImportMetaEnv {
  // Firebase web app config (see README, "Sync").
  readonly VITE_FIREBASE_API_KEY?: string;
  readonly VITE_FIREBASE_PROJECT_ID?: string;
  // Local emulators, tests only (host:port).
  readonly VITE_FIREBASE_AUTH_EMULATOR?: string;
  readonly VITE_FIREBASE_FIRESTORE_EMULATOR?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** package.json version, set at build time (vite.config.ts). */
declare const __APP_VERSION__: string;
