import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';

// Isolated from parallel agents using the root config's port/output directory.
export default defineConfig({
  testDir: import.meta.dirname,
  testMatch: ['unsaved-editing.spec.ts', 'extension-startup-unlock.spec.ts', 'extension.spec.ts'],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  outputDir: resolve(import.meta.dirname, '../../artifacts/e2e-startup-editing'),
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4187',
    locale: 'zh-CN',
    reducedMotion: 'reduce',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure'
  },
  webServer: {
    cwd: resolve(import.meta.dirname, '../..'),
    command: 'pnpm dev:web --host 127.0.0.1 --port 4187 --strictPort',
    env: { VITE_GATEWAY_MODE: 'mock' },
    port: 4187,
    reuseExistingServer: false,
    timeout: 120_000,
    stderr: 'ignore'
  }
});
