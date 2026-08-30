import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const root = new URL('../../', import.meta.url);
const wrangler = JSON.parse(readFileSync(new URL('wrangler.jsonc', root), 'utf8')) as Record<string, unknown>;
const packageJson = JSON.parse(readFileSync(new URL('package.json', root), 'utf8')) as Record<
  string,
  unknown
>;

describe('Cloudflare one-click deployment configuration', () => {
  it('auto-provisions one D1 binding and routes API before SPA assets', () => {
    expect(wrangler.main).toBe('apps/api/src/worker.ts');
    expect(wrangler.assets).toMatchObject({
      directory: 'apps/web/dist',
      not_found_handling: 'single-page-application',
      run_worker_first: ['/api/*']
    });
    const databases = wrangler.d1_databases as Record<string, unknown>[];
    expect(databases).toHaveLength(1);
    expect(databases[0]).toMatchObject({
      binding: 'DB',
      database_name: 'one-vegetable',
      migrations_dir: 'apps/api/drizzle'
    });
    expect(databases[0]).not.toHaveProperty('database_id');
    expect(existsSync(new URL('apps/api/wrangler.jsonc', root))).toBe(false);
  });

  it('declares only the two bootstrap secrets and applies migrations before deploy', () => {
    expect(wrangler.secrets).toEqual({
      required: ['BOOTSTRAP_ADMIN_TOKEN', 'ONE_VEGETABLE_CREDENTIAL_ENCRYPTION_KEY']
    });
    const scripts = packageJson.scripts as Record<string, string>;
    expect(scripts.deploy).toBe('pnpm run cloudflare:deploy');
    expect(scripts['cloudflare:deploy']).toContain('wrangler d1 migrations apply DB --remote');
    expect(scripts['cloudflare:deploy'].indexOf('migrations apply')).toBeLessThan(
      scripts['cloudflare:deploy'].lastIndexOf('wrangler deploy')
    );
  });

  it('uses Passkey auth and exactly the seven verified mutation flags in self-hosted mode', () => {
    const vars = wrangler.vars as Record<string, string>;
    expect(vars.ONE_VEGETABLE_ENVIRONMENT).toBe('self-hosted');
    expect(vars.ONE_VEGETABLE_AUTH_MODE).toBe('passkey');
    expect(vars).not.toHaveProperty('ONE_VEGETABLE_CORS_ORIGINS');
    expect(new Set(vars.ONE_VEGETABLE_MUTATION_FLAGS.split(','))).toEqual(
      new Set([
        'operation:publishProduct',
        'operation:saveProductDraft',
        'operation:updateProduct',
        'operation:updateProductDisplay',
        'operation:operatePhotoGroup',
        'operation:uploadPhoto',
        'operation:transferPhotoFromUrl'
      ])
    );
  });
});
