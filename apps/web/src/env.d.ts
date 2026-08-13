/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GATEWAY_MODE?: 'mock' | 'bff';
  readonly VITE_BFF_BASE_URL?: string;
  readonly VITE_BFF_API_PREFIX?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
