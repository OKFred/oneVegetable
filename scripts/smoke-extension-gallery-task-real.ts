import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, expect, type Page } from '@playwright/test';
import { unzipSync } from 'fflate';
import { ALIBABA_GATEWAY, parseAlibabaOpenApiCredentialBundle } from '../packages/core/src/index';
import { galleryTaskReport, validateGalleryTransferTask } from '../packages/core/src/gallery-transfer-task';
import { atomicWriteJson } from './openapi-auth/storage';

declare const chrome: { runtime: { sendMessage(message: unknown): Promise<unknown> } };
if (process.env.ONE_VEGETABLE_EXTENSION_GALLERY_SMOKE !== '1') throw new Error('Explicit opt-in required.');
const profile = process.env.ONE_VEGETABLE_S3_SMOKE_PROFILE;
if (!profile) throw new Error('Use an existing native-permission-granted profile.');
const directory = resolve('artifacts/gallery-transfer-2.6/extension-rustfs');
const bundle = parseAlibabaOpenApiCredentialBundle(
  JSON.parse(await readFile('artifacts/openapi-auth/credentials.json', 'utf8')) as unknown
);
const passphrase = createHash('sha256')
  .update(bundle.application.appSecret)
  .update('\0gallery-task-260')
  .digest('base64url');
const extension = resolve('apps/extension/.output/chrome-mv3');
const context = await chromium.launchPersistentContext(resolve(profile), {
  headless: false,
  locale: 'zh-CN',
  viewport: { width: 1440, height: 1000 },
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
});
let stage = 'initialize';
let page: Page | null = null;
try {
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const base = `chrome-extension://${new URL(worker.url()).host}/options.html`;
  page = await context.newPage();
  await page.goto(`${base}#/settings`);
  const previous = await tasks(page);
  if (previous.length) throw new Error('Existing task receipts: do not repeat real import.');
  const vault: unknown = await page.evaluate(
    async ({ settings, passphrase }) => {
      const status = (await chrome.runtime.sendMessage({
        kind: 'credential-vault-request',
        requestId: crypto.randomUUID(),
        operation: 'status',
        payload: {}
      })) as { ok?: boolean; data?: { state?: string } };
      if (!status.ok) return status;
      if (status.data?.state === 'empty')
        return chrome.runtime.sendMessage({
          kind: 'credential-vault-request',
          requestId: crypto.randomUUID(),
          operation: 'create',
          payload: { passphrase, settings }
        });
      if (status.data?.state === 'locked') {
        const unlocked = (await chrome.runtime.sendMessage({
          kind: 'credential-vault-request',
          requestId: crypto.randomUUID(),
          operation: 'unlock',
          payload: { passphrase }
        })) as { ok?: boolean };
        if (!unlocked.ok) return unlocked;
      }
      return chrome.runtime.sendMessage({
        kind: 'credential-vault-request',
        requestId: crypto.randomUUID(),
        operation: 'save',
        payload: settings
      });
    },
    {
      passphrase,
      settings: {
        appKey: bundle.application.appKey,
        appSecret: bundle.application.appSecret,
        accessToken: bundle.oauth.accessToken,
        endpoint: ALIBABA_GATEWAY,
        signMethod: 'hmac'
      }
    }
  );
  if (!record(vault) || vault.ok !== true) throw new Error('VAULT_SETUP_FAILED');
  await page.evaluate(() => {
    localStorage.setItem(
      'one-vegetable:preferences:v2',
      JSON.stringify({ uiLocale: 'zh-CN', alibabaLanguage: 'en_US', theme: 'dark' })
    );
    localStorage.setItem(
      'one-vegetable:gallery-import-rules:v1',
      JSON.stringify({
        schemaVersion: 1,
        conflictPolicy: 'rename',
        rules: [
          {
            id: 'extension-260',
            name: 'Local extension verification',
            enabled: true,
            sourcePrefix: 'source/',
            includeGlob: '**',
            excludeGlobs: [],
            targetGroupPath: 'ov-260-local-20260910'
          }
        ]
      })
    );
  });
  await page.goto(`${base}#/photos`);
  await expect(page.getByRole('heading', { name: '图库', exact: true })).toBeVisible({ timeout: 60_000 });
  stage = 's3-import-existing-group-without-creation';
  console.log('Running real extension gallery import into the existing isolated test group.');
  await page.getByRole('button', { name: '导入', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '导入图库素材', exact: true });
  await dialog.getByRole('button', { name: 'S3', exact: true }).click();
  await dialog.getByRole('checkbox').uncheck();
  await dialog.getByRole('button', { name: /扫描/ }).click();
  await expect(dialog.getByRole('button', { name: '导入', exact: true })).toBeEnabled({ timeout: 60_000 });
  await dialog.getByRole('button', { name: '导入', exact: true }).click();
  const confirm = page.getByRole('dialog', { name: '确认导入图库', exact: true });
  await expect(confirm).toBeVisible({ timeout: 60_000 });
  await confirm.getByRole('button', { name: '导入', exact: true }).click();
  const currentPage = page;
  await expect
    .poll(async () => (await tasks(currentPage))[0]?.status, { timeout: 180_000, intervals: [1000, 2000] })
    .toBe('completed');
  const imported = (await tasks(page))[0];
  if (
    !imported ||
    imported.items.some((item) => item.kind === 'group') ||
    imported.items.some((item) => item.status !== 'confirmed')
  )
    throw new Error('Import did not verify every image without creating groups.');
  await page.screenshot({ path: resolve(directory, 'task-import.png') });
  stage = 'zip-export';
  const center = page.getByRole('dialog', { name: '传输记录', exact: true });
  await center.getByRole('button', { name: '关闭详情' }).click();
  await page.getByRole('button', { name: 'ov-260-local-20260910', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: /^选择 / }).first()).toBeVisible({ timeout: 30_000 });
  for (let index = 0; index < 2; index++)
    await page
      .getByRole('checkbox', { name: /^选择 / })
      .first()
      .check();
  await page.getByRole('button', { name: '导出', exact: true }).click();
  await page
    .getByRole('dialog', { name: '导出图库素材', exact: true })
    .getByRole('button', { name: '导出', exact: true })
    .click();
  const download = page.waitForEvent('download', { timeout: 90_000 });
  await page
    .getByRole('dialog', { name: '确认导出图库', exact: true })
    .getByRole('button', { name: '导出', exact: true })
    .click();
  await (await download).saveAs(resolve(directory, 'gallery-export.zip'));
  const archive = unzipSync(await readFile(resolve(directory, 'gallery-export.zip')));
  if (
    !archive['gallery.json'] ||
    Object.keys(archive).filter((key) => key.startsWith('assets/')).length !== 2
  )
    throw new Error('ZIP contents incomplete');
  stage = 'reload-persistence';
  await page.reload();
  await page.getByRole('button', { name: '传输记录', exact: true }).click();
  await expect(center.getByRole('button', { name: /已完成/ })).toHaveCount(2);
  await atomicWriteJson(resolve(directory, 'task-report.json'), {
    status: 'passed',
    capturedAtUtc: new Date().toISOString(),
    stages: ['s3-import-no-group-create', 'zip-export', 'reload-persistence'],
    tasks: (await tasks(page)).map(galleryTaskReport),
    bffRequired: false
  });
  console.log('Standalone extension S3 import, ZIP export and persistent receipts verified.');
} catch (error) {
  await atomicWriteJson(resolve(directory, 'task-report.json'), {
    status: 'incomplete',
    stage,
    reason: error instanceof Error ? error.message.slice(0, 400) : 'unknown',
    tasks: page ? (await tasks(page).catch(() => [])).map(galleryTaskReport) : []
  });
  if (page && stage !== 'initialize')
    await page.screenshot({ path: resolve(directory, 'task-failure.png') }).catch(() => undefined);
  console.error(`Extension gallery task stopped at ${stage}; inspect receipts before retrying.`);
  process.exitCode = 1;
} finally {
  await context.close();
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
async function tasks(page: Page) {
  const raw = await page.evaluate(async () => {
    const name = 'one-vegetable-gallery-transfers-v1';
    if (!(await indexedDB.databases()).some((db) => db.name === name)) return [];
    return new Promise<unknown[]>((resolve, reject) => {
      const open = indexedDB.open(name);
      open.onerror = () => {
        reject(new Error('Database open failed'));
      };
      open.onsuccess = () => {
        const db = open.result;
        const read = db.transaction('tasks').objectStore('tasks').getAll();
        read.onerror = () => {
          db.close();
          reject(new Error('Database read failed'));
        };
        read.onsuccess = () => {
          db.close();
          resolve(read.result as unknown[]);
        };
      };
    });
  });
  return raw.map(validateGalleryTransferTask);
}
