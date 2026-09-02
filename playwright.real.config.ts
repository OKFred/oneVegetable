import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';

if (process.env.ONE_VEGETABLE_REAL_WEB_SMOKE !== '1') {
  throw new Error('真实 Web Smoke 必须显式设置 ONE_VEGETABLE_REAL_WEB_SMOKE=1');
}

const apiOrigin = 'http://127.0.0.1:8797';
const webOrigin = 'http://127.0.0.1:4175';
const sqlitePath = resolve('artifacts/real-web-smoke/one-vegetable.sqlite');
const productTransferZipMutationEnabled = process.env.ONE_VEGETABLE_REAL_PRODUCT_TRANSFER_ZIP_SMOKE === '1';

export default defineConfig({
  testDir: './tests/e2e-real',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: webOrigin,
    locale: 'zh-CN',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure'
  },
  webServer: [
    {
      command: 'pnpm dev:api:real',
      url: `${apiOrigin}/api/v1/readyz`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        ONE_VEGETABLE_PORT: '8797',
        ONE_VEGETABLE_SQLITE_PATH: sqlitePath,
        ONE_VEGETABLE_CORS_ORIGINS: webOrigin,
        ONE_VEGETABLE_MUTATION_FLAGS: productTransferZipMutationEnabled ? 'operation:uploadPhoto' : '',
        BOOTSTRAP_ADMIN_TOKEN: 'real-web-smoke-bootstrap'
      }
    },
    {
      command: 'pnpm dev:web --host 127.0.0.1 --port 4175 --strictPort',
      url: webOrigin,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        VITE_GATEWAY_MODE: 'bff',
        VITE_BFF_BASE_URL: apiOrigin,
        VITE_BFF_API_PREFIX: '/api/v1'
      }
    }
  ]
});
