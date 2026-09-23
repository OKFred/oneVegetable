/** Windows-only, opt-in local preparation. Never stages files or submits Alibaba uploads.
 * $env:ONE_VEGETABLE_PREPARE_VIDEO_REAL_SMOKE='1'; pnpm exec tsx scripts/prepare-video-upload-real-smoke.ts
 * Keep this process running; use its ignored local-auth.json with the separate smoke tool.
 * No existing DB/account/configuration is modified. Each invocation creates a fresh isolated DB.
 */
import { spawn, execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { relative, resolve } from 'node:path';
import { loadEnvFile } from 'node:process';
import { DatabaseSync } from 'node:sqlite';
import { createApiApp } from '../apps/api/src/app';
import { StaticOperationFeatureFlags } from '../apps/api/src/abac';
import { AdminService } from '../apps/api/src/auth/admin-service';
import { SqlAuthRepository } from '../apps/api/src/auth/repository';
import { AuthService } from '../apps/api/src/auth/service';
import { applyNodeMigrations, isNodeDatabaseReady, openNodeDatabase } from '../apps/api/src/db/node-database';
import { CredentialBackedAlibabaGatewayClient } from '../apps/api/src/gateway/alibaba-read-gateway';
import { createNodeAlibabaCredentialProvider } from '../apps/api/src/gateway/node-credential-bundle';
import { SqlRequestEventRepository } from '../apps/api/src/observability/request-events';
import {
  S3StorageConfigurationCipher,
  S3StorageConfigurationService,
  SqlS3StorageConfigurationRepository
} from '../apps/api/src/storage/s3-configuration';
import { SqlVideoUploadRepository } from '../apps/api/src/video-uploads/repository';
import { readCredentialBundle } from './openapi-auth/bundle';
import { atomicWriteJson } from './openapi-auth/storage';

const root = resolve(import.meta.dirname, '..');
const port = 8798;
const base = `http://127.0.0.1:${port}`;
const origin = 'http://localhost:5173';
const apiPrefix = '/api/v1';
const videoFlag = 'method:alibaba.icbu.video.upload';
let server: Server | undefined;
let database: ReturnType<typeof openNodeDatabase> | undefined;
let stage = 'opt-in';

try {
  if (process.platform !== 'win32') throw new Error('WINDOWS_REQUIRED');
  // Check before loading .env: account configuration must not implicitly opt in.
  if (process.env.ONE_VEGETABLE_PREPARE_VIDEO_REAL_SMOKE !== '1') throw new Error('OPT_IN_REQUIRED');
  if (existsSync(resolve(root, '.env'))) loadEnvFile(resolve(root, '.env'));
  stage = 'source-configuration';
  const source = new DatabaseSync(resolve(root, 'artifacts/s3-live-validation/ui.sqlite'), {
    readOnly: true
  });
  let record;
  try {
    record = await new SqlS3StorageConfigurationRepository({
      query: (sql, parameters = []) => Promise.resolve(source.prepare(sql).all(...parameters)),
      execute: () => {
        throw new Error('SOURCE_DATABASE_READ_ONLY');
      }
    }).find();
  } finally {
    source.close();
  }
  if (!record) throw new Error('SOURCE_CONFIGURATION_MISSING');
  const encodedKey =
    process.env.ONE_VEGETABLE_CREDENTIAL_ENCRYPTION_KEY?.trim() ??
    (await readFile(resolve(root, '.data/local-credential-encryption-key'), 'utf8')).trim();
  const cipher = await S3StorageConfigurationCipher.create(encodedKey);
  const stored = await cipher.decrypt(record);
  if (stored.endpoint !== 'https://oss-s3.this-time.com' || stored.bucket !== 'dev')
    throw new Error('SOURCE_TARGET_MISMATCH');

  stage = 'credential-bundle';
  const credentialFile = resolve(
    root,
    process.env.ONE_VEGETABLE_ALIBABA_CREDENTIAL_FILE ??
      process.env.OPEN_API_OUTPUT ??
      'artifacts/openapi-auth/credentials.json'
  );
  await readCredentialBundle(credentialFile);
  // Only the existing file reference enters this process; never copy its secret contents.
  process.env.ONE_VEGETABLE_ALIBABA_CREDENTIAL_FILE = credentialFile;
  const provider = createNodeAlibabaCredentialProvider({
    ONE_VEGETABLE_ALIBABA_CREDENTIAL_FILE: process.env.ONE_VEGETABLE_ALIBABA_CREDENTIAL_FILE
  });
  if (!provider.status().configured) throw new Error('CREDENTIAL_BUNDLE_EXPIRED');
  const credentials = {
    status: () => Promise.resolve(provider.status()),
    requireCredentials: () => Promise.resolve(provider.requireCredentials())
  };

  stage = 'port-check';
  const reservation = createServer();
  reservation.listen(port, '127.0.0.1');
  await once(reservation, 'listening');
  await new Promise<void>((done, reject) => {
    reservation.close((error) => {
      if (error) reject(error);
      else done();
    });
  });

  stage = 'isolated-initialization';
  const directory = resolve(
    root,
    'artifacts/video-upload-validation/isolated',
    `${new Date().toISOString().replaceAll(/[:.]/gu, '-')}-${randomUUID().slice(0, 8)}`
  );
  execFileSync('git', ['check-ignore', '--quiet', '--', relative(root, directory)], {
    cwd: root,
    stdio: 'ignore',
    windowsHide: true
  });
  await mkdir(directory, { recursive: true });
  const databasePath = resolve(directory, 'isolated.sqlite');
  database = openNodeDatabase(databasePath);
  applyNodeMigrations(database);
  const authRepository = new SqlAuthRepository(database.executor);
  const bootstrapToken = randomBytes(32).toString('base64url');
  const auth = new AuthService({ repository: authRepository, bootstrapToken });
  const login = {
    username: `video-smoke-${randomUUID().slice(0, 8)}`,
    password: randomBytes(32).toString('base64url')
  };
  const initialized = await auth.bootstrap({ requestId: randomUUID(), bootstrapToken, ...login });
  const storage = new S3StorageConfigurationService(
    new SqlS3StorageConfigurationRepository(database.executor),
    cipher
  );
  await storage.save({
    // VideoUploadService itself fixes keys to onevegetable/video-staging/<taskId>/source.mp4.
    configuration: { ...stored, rootPrefix: '' },
    actorId: initialized.user.id,
    expectedRevision: null,
    remark: 'Isolated video upload acceptance; no files staged during preparation.'
  });
  const authPath = resolve(directory, 'local-auth.json');
  await atomicWriteJson(authPath, login);
  const app = createApiApp({
    runtime: 'node',
    database: 'sqlite',
    environment: 'local-node',
    gatewayMode: 'real',
    apiPrefix,
    allowedOrigins: [origin],
    gateway: new CredentialBackedAlibabaGatewayClient(credentials),
    gatewayStatus: credentials.status,
    authService: auth,
    adminService: new AdminService(authRepository),
    featureFlags: new StaticOperationFeatureFlags(new Set([videoFlag])),
    s3Storage: storage,
    videoUploads: { repository: new SqlVideoUploadRepository(database.executor), credentials },
    requestEvents: new SqlRequestEventRepository(database.executor),
    ready: () => Promise.resolve(Boolean(database && isNodeDatabaseReady(database)))
  });
  // Resolve the API workspace's existing server adapter; no new root dependency or app entry changes.
  const apiRequire = createRequire(resolve(root, 'apps/api/package.json'));
  const adapter = apiRequire('@hono/node-server') as {
    serve(options: {
      fetch: (request: Request) => Response | Promise<Response>;
      hostname: string;
      port: number;
    }): Server;
  };
  stage = 'loopback-listener';
  server = adapter.serve({ fetch: app.fetch, hostname: '127.0.0.1', port });
  await once(server, 'listening');

  stage = 'local-preflight';
  const child = spawn(
    process.execPath,
    ['--import', 'tsx', resolve(root, 'scripts/smoke-video-upload-task-real.ts'), '--preflight'],
    {
      cwd: root,
      windowsHide: true,
      stdio: 'inherit',
      env: {
        ...process.env,
        VIDEO_SMOKE_BFF_URL: base,
        VIDEO_SMOKE_WEB_ORIGIN: origin,
        VIDEO_SMOKE_LOGIN_FILE: authPath,
        ONE_VEGETABLE_API_PREFIX: apiPrefix,
        ONE_VEGETABLE_VIDEO_UPLOAD_REAL_SMOKE: '0'
      }
    }
  );
  const [code] = (await once(child, 'exit')) as [number | null, string | null];
  if (code !== 0) throw new Error('LOCAL_PREFLIGHT_FAILED');
  const receipt = {
    status: 'prepared-preflight-passed-no-upload',
    preparedAtUtc: new Date().toISOString(),
    base,
    apiPrefix,
    databasePath: relative(root, databasePath),
    authPath: relative(root, authPath),
    endpoint: stored.endpoint,
    bucket: stored.bucket,
    taskPrefix: 'onevegetable/video-staging/<taskId>/',
    enabledFlags: [videoFlag],
    sourceDatabaseReadOnly: true,
    s3Writes: 0,
    alibabaRequests: 0
  };
  await atomicWriteJson(resolve(directory, 'preparation.json'), receipt);
  console.log(JSON.stringify(receipt));
  console.log(
    'Keep this process running. No staging/submission performed; Ctrl+C stops only this isolated BFF.'
  );
  const stop = () => {
    server?.close();
    server?.closeAllConnections();
    database?.connection.close();
    server = undefined;
    database = undefined;
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
} catch {
  server?.close();
  server?.closeAllConnections();
  database?.connection.close();
  // Do not print provider errors, configurations, command environments or credential values.
  console.error(`Video preparation stopped at ${stage}; no automatic retries or remote writes.`);
  process.exitCode = 1;
}
