import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e-files',
  workers: 1,
  retries: 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  outputDir: 'artifacts/s3-file-manager/e2e',
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4183',
    locale: 'en-US',
    contextOptions: { reducedMotion: 'reduce' },
    viewport: { width: 1280, height: 900 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure'
  },
  webServer: [
    {
      command: 'pnpm exec tsx apps/api/test/files-e2e-server.ts',
      url: 'http://127.0.0.1:4184/api/v1/readyz',
      reuseExistingServer: false,
      timeout: 60_000
    },
    {
      command: 'pnpm dev:web --host 127.0.0.1 --port 4183 --strictPort',
      url: 'http://127.0.0.1:4183',
      reuseExistingServer: false,
      timeout: 60_000,
      env: { VITE_GATEWAY_MODE: 'bff', VITE_BFF_BASE_URL: 'http://127.0.0.1:4184' }
    }
  ]
});
