import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import auth from './mock/data/video/local-auth.json' with { type: 'json' };
if (process.env.ONE_VEGETABLE_VIDEO_SMOKE !== '1') throw new Error('Explicit read-only opt-in required');
export default defineConfig({
  testDir: './tests/e2e-real',
  testMatch: 'video-read.spec.ts',
  workers: 1,
  retries: 0,
  timeout: 120000,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:4175', locale: 'zh-CN', trace: 'off', screenshot: 'off' },
  webServer: [
    {
      command: 'pnpm dev:api:real',
      url: 'http://127.0.0.1:8797/api/v1/readyz',
      timeout: 120000,
      reuseExistingServer: false,
      env: {
        ONE_VEGETABLE_PORT: '8797',
        ONE_VEGETABLE_SQLITE_PATH: resolve(`artifacts/video-read-validation/web-${randomUUID()}.sqlite`),
        ONE_VEGETABLE_CORS_ORIGINS: 'http://127.0.0.1:4175',
        ONE_VEGETABLE_MUTATION_FLAGS: '',
        BOOTSTRAP_ADMIN_TOKEN: auth.bootstrapToken
      }
    },
    {
      command: 'pnpm dev:web --host 127.0.0.1 --port 4175 --strictPort',
      url: 'http://127.0.0.1:4175',
      timeout: 120000,
      reuseExistingServer: false,
      env: {
        VITE_GATEWAY_MODE: 'bff',
        VITE_BFF_BASE_URL: 'http://127.0.0.1:8797',
        VITE_BFF_API_PREFIX: '/api/v1'
      }
    }
  ]
});
