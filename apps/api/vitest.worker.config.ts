import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: '.',
  plugins: [
    cloudflareTest({
      remoteBindings: false,
      miniflare: {
        compatibilityDate: '2026-08-29',
        compatibilityFlags: ['nodejs_compat'],
        r2Buckets: ['SOCIAL_MEDIA']
      }
    })
  ],
  test: {
    include: ['apps/api/test-worker/**/*.test.ts'],
    maxWorkers: 1
  }
});
