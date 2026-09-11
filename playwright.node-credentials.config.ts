import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';

export default defineConfig({
  testDir: './tests/e2e-node-credentials',
  workers: 1,
  retries: 0,
  use: {
    baseURL: 'http://127.0.0.1:4186',
    locale: 'zh-CN',
    reducedMotion: 'reduce',
    trace: 'retain-on-failure'
  },
  webServer: [
    {
      command: 'pnpm exec tsx apps/api/src/node.ts',
      url: 'http://127.0.0.1:8786/api/v1/readyz',
      reuseExistingServer: false,
      timeout: 60000,
      env: {
        ONE_VEGETABLE_PORT: '8786',
        ONE_VEGETABLE_SQLITE_PATH: resolve(`artifacts/node-credential-e2e/${Date.now()}.sqlite`),
        ONE_VEGETABLE_ENVIRONMENT: 'local-node',
        ONE_VEGETABLE_GATEWAY_MODE: 'replay',
        ONE_VEGETABLE_CORS_ORIGINS: 'http://127.0.0.1:4186',
        ONE_VEGETABLE_CREDENTIAL_ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        BOOTSTRAP_ADMIN_TOKEN: 'node-credential-e2e-bootstrap-32-bytes',
        ONE_VEGETABLE_MUTATION_FLAGS: ''
      }
    },
    {
      command: 'pnpm dev:web --host 127.0.0.1 --port 4186 --strictPort',
      url: 'http://127.0.0.1:4186',
      reuseExistingServer: false,
      timeout: 60000,
      env: { VITE_GATEWAY_MODE: 'bff', VITE_BFF_BASE_URL: 'http://127.0.0.1:8786' }
    }
  ]
});
