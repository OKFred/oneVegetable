import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';

// Independent server lifecycle so concurrent extension E2E cannot stop this suite's Vite process.
export default defineConfig({
  testDir: '.',
  testMatch: ['video-library.spec.ts', 'video-upload.spec.ts', 'product-video-association.spec.ts'],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  outputDir: '../../artifacts/e2e-video-ui',
  use: {
    baseURL: 'http://127.0.0.1:4291',
    locale: 'zh-CN',
    reducedMotion: 'reduce',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure'
  },
  webServer: {
    command: 'pnpm dev:web --host 127.0.0.1 --port 4291 --strictPort',
    cwd: fileURLToPath(new URL('../../', import.meta.url)),
    env: { VITE_GATEWAY_MODE: 'mock' },
    port: 4291,
    reuseExistingServer: false,
    timeout: 120_000
  }
});
