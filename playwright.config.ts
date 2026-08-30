import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  retries: 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    reducedMotion: 'reduce',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure'
  },
  webServer: {
    command: 'pnpm dev:web --host 127.0.0.1 --port 4173 --strictPort',
    env: { VITE_GATEWAY_MODE: 'mock' },
    port: 4173,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000
  }
});
