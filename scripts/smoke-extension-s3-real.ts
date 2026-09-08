import { existsSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadEnvFile } from 'node:process';
import { createHash } from 'node:crypto';
import { chromium, expect, type Page } from '@playwright/test';
import { openNodeDatabase } from '../apps/api/src/db/node-database';
import {
  S3StorageConfigurationCipher,
  SqlS3StorageConfigurationRepository
} from '../apps/api/src/storage/s3-configuration';
import { atomicWriteJson } from './openapi-auth/storage';
import { validS3Output, type S3Operation } from '../apps/extension/lib/s3-protocol';
declare const chrome: {
  runtime: { sendMessage(message: unknown): Promise<unknown> };
  storage: { local: { get(key: string): Promise<Record<string, unknown>> } };
  permissions: {
    remove(input: { origins: string[] }): Promise<boolean>;
    contains(input: { origins: string[] }): Promise<boolean>;
  };
};

// Explicitly authorized smoke: two new objects in a unique prefix; no deletion or Alibaba mutations.
if (process.env.ONE_VEGETABLE_EXTENSION_S3_SMOKE !== '1')
  throw new Error('Set ONE_VEGETABLE_EXTENSION_S3_SMOKE=1.');
if (existsSync('.env')) loadEnvFile('.env');
const databasePath = resolve(
  process.env.ONE_VEGETABLE_S3_SMOKE_DATABASE ?? 'artifacts/s3-live-validation/ui.sqlite'
);
if (!existsSync(databasePath)) throw new Error('Local encrypted S3 database is missing.');
const database = openNodeDatabase(databasePath);
const saved = await new SqlS3StorageConfigurationRepository(database.executor).find();
database.connection.close();
if (!saved) throw new Error('Local encrypted S3 configuration is missing.');
const encodedKey =
  process.env.ONE_VEGETABLE_CREDENTIAL_ENCRYPTION_KEY?.trim() ??
  (await readFile('.data/local-credential-encryption-key', 'utf8')).trim();
const configuration = await (await S3StorageConfigurationCipher.create(encodedKey)).decrypt(saved);
const directory = resolve('artifacts/extension-s3-validation');
await mkdir(directory, { recursive: true });
const profile = await mkdtemp(resolve(directory, 'profile-'));
let extension = resolve('apps/extension/.output/chrome-mv3');
const pregrantedTestHost = process.env.ONE_VEGETABLE_S3_PREGRANTED_TEST_HOST === '1';
const hostOrigin = configuration.pathStyle
  ? configuration.endpoint
  : configuration.endpoint.replace('://', `://${configuration.bucket}.`);
if (pregrantedTestHost) {
  // Test copy only. Production manifest and optional-permission flow stay unchanged.
  const copy = await mkdtemp(resolve(directory, 'pregranted-build-'));
  await cp(extension, copy, { recursive: true });
  const manifest: unknown = JSON.parse(await readFile(resolve(copy, 'manifest.json'), 'utf8'));
  if (!isRecord(manifest) || !Array.isArray(manifest.host_permissions))
    throw new Error('Invalid production manifest');
  const hosts: unknown[] = manifest.host_permissions;
  if (!hosts.every((host): host is string => typeof host === 'string'))
    throw new Error('Invalid host permissions');
  await atomicWriteJson(resolve(copy, 'manifest.json'), {
    ...manifest,
    host_permissions: [...hosts, `${hostOrigin}/*`]
  });
  extension = copy;
}
const prefix = `extension-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
const calls: { operation: string; requestId: string; ok: boolean }[] = [];
const context = await chromium.launchPersistentContext(profile, {
  headless: false,
  locale: 'zh-CN',
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
});
let stage = 'initialize';
try {
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const base = `chrome-extension://${new URL(worker.url()).host}/options.html`;
  const page = await context.newPage();
  await page.goto(base);
  const onboarding = page.getByRole('dialog', { name: '四步连接 Alibaba 开放平台' });
  await onboarding.getByRole('checkbox').check();
  await onboarding.getByRole('button', { name: '稍后，仅浏览' }).click();
  await page.goto(`${base}#/settings`);
  // Labels are unique even when the Alibaba settings form is also visible.
  await page.getByLabel('Endpoint', { exact: true }).fill(configuration.endpoint);
  await page.getByLabel('Region', { exact: true }).fill(configuration.region);
  await page.getByLabel('Bucket', { exact: true }).fill(configuration.bucket);
  await page.getByLabel('Access Key ID', { exact: true }).fill(configuration.accessKeyId);
  await page.getByLabel('Secret Access Key', { exact: true }).fill(configuration.secretAccessKey);
  await page.getByLabel('素材根目录', { exact: true }).fill(configuration.rootPrefix);
  await page.getByLabel('使用 Path-style 地址', { exact: false }).setChecked(configuration.pathStyle);
  if (configuration.sessionToken)
    await page.getByLabel('Session Token（可选）', { exact: true }).fill(configuration.sessionToken);
  stage = 'save-and-permission';
  console.log('Saving S3 configuration. Approve the exact storage-host permission in Chromium if prompted.');
  await page.getByRole('button', { name: '加密保存', exact: true }).click();
  await expect(page.getByText('S3 配置已加密保存。', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByLabel('Secret Access Key', { exact: true })).toHaveValue('');
  stage = 'test';
  await call(page, 'test');
  const raw = await page.evaluate(() => chrome.storage.local.get('one-vegetable.s3.v1'));
  if (JSON.stringify(raw).includes(configuration.secretAccessKey))
    throw new Error('Secret storage check failed');
  stage = 'write';
  const bytes = await readFile('apps/extension/public/icon.png');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  await call(page, 'put', {
    key: `${prefix}/assets/extension.png`,
    contentBase64: bytes.toString('base64'),
    contentType: 'image/png'
  });
  const manifest = Buffer.from(
    JSON.stringify({ kind: 'one-vegetable-extension-s3-verification', path: 'assets/extension.png', sha256 })
  );
  await call(page, 'put', {
    key: `${prefix}/gallery.json`,
    contentBase64: manifest.toString('base64'),
    contentType: 'application/json'
  });
  stage = 'readback';
  const listed = await call(page, 'list', { prefix, maximum: 10 });
  if (!isRecord(listed) || !Array.isArray(listed.items) || listed.items.length !== 2)
    throw new Error('Listing count mismatch');
  const image = await call(page, 'get', { key: `${prefix}/assets/extension.png` });
  if (
    !isRecord(image) ||
    typeof image.contentBase64 !== 'string' ||
    createHash('sha256').update(Buffer.from(image.contentBase64, 'base64')).digest('hex') !== sha256
  )
    throw new Error('Readback digest mismatch');
  const cdp = await context.newCDPSession(page);
  await cdp.send('ServiceWorker.enable');
  stage = 'worker-restart';
  await cdp.send('ServiceWorker.stopAllWorkers');
  await page.reload();
  await call(page, 'test');
  stage = 'revoked-permission';
  if (!pregrantedTestHost) {
    const origin = hostOrigin;
    await page.evaluate(
      (originPattern) => chrome.permissions.remove({ origins: [originPattern] }),
      `${origin}/*`
    );
    const denied = await page.evaluate(async () => {
      const response: unknown = await chrome.runtime.sendMessage({
        kind: 's3-storage-request',
        requestId: crypto.randomUUID(),
        operation: 'test',
        payload: {}
      });
      return response;
    });
    if (
      !isRecord(denied) ||
      denied.ok !== false ||
      !isRecord(denied.error) ||
      denied.error.code !== 'S3_PERMISSION_REQUIRED'
    )
      throw new Error('Revocation guard failed');
  }
  stage = 'clear';
  await call(page, 'clear', { revision: 1 });
  await atomicWriteJson(resolve(directory, 'report.json'), {
    capturedAtUtc: new Date().toISOString(),
    status: 'passed',
    prefix,
    sha256,
    bytes: bytes.byteLength,
    calls,
    workerRestart: true,
    revokedPermissionBlocked: pregrantedTestHost ? null : true,
    permissionMode: pregrantedTestHost ? 'isolated-manifest-pregrant' : 'production-optional-grant',
    alibabaMutations: 0
  });
  console.log('Extension S3 real smoke passed (redacted report saved).');
} catch {
  const lastPage = context.pages().at(-1);
  const visibleCodes = lastPage
    ? await lastPage
        .locator('body')
        .innerText()
        .then((text) => [...new Set(text.match(/S3_[A-Z_]+/gu) ?? [])])
        .catch(() => [])
    : [];
  const permissionGranted = lastPage
    ? await lastPage
        .evaluate(
          (origin) => chrome.permissions.contains({ origins: [`${origin}/*`] }),
          configuration.endpoint
        )
        .catch(() => false)
    : false;
  const summary: unknown = lastPage
    ? await lastPage
        .evaluate(() =>
          chrome.runtime.sendMessage({
            kind: 's3-storage-request',
            requestId: crypto.randomUUID(),
            operation: 'summary',
            payload: {}
          })
        )
        .catch(() => null)
    : null;
  const summaryDiagnostic = isRecord(summary)
    ? {
        ok: summary.ok === true,
        configured: isRecord(summary.data) && summary.data.configured === true,
        errorCode: isRecord(summary.error) ? summary.error.code : null
      }
    : null;
  await atomicWriteJson(resolve(directory, 'report.json'), {
    capturedAtUtc: new Date().toISOString(),
    status: 'failed',
    stage,
    prefix,
    calls,
    visibleCodes,
    permissionGranted,
    summaryDiagnostic
  });
  console.error(`Extension S3 verification failed at ${stage}; no sensitive diagnostics saved.`);
  process.exitCode = 1;
} finally {
  await context.close();
}

async function call(
  page: Page,
  operation: S3Operation,
  payload: Record<string, unknown> = {}
): Promise<unknown> {
  const requestId = crypto.randomUUID();
  const response: unknown = await page.evaluate((message) => chrome.runtime.sendMessage(message), {
    kind: 's3-storage-request',
    requestId,
    operation,
    payload
  });
  const ok =
    isRecord(response) &&
    response.requestId === requestId &&
    response.ok === true &&
    validS3Output(operation, response.data);
  calls.push({ requestId, operation, ok });
  if (!ok || !isRecord(response)) throw new Error('S3 verification failed');
  return response.data;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
