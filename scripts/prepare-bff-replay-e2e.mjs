import { rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, URL } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const workerPort = Number(globalThis.process.env.ONE_VEGETABLE_REPLAY_E2E_PORT ?? '8796');
if (!Number.isInteger(workerPort) || workerPort < 1024 || workerPort > 65535) {
  throw new Error('ONE_VEGETABLE_REPLAY_E2E_PORT must be an integer between 1024 and 65535');
}
const persistRelativeDirectory = `apps/api/.wrangler/bff-replay-e2e-${workerPort}`;
const persistDirectory = fileURLToPath(new URL(`../${persistRelativeDirectory}`, import.meta.url));
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
  persistRelativeDirectory,
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
