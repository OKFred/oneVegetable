import { defineConfig } from '@playwright/test';

const workerOrigin = 'http://127.0.0.1:8796';
const webOrigin = 'http://127.0.0.1:4174';

export default defineConfig({
  testDir: './tests/e2e-bff-replay',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: webOrigin,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure'
  },
  webServer: [
    {
      command:
        'pnpm --filter @one-vegetable/api exec wrangler dev --port 8796 --persist-to .wrangler/bff-replay-e2e --var BOOTSTRAP_ADMIN_TOKEN:bff-replay-e2e-bootstrap --var ONE_VEGETABLE_ENVIRONMENT:test --var ONE_VEGETABLE_GATEWAY_MODE:replay --var ONE_VEGETABLE_CORS_ORIGINS:http://127.0.0.1:4174',
      url: `${workerOrigin}/api/v1/readyz`,
      reuseExistingServer: false,
      timeout: 120_000
    },
    {
      command: 'pnpm dev:web --host 127.0.0.1 --port 4174 --strictPort',
      url: webOrigin,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        VITE_GATEWAY_MODE: 'bff',
        VITE_BFF_BASE_URL: workerOrigin,
        VITE_BFF_API_PREFIX: '/api/v1'
      }
    }
  ]
});
