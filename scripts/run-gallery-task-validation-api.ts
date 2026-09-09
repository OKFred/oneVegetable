import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { atomicWriteJson } from './openapi-auth/storage';

if (process.env.ONE_VEGETABLE_GALLERY_REAL_SMOKE !== '1')
  throw new Error('Explicit gallery smoke opt-in required');
const directory = resolve('artifacts/gallery-transfer-2.6/local');
const authenticationPath = resolve(directory, 'local-auth.json');
let authentication: { bootstrapToken: string; username: string; password: string; encryptionKey: string };
if (existsSync(authenticationPath)) {
  const value: unknown = JSON.parse(await readFile(authenticationPath, 'utf8'));
  if (
    !value ||
    typeof value !== 'object' ||
    !('bootstrapToken' in value) ||
    typeof value.bootstrapToken !== 'string' ||
    !('username' in value) ||
    typeof value.username !== 'string' ||
    !('password' in value) ||
    typeof value.password !== 'string' ||
    !('encryptionKey' in value) ||
    typeof value.encryptionKey !== 'string'
  )
    throw new Error('Invalid local smoke authentication');
  authentication = {
    bootstrapToken: value.bootstrapToken,
    username: value.username,
    password: value.password,
    encryptionKey: value.encryptionKey
  };
} else {
  authentication = {
    bootstrapToken: randomBytes(32).toString('hex'),
    username: 'gallery-smoke-admin',
    password: randomBytes(24).toString('base64url'),
    encryptionKey: randomBytes(32).toString('base64url')
  };
  await atomicWriteJson(authenticationPath, authentication);
}
const child = spawn(process.execPath, ['--import', 'tsx', 'apps/api/src/node.ts'], {
  cwd: process.cwd(),
  windowsHide: true,
  stdio: 'inherit',
  env: {
    ...process.env,
    ONE_VEGETABLE_ENVIRONMENT: 'local-node',
    ONE_VEGETABLE_GATEWAY_MODE: 'real',
    ONE_VEGETABLE_PORT: '8886',
    ONE_VEGETABLE_CORS_ORIGINS: 'http://localhost:4286',
    ONE_VEGETABLE_SQLITE_PATH: resolve(directory, 'validation.sqlite'),
    ONE_VEGETABLE_ALIBABA_CREDENTIAL_FILE: resolve('artifacts/openapi-auth/credentials.json'),
    ONE_VEGETABLE_CREDENTIAL_ENCRYPTION_KEY: authentication.encryptionKey,
    BOOTSTRAP_ADMIN_TOKEN: authentication.bootstrapToken,
    ONE_VEGETABLE_ALLOW_LOCAL_S3_HTTP: '1',
    ONE_VEGETABLE_MUTATION_FLAGS: 'operation:uploadPhoto,operation:operatePhotoGroup'
  }
});
console.log(
  'Isolated real gallery BFF on localhost:8886; product mutations disabled. Local authentication stays in ignored artifacts.'
);
child.once('error', () => {
  process.exitCode = 1;
});
child.once('exit', (code) => {
  process.exitCode = code ?? 1;
});
