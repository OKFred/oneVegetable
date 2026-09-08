/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_RUNTIME?: 'web' | 'extension';
  readonly VITE_GATEWAY_MODE?: 'mock' | 'bff';
  readonly VITE_BFF_BASE_URL?: string;
  readonly VITE_BFF_API_PREFIX?: string;
}

declare const __ONE_VEGETABLE_EXTENSION__: boolean;

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
