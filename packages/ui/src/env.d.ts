interface ImportMetaEnv {
  readonly VITE_APP_RUNTIME?: 'web' | 'extension';
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare const __ONE_VEGETABLE_EXTENSION__: boolean;
