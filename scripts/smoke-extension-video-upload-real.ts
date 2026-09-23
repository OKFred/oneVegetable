/**
 * Windows/formal build only; no build, feature-flag patch, manifest copy or permission bypass.
 * Default/--preflight: inspect local build only (no browser, credentials or remote requests).
 * All live modes require ONE_VEGETABLE_EXTENSION_VIDEO_UPLOAD_REAL_SMOKE=1 and --run=<uuid>.
 * --ui-read [--restart]: real read-only UI; needs Alibaba bundle, NOT S3 or upload flags.
 * --prepare --file=<mp4>: configure an isolated encrypted profile, create ONE LOCAL task only.
 * --stage --task=<uuid> --file=<mp4> [--resume] [--stop-after-parts=1]: S3 only.
 * --submit --task=<uuid>: one Alibaba submission, never an automatic retry/readback loop.
 * Stage/submit additionally require ONE_VEGETABLE_VIDEO_UPLOAD_REAL_SMOKE=1 AND the formal gate.
 * --inspect/--verify/--reconcile --task=<uuid> [--restart]: remote reads only; local receipts may change.
 * Reuse the same --run and returned --task. Reselect/hash the complete MP4 before each stage.
 * A paused stage can be inspected with --restart, then explicitly resumed with --stage --resume.
 * Native S3 host prompts require the user. No screenshots, traces, HAR, provider text or secrets.
 * Never abort/delete/clean remote objects. Keep the ignored profile/journal for manual recovery.
 *
 * STAGED ACCEPTANCE: run preflight + ui-read now. Main validates Node and isolated extension tests,
 * then decides the runtime gate and builds. This script cannot enable uploads in a disabled build.
 * It exercises the real options UI for reads and the same trusted message protocol as the client
 * for task commands; it is NOT a claim of automated upload-dialog/confirmation UX acceptance.
 */
import { execFileSync } from 'node:child_process';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { existsSync, openAsBlob } from 'node:fs';
import { mkdir, open, readFile, readdir, unlink } from 'node:fs/promises';
import { basename, relative, resolve, sep } from 'node:path';
import { parseEnv } from 'node:util';
import { chromium, expect, type BrowserContext, type Page } from '@playwright/test';
import { ALIBABA_GATEWAY, parseAlibabaOpenApiCredentialBundle } from '../packages/core/src/index';
import {
  galleryGatewayId,
  galleryStorageId,
  requireGalleryContext
} from '../packages/core/src/gallery-transfer-context';
import type { GalleryTransferContext } from '../packages/core/src/gallery-transfer-task';
import { validateVideoPage } from '../packages/core/src/generated/validators-video';
import {
  fingerprintVideoFile,
  verifyReselectedVideo,
  validateVideoUploadResult,
  VIDEO_UPLOAD_PART_BYTES,
  type VideoUploadCommand,
  type VideoUploadResult,
  type VideoUploadTask
} from '../packages/core/src/video-upload';
import { atomicWriteJson } from './openapi-auth/storage';
import {
  assertCanPrepare,
  assertCanStage,
  assertCanSubmit,
  assertCommandAllowed,
  assertStorage,
  assertTaskIdentity,
  parseOptions,
  readJournal,
  record,
  recordReconciliation,
  SmokeError,
  stop,
  taskEvidence,
  type Attempt
} from './lib/extension-video-upload-real';

declare const chrome: {
  runtime: { sendMessage(message: unknown): Promise<unknown> };
  permissions: { contains(input: { origins: string[] }): Promise<boolean> };
};
const root = resolve(import.meta.dirname, '..');
const extensionPath = resolve(root, 'apps/extension/.output/chrome-mv3');
const outputRoot = resolve(root, 'artifacts/extension-video-upload-validation');

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2), process.env);
  if (process.platform !== 'win32') stop('WINDOWS_REQUIRED');
  // Playwright debug output may contain evaluate arguments (credentials/file parts).
  if (process.env.DEBUG || process.env.DEBUG_FILE || process.env.PWDEBUG)
    stop('DEBUG_OUTPUT_MUST_BE_DISABLED');
  const buildSha256 = await inspectBuild();
  if (options.action === 'preflight') {
    console.log(
      JSON.stringify({
        status: 'local-preflight-only',
        buildSha256,
        browserLaunched: false,
        remoteRequests: 0
      })
    );
    return;
  }
  const runId = options.runId;
  if (!runId) stop('RUN_UUID_REQUIRED');
  const directory = ignoredPath(resolve(outputRoot, runId));
  const journalPath = resolve(directory, 'journal.json');
  const profile = resolve(directory, 'profile');
  if (!existsSync(directory)) {
    if (!['ui-read', 'prepare'].includes(options.action)) stop('EXISTING_RUN_REQUIRED');
    await mkdir(outputRoot, { recursive: true });
    await mkdir(directory); // Exclusive directory creation; never reuse a partially initialized run.
    await atomicWriteJson(journalPath, { schemaVersion: 1, runId, taskId: null, attempts: [] });
  }
  let lock;
  try {
    lock = await open(resolve(directory, 'active.lock'), 'wx');
  } catch {
    stop('RUN_LOCKED_CHECK_PROCESS_BEFORE_MANUAL_RECOVERY');
  }
  let context: BrowserContext | undefined;
  const reportPath = resolve(directory, `${randomUUID()}.json`);
  const report = {
    runId,
    action: options.action,
    buildSha256,
    capturedAtUtc: new Date().toISOString(),
    status: 'starting',
    reason: null as string | null,
    failureSites: [] as string[],
    task: null as ReturnType<typeof taskEvidence> | null,
    uploadEnabled: null as boolean | null,
    uiRead: false,
    workerRestart: false,
    videoPageCount: null as number | null,
    s3WriteCommandsAttempted: 0,
    alibabaSubmitCommandsAttempted: 0,
    evidenceBoundary: 'trusted-handler-commands-and-read-only-ui; no network payload capture'
  };
  try {
    const journal = readJournal(JSON.parse(await readFile(journalPath, 'utf8')) as unknown, runId);
    if (options.taskId && journal.taskId !== options.taskId) stop('TASK_IDENTITY_MISMATCH');
    if (options.action === 'prepare') assertCanPrepare(journal);
    const persist = () => atomicWriteJson(journalPath, journal);
    const bundlePath = ignoredPath(
      resolve(
        root,
        process.env.ONE_VEGETABLE_ALIBABA_CREDENTIAL_FILE ?? 'artifacts/openapi-auth/credentials.json'
      )
    );
    const bundle = parseAlibabaOpenApiCredentialBundle(
      JSON.parse(await readFile(bundlePath, 'utf8')) as unknown
    );
    const settings = {
      appKey: bundle.application.appKey,
      appSecret: bundle.application.appSecret,
      accessToken: bundle.oauth.accessToken,
      endpoint: ALIBABA_GATEWAY,
      signMethod: 'hmac' as const
    };
    // Deterministic isolated-profile passphrase from existing secret; never persist another key.
    const passphrase = createHmac('sha256', settings.appSecret)
      .update(`onevegetable-extension-video-smoke-v1:${runId}`)
      .digest('base64url');
    context = await chromium.launchPersistentContext(profile, {
      headless: false,
      locale: 'zh-CN',
      acceptDownloads: false,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
    });
    const worker =
      context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker', { timeout: 30_000 }));
    const extensionId = new URL(worker.url()).host;
    if (!/^[a-p]{32}$/u.test(extensionId)) stop('EXTENSION_ID_INVALID');
    const base = `chrome-extension://${extensionId}/options.html`;
    const page = await context.newPage();
    page.setDefaultTimeout(30_000);
    await page.goto(`${base}#/settings`);
    // Browser startup may restore an old options tab. Remove potential concurrent UI schedulers.
    for (const old of context.pages()) if (old !== page) await old.close();
    const guide = page.getByRole('dialog', { name: '四步连接 Alibaba 开放平台' });
    const vault = await send(page, { kind: 'credential-vault-request', operation: 'status', payload: {} });
    if (!record(vault)) stop('VAULT_STATUS_INVALID');
    if (vault.state === 'empty') {
      await expect(guide).toBeVisible();
      await guide.getByRole('checkbox').check();
      await guide.getByRole('button', { name: '稍后，仅浏览' }).click();
      await send(page, {
        kind: 'credential-vault-request',
        operation: 'create',
        payload: { passphrase, settings }
      });
    } else if (vault.state === 'locked') {
      await send(page, { kind: 'credential-vault-request', operation: 'unlock', payload: { passphrase } });
    } else if (vault.state !== 'unlocked') stop('VAULT_STATE_REQUIRES_MANUAL_REVIEW');
    await page.reload();

    if (options.action === 'prepare') await configureStorage(page);
    const storage = await send(page, { kind: 's3-storage-request', operation: 'summary', payload: {} });
    if (!record(storage)) stop('STORAGE_SUMMARY_INVALID');
    if (options.action !== 'ui-read' || storage.configured === true) {
      assertStorage(storage, options.action === 'submit');
      const origin = String(storage.endpoint);
      if (
        !(await page.evaluate((origin) => chrome.permissions.contains({ origins: [`${origin}/*`] }), origin))
      )
        stop('NATIVE_HOST_PERMISSION_REQUIRED');
    }
    const currentContext = async () =>
      requireGalleryContext(await send(page, { kind: 'gallery-transfer-context' }));
    const boundContext = await currentContext();
    if (boundContext.gateway !== (await galleryGatewayId(settings))) stop('SOURCE_CREDENTIALS_CHANGED');

    const control = async (command: VideoUploadCommand): Promise<VideoUploadResult> => {
      assertCommandAllowed(options, command);
      const fresh = await currentContext();
      for (const field of ['identity', 'gateway', 'storage'] as const)
        if (fresh[field] !== boundContext[field]) stop('CONTEXT_CHANGED');
      const attempt: Attempt = {
        requestId: randomUUID(),
        action: command.action,
        outcome: 'intent',
        partNumber: command.action === 'part' ? command.partNumber : null
      };
      journal.attempts.push(attempt);
      if (journal.attempts.length > 1000) stop('JOURNAL_LIMIT');
      await persist(); // An intent is durable BEFORE sending; a lost response is never retried.
      if (['initiate', 'part', 'complete'].includes(command.action)) report.s3WriteCommandsAttempted++;
      if (command.action === 'submit') report.alibabaSubmitCommandsAttempted++;
      await atomicWriteJson(reportPath, report);
      try {
        const data = await send(
          page,
          {
            kind: 'video-upload-request',
            context: boundContext,
            command
          },
          attempt.requestId
        );
        if (!validateVideoUploadResult(data)) stop('VIDEO_RESPONSE_INVALID');
        const result = data as VideoUploadResult;
        if (command.action === 'create') {
          if (result.tasks.length !== 1 || !result.tasks[0]) stop('CREATED_TASK_MISSING');
          journal.taskId = result.tasks[0].id;
        }
        attempt.outcome = 'response';
        await persist();
        report.uploadEnabled = result.uploadEnabled;
        return result;
      } catch (error) {
        attempt.outcome = 'error';
        await persist();
        throw error;
      }
    };
    const known = await control({ action: 'list' });
    let task: VideoUploadTask | undefined;
    const getTask = async (): Promise<VideoUploadTask> => {
      const id = options.taskId ?? journal.taskId;
      if (!id) stop('TASK_REQUIRED');
      const result = await control({ action: 'get', taskId: id });
      const found = result.tasks.find((item) => item.id === id);
      if (!found) stop('TASK_NOT_RETURNED');
      assertTaskIdentity(found, journal, id);
      report.task = taskEvidence(found);
      return found;
    };
    if (options.taskId) task = await getTask();

    const inspectUi = async () => {
      const videos = await send(page, {
        kind: 'gateway-request',
        operation: 'listVideos',
        payload: { page: 1, pageSize: 20 }
      });
      if (!validateVideoPage(videos) || !record(videos) || !Array.isArray(videos.items))
        stop('VIDEO_READ_RESPONSE_INVALID');
      report.videoPageCount = videos.items.length;
      await page.goto(`${base}#/photos/videos`);
      const library = page.getByTestId('video-library');
      await expect(library).toBeVisible();
      await library.getByRole('button', { name: '上传', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: '上传视频与任务记录', exact: true });
      await expect(dialog.getByRole('button', { name: '刷新任务记录', exact: true })).toBeEnabled();
      if (!known.uploadEnabled) {
        await expect(
          dialog.getByText('当前环境尚未通过视频上传验收，S3 上传及平台提交关闭；已有任务仍可只读核对。', {
            exact: true
          })
        ).toBeVisible();
        await expect(dialog.getByRole('button', { name: '准备任务', exact: true })).toBeDisabled();
      }
      if (task) {
        await dialog.getByRole('combobox', { name: '已有任务（手动恢复）' }).selectOption(task.id);
        await expect(dialog.getByText(task.id, { exact: true })).toBeVisible();
        const fileInput = dialog.locator('input[type="file"]');
        if (await fileInput.count()) await expect(fileInput).toHaveValue('');
        const resume = dialog.getByRole('button', { name: '继续 S3 暂存', exact: true });
        if (await resume.count()) await expect(resume).toBeDisabled();
      }
      await expect(dialog.getByRole('alert')).toHaveCount(0);
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      report.uiRead = true;
    };

    if (['ui-read', 'inspect', 'verify', 'reconcile'].includes(options.action)) {
      await inspectUi();
      if (options.restart) {
        const before = task
          ? JSON.stringify(task)
          : JSON.stringify((await control({ action: 'list' })).tasks);
        await restartWorker(context, page, worker.url(), boundContext);
        const after = task
          ? JSON.stringify(await getTask())
          : JSON.stringify((await control({ action: 'list' })).tasks);
        if (before !== after) stop('RESTART_RECEIPT_CHANGED');
        report.workerRestart = true;
        await inspectUi();
      }
    }
    if (['stage', 'submit'].includes(options.action) && !known.uploadEnabled)
      stop('FORMAL_EXTENSION_UPLOAD_DISABLED');

    const execute = async (command: VideoUploadCommand) => {
      const result = await control(command);
      const next = result.tasks.find((item) => item.id === journal.taskId);
      if (!next || !journal.taskId) stop('TASK_NOT_RETURNED');
      assertTaskIdentity(next, journal, journal.taskId);
      task = next;
      report.task = taskEvidence(next);
      await atomicWriteJson(reportPath, report);
      return next;
    };
    const target = () => {
      if (!task) stop('TASK_REQUIRED');
      return { taskId: task.id, revision: task.revision };
    };
    if (options.action === 'prepare' || options.action === 'stage') {
      if (!options.file) stop('FILE_REQUIRED');
      const filePath = resolve(root, options.file);
      const file = new File([await openAsBlob(filePath, { type: 'video/mp4' })], basename(filePath), {
        type: 'video/mp4'
      });
      const fingerprint = task ? await verifyReselectedVideo(file, task) : await fingerprintVideoFile(file);
      if (options.action === 'prepare') {
        await execute({
          action: 'create',
          title: `Extension video acceptance ${runId}`,
          source: { kind: 'file', file: fingerprint }
        });
        report.status = known.uploadEnabled
          ? 'local-task-prepared-no-upload'
          : 'local-task-prepared-upload-disabled';
      } else {
        if (!task) stop('TASK_REQUIRED');
        assertCanStage(task, journal, options.resume);
        if (task.status === 'prepared') await execute({ action: 'initiate', ...target() });
        let sent = 0;
        for (const part of task.parts) {
          if (part.status === 'confirmed') continue;
          if (part.status !== 'pending') stop('READ_ONLY_RECONCILIATION_REQUIRED');
          const start = (part.partNumber - 1) * VIDEO_UPLOAD_PART_BYTES;
          const bytes = Buffer.from(await file.slice(start, start + part.byteLength).arrayBuffer());
          await execute({
            action: 'part',
            ...target(),
            partNumber: part.partNumber,
            contentBase64: bytes.toString('base64'),
            fileSha256: fingerprint.sha256
          });
          sent++;
          if (options.stopAfterParts !== null && sent >= options.stopAfterParts) break;
        }
        if (options.stopAfterParts !== null && sent >= options.stopAfterParts) {
          report.status = 'paused-between-confirmed-parts-no-submit';
        } else {
          if (task.status !== 'staged') await execute({ action: 'complete', ...target() });
          if (task.status !== 'staged') stop('STAGING_NOT_CONFIRMED');
          report.status = 'staged-not-submitted';
        }
      }
    } else if (options.action === 'submit') {
      if (!task) stop('TASK_REQUIRED');
      assertCanSubmit(task, journal);
      await execute({ action: 'submit', ...target(), confirmed: true });
      report.status = 'submitted-readback-required';
      process.exitCode = 2; // Even an accepted response is NOT upload acceptance.
    } else if (options.action === 'verify') {
      if (!task) stop('TASK_REQUIRED');
      if (task.status !== 'confirmed') await execute({ action: 'verify', ...target() });
      report.status =
        task.status === 'confirmed' ? 'platform-readback-confirmed' : 'platform-readback-pending';
      if (task.status !== 'confirmed') process.exitCode = 2;
    } else if (options.action === 'reconcile') {
      if (!task) stop('TASK_REQUIRED');
      if (!['staging', 'needs-review'].includes(task.status)) stop('RECONCILE_STATE_INVALID');
      const reconciled = await execute({ action: 'reconcile', ...target() });
      recordReconciliation(journal, reconciled);
      await persist();
      report.status = 'read-only-reconciled-no-resume';
    } else {
      report.status = 'read-only-passed-no-upload';
    }
  } catch (error) {
    report.status = 'stopped-no-automatic-retry';
    report.reason = error instanceof SmokeError ? error.message : 'SMOKE_FAILED_REVIEW_LOCAL_STATE';
    report.failureSites =
      error instanceof Error
        ? (error.stack?.match(/smoke-extension-video-upload-real\.ts:\d+:\d+/gu) ?? [])
        : [];
    process.exitCode = 1;
  } finally {
    try {
      // Never clear vaults/tasks or abort/delete remote uploads, even on failure.
      if (context) await context.close();
    } catch {
      report.status = 'stopped-no-automatic-retry';
      report.reason = 'BROWSER_CLOSE_FAILED';
      process.exitCode = 1;
    }
    try {
      await atomicWriteJson(reportPath, report);
      console.log(
        JSON.stringify({
          status: report.status,
          reason: report.reason,
          runId,
          taskId: report.task?.id ?? null,
          report: relative(root, reportPath)
        })
      );
    } finally {
      await lock.close();
      await unlink(resolve(directory, 'active.lock'));
    }
  }
}

async function send(
  page: Page,
  message: Record<string, unknown>,
  requestId: string = randomUUID()
): Promise<unknown> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let response: unknown;
  try {
    response = await Promise.race([
      page.evaluate((value) => chrome.runtime.sendMessage(value), { ...message, requestId }),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new SmokeError('COMMAND_TIMEOUT_NO_RETRY'));
        }, 180_000);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
  // Timeout does not imply cancellation. The durable intent blocks another write attempt.
  if (!record(response) || response.requestId !== requestId) stop('RESPONSE_CORRELATION_INVALID');
  if (response.ok !== true || !('data' in response)) stop('HANDLER_REJECTED_CHECK_STATE_NO_RETRY');
  return response.data;
}

function ignoredPath(path: string): string {
  const child = relative(root, path);
  if (!child || child === '..' || child.startsWith(`..${sep}`) || resolve(root, child) !== path)
    stop('IGNORED_WORKSPACE_PATH_REQUIRED');
  try {
    execFileSync('git', ['check-ignore', '--quiet', '--', child], {
      cwd: root,
      stdio: 'ignore',
      windowsHide: true
    });
  } catch {
    stop('IGNORED_WORKSPACE_PATH_REQUIRED');
  }
  return path;
}

async function configureStorage(page: Page): Promise<void> {
  // Read-only connection: no migrations, DB backups, configuration rewrites or private-host substitution.
  const { DatabaseSync } = await import('node:sqlite');
  const { S3StorageConfigurationCipher, SqlS3StorageConfigurationRepository } =
    await import('../apps/api/src/storage/s3-configuration');
  const databasePath = ignoredPath(
    resolve(root, process.env.ONE_VEGETABLE_S3_SMOKE_DATABASE ?? 'artifacts/s3-live-validation/ui.sqlite')
  );
  const database = new DatabaseSync(databasePath, { readOnly: true });
  let saved;
  try {
    saved = await new SqlS3StorageConfigurationRepository({
      query: (sql, parameters = []) => Promise.resolve(database.prepare(sql).all(...parameters)),
      execute: () => stop('SOURCE_DATABASE_READ_ONLY')
    }).find();
  } finally {
    database.close();
  }
  if (!saved) stop('SAVED_STORAGE_MISSING');
  let encodedKey = process.env.ONE_VEGETABLE_CREDENTIAL_ENCRYPTION_KEY;
  if (!encodedKey && existsSync(resolve(root, '.env'))) {
    // Do not load .env into process.env: saved environment must NEVER provide opt-in flags.
    encodedKey = parseEnv(
      await readFile(ignoredPath(resolve(root, '.env')), 'utf8')
    ).ONE_VEGETABLE_CREDENTIAL_ENCRYPTION_KEY;
  }
  encodedKey ??= await readFile(ignoredPath(resolve(root, '.data/local-credential-encryption-key')), 'utf8');
  const stored = await (await S3StorageConfigurationCipher.create(encodedKey.trim())).decrypt(saved);
  // Only the isolated profile uses an empty root; the source DB remains unchanged.
  const configuration = { ...stored, rootPrefix: '' };
  assertStorage(configuration);
  const summary = await send(page, { kind: 's3-storage-request', operation: 'summary', payload: {} });
  if (!record(summary)) stop('STORAGE_SUMMARY_INVALID');
  if (summary.configured !== true) {
    await page.getByLabel('Endpoint', { exact: true }).fill(configuration.endpoint);
    await page.getByLabel('Region', { exact: true }).fill(configuration.region);
    await page.getByLabel('Bucket', { exact: true }).fill(configuration.bucket);
    await page.getByLabel('Access Key ID', { exact: true }).fill(configuration.accessKeyId);
    await page.getByLabel('Secret Access Key', { exact: true }).fill(configuration.secretAccessKey);
    await page.getByLabel('素材根目录', { exact: true }).fill('');
    await page.getByLabel('使用 Path-style 地址', { exact: false }).setChecked(true);
    if (configuration.sessionToken)
      await page.getByLabel('Session Token（可选）', { exact: true }).fill(configuration.sessionToken);
    console.log('Approve the exact S3 host in the native Chromium prompt if shown. No upload is running.');
    await page.getByRole('button', { name: '加密保存', exact: true }).click();
    await expect(page.getByText('S3 配置已加密保存。', { exact: true })).toBeVisible({ timeout: 180_000 });
    await expect(page.getByLabel('Secret Access Key', { exact: true })).toHaveValue('');
  }
  const actual = requireGalleryContext(await send(page, { kind: 'gallery-transfer-context' }));
  if (actual.storage !== (await galleryStorageId(configuration)))
    stop('STORED_PROFILE_CONFIGURATION_CHANGED');
}

async function restartWorker(
  context: BrowserContext,
  page: Page,
  workerUrl: string,
  expected: GalleryTransferContext
) {
  const active = context.serviceWorkers().filter((worker) => worker.url() === workerUrl);
  if (active.length !== 1 || !active[0] || context.serviceWorkers().length !== 1)
    stop('ISOLATED_WORKER_REQUIRED');
  const before = await active[0].evaluate(() => performance.timeOrigin);
  const internals = await context.newPage();
  try {
    await internals.goto('chrome://serviceworker-internals');
    await expect(internals.getByText(workerUrl, { exact: true })).toBeVisible();
    await expect(internals.getByText('Stop', { exact: true })).toHaveCount(1);
    // Real worker lifecycle only; never inject credentials/flags/hooks on restart.
    await internals.getByText('Stop', { exact: true }).click();
    await expect(internals.locator('body')).toContainText('STOPPED');
    const actual = requireGalleryContext(await send(page, { kind: 'gallery-transfer-context' }));
    // Chromium may reattach the existing Playwright Worker object without a new event.
    // A strictly newer execution timeOrigin, not object identity, proves restart.
    await expect
      .poll(
        async () => {
          const current = context.serviceWorkers().filter((worker) => worker.url() === workerUrl);
          const origins = await Promise.all(
            current.map((worker) => worker.evaluate(() => performance.timeOrigin).catch(() => 0))
          );
          return Math.max(0, ...origins);
        },
        { timeout: 15_000 }
      )
      .toBeGreaterThan(before);
    for (const field of ['identity', 'gateway', 'storage'] as const)
      if (actual[field] !== expected[field]) stop('RESTART_CONTEXT_CHANGED');
    await page.reload();
  } finally {
    await internals.close();
  }
}

async function inspectBuild(): Promise<string> {
  const manifest = JSON.parse(await readFile(resolve(extensionPath, 'manifest.json'), 'utf8')) as unknown;
  if (
    !record(manifest) ||
    manifest.manifest_version !== 3 ||
    !record(manifest.background) ||
    manifest.background.service_worker !== 'background.js' ||
    JSON.stringify(manifest.host_permissions) !== JSON.stringify(['https://eco.taobao.com/*'])
  )
    stop('FORMAL_MV3_MANIFEST_REQUIRED');
  // Pin evidence to actual formal bytes, not source code or a copied/patched test extension.
  const hash = createHash('sha256');
  async function walk(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      const path = resolve(directory, entry.name);
      if (entry.isSymbolicLink()) stop('FORMAL_BUILD_SYMLINK_REJECTED');
      if (entry.isDirectory()) await walk(path);
      else {
        hash.update(relative(extensionPath, path).replaceAll('\\', '/'));
        hash.update('\0');
        hash.update(await readFile(path));
        hash.update('\0');
      }
    }
  }
  await walk(extensionPath);
  return hash.digest('hex');
}

try {
  await main();
} catch (error) {
  console.error(error instanceof SmokeError ? error.message : 'SMOKE_STOPPED_NO_SENSITIVE_DIAGNOSTICS');
  process.exitCode = 1;
}
