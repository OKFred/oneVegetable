import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: '.',
  plugins: [
    cloudflareTest({
      remoteBindings: false,
      miniflare: {
        compatibilityDate: '2026-08-29',
        compatibilityFlags: ['nodejs_compat'],
        r2Buckets: ['SOCIAL_MEDIA'],
        d1Databases: ['DB'],
        bindings: { TEST_MIGRATIONS: await readD1Migrations('apps/api/drizzle') }
      }
    })
  ],
  test: {
    include: ['apps/api/test-worker/**/*.test.ts'],
    maxWorkers: 1
  }
});
