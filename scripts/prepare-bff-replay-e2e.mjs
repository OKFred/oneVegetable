import { rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, URL } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const persistDirectory = fileURLToPath(new URL('../apps/api/.wrangler/bff-replay-e2e', import.meta.url));
rmSync(persistDirectory, { recursive: true, force: true });

const migrationArguments = [
  'exec',
  'wrangler',
  'd1',
  'migrations',
  'apply',
  'DB',
  '--local',
  '--persist-to',
  'apps/api/.wrangler/bff-replay-e2e',
  '--config',
  'wrangler.jsonc'
];
const result =
  globalThis.process.platform === 'win32'
    ? spawnSync(
        globalThis.process.env.ComSpec ?? 'cmd.exe',
        ['/d', '/s', '/c', `pnpm ${migrationArguments.join(' ')}`],
        { cwd: repositoryRoot, encoding: 'utf8', stdio: 'inherit' }
      )
    : spawnSync('pnpm', migrationArguments, {
        cwd: repositoryRoot,
        encoding: 'utf8',
        stdio: 'inherit'
      });

if (result.error) throw result.error;
if (result.status !== 0) {
  throw new Error(`BFF replay E2E D1 migration failed with exit code ${result.status ?? 'unknown'}`);
}
