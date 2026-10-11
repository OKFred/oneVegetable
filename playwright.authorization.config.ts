import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/authorization',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  reporter: 'list',
  use: { locale: 'zh-CN', screenshot: 'only-on-failure', trace: 'retain-on-failure' }
});
