/**
 * Windows Node URL-mode acceptance, existing object ONLY. No S3 object upload/build/config mutation.
 * --submit DOES request one Alibaba video upload; it is not a read-only action.
 * Default/--preflight: prints the fixed plan, reads no secrets and makes no calls.
 * --submit --run=<new UUID v4> --source-key=<exact URL_SOURCE.key> requires BOTH:
 * ONE_VEGETABLE_VIDEO_UPLOAD_URL_REAL_SMOKE=1 and ONE_VEGETABLE_VIDEO_UPLOAD_REAL_SMOKE=1.
 * --verify --run=<same UUID> --task=<returned URL task UUID> requires the URL live opt-in only.
 * Every submission run directory is single-use, including failed preflight/lost replies.
 * No source URL is saved or logged. Create and submit share the same in-memory signed string.
 * Read-only verification can also use smoke-video-upload-task-real.ts --verify --task=...
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, open, readFile, unlink } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import { parseEnv } from 'node:util';
import { atomicWriteJson } from './openapi-auth/storage';
import {
  classifyUrlSmokeFailure,
  failUrlSmoke,
  ISOLATED_DIRECTORY,
  localUrlBff,
  newUrlJournal,
  parseUrlJournal,
  parseUrlOptions,
  signPublicUrl,
  URL_SOURCE,
  UrlAcceptanceRun,
  urlNetworkIo,
  type UrlIo,
  type UrlJournal
} from './lib/video-upload-url-real';

const root = resolve(import.meta.dirname, '..');
const outputRoot = resolve(root, 'artifacts/video-upload-url-validation');

function ignored(path: string): string {
  const child = relative(root, path);
  if (!child || child === '..' || child.startsWith(`..${sep}`) || resolve(root, child) !== path)
    failUrlSmoke('IGNORED_WORKSPACE_PATH_REQUIRED');
  try {
    execFileSync('git', ['check-ignore', '--quiet', '--', child], {
      cwd: root,
      stdio: 'ignore',
      windowsHide: true
    });
  } catch {
    failUrlSmoke('IGNORED_WORKSPACE_PATH_REQUIRED');
  }
  return path;
}

async function loadSavedPublicSource() {
  const { DatabaseSync } = await import('node:sqlite');
  const { S3StorageConfigurationCipher, SqlS3StorageConfigurationRepository } =
    await import('../apps/api/src/storage/s3-configuration');
  const databasePath = ignored(
    resolve(root, process.env.ONE_VEGETABLE_S3_SMOKE_DATABASE ?? `${ISOLATED_DIRECTORY}/isolated.sqlite`)
  );
  const database = new DatabaseSync(databasePath, { readOnly: true });
  let saved;
  try {
    saved = await new SqlS3StorageConfigurationRepository({
      query: (sql, parameters = []) => Promise.resolve(database.prepare(sql).all(...parameters)),
      execute: () => failUrlSmoke('SOURCE_DATABASE_READ_ONLY')
    }).find();
  } finally {
    database.close();
  }
  if (!saved) failUrlSmoke('ENCRYPTED_CONFIGURATION_MISSING');
  let encodedKey = process.env.ONE_VEGETABLE_CREDENTIAL_ENCRYPTION_KEY;
  if (!encodedKey && existsSync(resolve(root, '.env')))
    encodedKey = parseEnv(
      await readFile(ignored(resolve(root, '.env')), 'utf8')
    ).ONE_VEGETABLE_CREDENTIAL_ENCRYPTION_KEY;
  // Never load .env as process state: it must not supply opt-in flags or replace the approved BFF.
  encodedKey ??= await readFile(ignored(resolve(root, '.data/local-credential-encryption-key')), 'utf8');
  const configuration = await (await S3StorageConfigurationCipher.create(encodedKey.trim())).decrypt(saved);
  return signPublicUrl(configuration);
}

async function credentials(): Promise<{ username: string; password: string }> {
  const file = ignored(
    resolve(root, process.env.VIDEO_SMOKE_LOGIN_FILE ?? `${ISOLATED_DIRECTORY}/local-auth.json`)
  );
  const value: unknown = JSON.parse(await readFile(file, 'utf8'));
  if (
    !value ||
    typeof value !== 'object' ||
    !('username' in value) ||
    !('password' in value) ||
    typeof value.username !== 'string' ||
    typeof value.password !== 'string' ||
    !value.username ||
    !value.password
  )
    failUrlSmoke('EXISTING_LOCAL_AUTH_REQUIRED');
  return { username: value.username, password: value.password };
}

async function main(): Promise<void> {
  const options = parseUrlOptions(process.argv.slice(2), process.env);
  if (process.platform !== 'win32') failUrlSmoke('WINDOWS_REQUIRED');
  if (options.action === 'preflight') {
    console.log(
      JSON.stringify({
        status: 'plan-only-no-calls',
        source: URL_SOURCE,
        publicBucket: 'https://oss-s3.this-time.com/dev',
        bff: 'http://127.0.0.1:8798'
      })
    );
    return;
  }
  if (process.env.NODE_DEBUG || process.env.DEBUG || process.env.DEBUG_FILE)
    failUrlSmoke('NETWORK_DEBUG_OUTPUT_MUST_BE_DISABLED');
  const base = localUrlBff(process.env.VIDEO_SMOKE_BFF_URL);
  const runId = options.runId;
  if (!runId) failUrlSmoke('EXPLICIT_RUN_UUID_REQUIRED');
  const directory = ignored(resolve(outputRoot, runId));
  const journalFile = resolve(directory, 'journal.json');
  if (options.action === 'submit') {
    await mkdir(outputRoot, { recursive: true });
    try {
      await mkdir(directory);
    } catch (error) {
      if (classifyUrlSmokeFailure(error) === 'EEXIST') failUrlSmoke('URL_RUN_ALREADY_USED_NO_CALLS');
      throw error;
    }
    // A crash before even this first receipt is not permission to reuse this run.
    await atomicWriteJson(journalFile, newUrlJournal(runId));
  } else if (!existsSync(journalFile)) failUrlSmoke('EXISTING_URL_RUN_REQUIRED');
  let lock;
  try {
    lock = await open(resolve(directory, 'active.lock'), 'wx');
  } catch (error) {
    if (classifyUrlSmokeFailure(error) === 'EEXIST') failUrlSmoke('RUN_LOCKED_MANUAL_PROCESS_CHECK_REQUIRED');
    throw error;
  }
  let journal: UrlJournal | undefined;
  let reason: string | null = null;
  try {
    journal = parseUrlJournal(JSON.parse(await readFile(journalFile, 'utf8')) as unknown, runId);
    const state = journal;
    const run = new UrlAcceptanceRun(state, () => atomicWriteJson(journalFile, state));
    const io: UrlIo = { sign: loadSavedPublicSource, credentials, ...urlNetworkIo(base) };
    if (options.action === 'submit') {
      await run.submit(io);
      process.exitCode = 2; // Single submit response is never reported as completed platform readback.
    } else {
      if (!options.taskId) failUrlSmoke('EXACT_VERIFY_TASK_REQUIRED');
      await run.verify(io, options.taskId);
      if (state.status !== 'readback-confirmed') process.exitCode = 2;
    }
  } catch (error) {
    reason = classifyUrlSmokeFailure(error);
    if (journal) {
      journal.status = 'stopped';
      await atomicWriteJson(journalFile, journal);
    }
    process.exitCode = 1;
  } finally {
    try {
      // Only whitelisted metadata is reportable; no generic errors, task objects or provider responses.
      const report = {
        capturedAtUtc: new Date().toISOString(),
        action: options.action,
        runId,
        status: journal?.status ?? 'stopped',
        reason,
        source: URL_SOURCE,
        sourceVerified: journal?.sourceVerified ?? false,
        taskId: journal?.taskId ?? null,
        taskStatus: journal?.taskStatus ?? null,
        calls: journal?.calls ?? [],
        countBoundary: 'command attempts; not confirmed provider writes'
      };
      await atomicWriteJson(resolve(directory, 'report.json'), report);
      console.log(
        JSON.stringify({
          status: report.status,
          reason,
          runId,
          taskId: report.taskId,
          report: relative(root, resolve(directory, 'report.json'))
        })
      );
    } finally {
      await lock.close();
      await unlink(resolve(directory, 'active.lock'));
    }
  }
}

try {
  await main();
} catch (error) {
  console.error(classifyUrlSmokeFailure(error));
  process.exitCode = 1;
}
