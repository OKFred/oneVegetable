import { defineConfig } from '@playwright/test';

const workerPort = Number(process.env.ONE_VEGETABLE_REPLAY_E2E_PORT ?? '8796');
if (!Number.isInteger(workerPort) || workerPort < 1024 || workerPort > 65535) {
  throw new Error('ONE_VEGETABLE_REPLAY_E2E_PORT must be an integer between 1024 and 65535');
}
const workerOrigin = `http://127.0.0.1:${workerPort}`;
const persistDirectory = `apps/api/.wrangler/bff-replay-e2e-${workerPort}`;
const webOrigin = 'http://127.0.0.1:4174';

export default defineConfig({
  testDir: './tests/e2e-bff-replay',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: webOrigin,
    locale: 'zh-CN',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure'
  },
  webServer: [
    {
      command: `pnpm exec wrangler dev --config wrangler.jsonc --port ${workerPort} --persist-to ${persistDirectory} --var ONE_VEGETABLE_ENVIRONMENT:test --var ONE_VEGETABLE_GATEWAY_MODE:replay --var ONE_VEGETABLE_CORS_ORIGINS:http://127.0.0.1:4174 --var ONE_VEGETABLE_AUTH_MODE:password`,
      url: `${workerOrigin}/api/v1/readyz`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        BOOTSTRAP_ADMIN_TOKEN: 'bff-replay-e2e-bootstrap-token-32-bytes',
        ONE_VEGETABLE_CREDENTIAL_ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
      }
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
