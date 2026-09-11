import type { D1Migration } from '@cloudflare/vitest-plugin';
declare global {
  namespace Cloudflare {
    interface Env {
      SOCIAL_MEDIA: R2Bucket;
      DB: D1Database;
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}
