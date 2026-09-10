import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { parseAlibabaOpenApiCredentialBundle } from '../packages/core/src/index';
import { chromium, expect, type Page } from '@playwright/test';
import { galleryTaskReport, validateGalleryTransferTask } from '../packages/core/src/gallery-transfer-task';
import { atomicWriteJson } from './openapi-auth/storage';
declare const chrome: { runtime: { sendMessage(message: unknown): Promise<unknown> } };

if (process.env.ONE_VEGETABLE_EXTENSION_GALLERY_SMOKE !== '1') throw new Error('Explicit opt-in required.');
const profile = process.env.ONE_VEGETABLE_S3_SMOKE_PROFILE;
if (!profile) throw new Error('Existing native-granted profile required.');
const directory = resolve('artifacts/gallery-transfer-2.6/extension-rustfs');
const extension = resolve('apps/extension/.output/chrome-mv3');
const context = await chromium.launchPersistentContext(resolve(profile), {
  headless: false,
  locale: 'zh-CN',
  viewport: { width: 1440, height: 1000 },
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
});
let page: Page | null = null;
let stage = 'initialize';
try {
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  page = await context.newPage();
  const base = `chrome-extension://${new URL(worker.url()).host}/options.html`;
  await page.goto(`${base}#/settings`);
  const bundle = parseAlibabaOpenApiCredentialBundle(
    JSON.parse(await readFile('artifacts/openapi-auth/credentials.json', 'utf8')) as unknown
  );
  const passphrase = createHash('sha256')
    .update(bundle.application.appSecret)
    .update('\0gallery-task-260')
    .digest('base64url');
  const unlocked: unknown = await page.evaluate(
    (passphrase) =>
      chrome.runtime.sendMessage({
        kind: 'credential-vault-request',
        requestId: crypto.randomUUID(),
        operation: 'unlock',
        payload: { passphrase }
      }),
    passphrase
  );
  if (typeof unlocked !== 'object' || unlocked === null || !('ok' in unlocked) || unlocked.ok !== true)
    throw new Error('VAULT_UNLOCK_FAILED');
  await page.goto(`${base}#/photos`);
  await expect(page.getByRole('heading', { name: '图库', exact: true })).toBeVisible({ timeout: 60_000 });
  const original = await tasks(page);
  const existingExport = original.find((t) => t.direction === 'export' && t.storage === 's3');
  if (
    original.filter((t) => t !== existingExport).length !== 2 ||
    original.filter((t) => t !== existingExport).some((t) => t.status !== 'completed') ||
    existingExport?.items.some((i) => i.status !== 'pending' || i.requestId !== null)
  )
    throw new Error('Inspect original receipts before starting this one-time follow-up.');
  await page.getByRole('button', { name: 'ov-260-local-20260910', exact: true }).click();
  for (let index = 0; index < 2; index++)
    await page
      .getByRole('checkbox', { name: /^选择 / })
      .first()
      .check();
  // Hold only the first successful response AFTER the real PUT completed, to exercise in-flight pause.
  // This changes no provider request or response data and is not part of the production bundle.
  await page.evaluate(`(() => {
    const original = chrome.runtime.sendMessage.bind(chrome.runtime);
    window.__gallerySmoke = { puts: [], release: null };
    chrome.runtime.sendMessage = async function(message, ...rest) {
      const response = await original(message, ...rest);
      if (message.kind === 's3-storage-request' && message.operation === 'put') {
        window.__gallerySmoke.puts.push({ requestId: message.requestId, ok: response.ok });
        if (window.__gallerySmoke.puts.length === 1 && response.ok) {
          await new Promise(resolve => { window.__gallerySmoke.release = resolve; });
        }
      }
      return response;
    };
  })()`);
  stage = 'pause-inflight-s3-export';
  const center = page.getByRole('dialog', { name: '传输记录', exact: true });
  if (existingExport) {
    await page.getByRole('button', { name: '传输记录', exact: true }).click();
    await center.getByRole('button', { name: new RegExp(existingExport.id.slice(0, 8)) }).click();
    await center.getByRole('button', { name: '继续 / 重试明确失败项', exact: true }).click();
    await page
      .getByRole('dialog', { name: '确认任务操作', exact: true })
      .getByRole('button', { name: '确认', exact: true })
      .click();
  } else {
    await page.getByRole('button', { name: '导出', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '导出图库素材', exact: true });
    await dialog.getByRole('button', { name: 'S3', exact: true }).click();
    await dialog.getByRole('button', { name: '导出到 S3', exact: true }).click();
    await page
      .getByRole('dialog', { name: '确认导出图库', exact: true })
      .getByRole('button', { name: '导出到 S3', exact: true })
      .click();
  }
  await page.waitForFunction(
    () => (window as unknown as { __gallerySmoke: { release: unknown } }).__gallerySmoke.release !== null,
    undefined,
    { timeout: 60_000 }
  );
  await center.getByRole('button', { name: '暂停', exact: true }).click();
  await page.evaluate('window.__gallerySmoke.release()');
  const current = page;
  await expect
    .poll(
      async () => (await tasks(current)).find((t) => t.direction === 'export' && t.storage === 's3')?.status
    )
    .toBe('paused');
  const paused = (await tasks(page)).find((t) => t.direction === 'export' && t.storage === 's3');
  if (!paused || paused.items[0]?.status !== 'confirmed' || paused.items[1]?.status !== 'pending')
    throw new Error('Pause receipt mismatch');
  const firstRequestId = paused.items[0].requestId;
  await center.getByRole('button', { name: '关闭详情' }).click();
  await page.getByRole('link', { name: '设置', exact: true }).click();
  await page.reload();
  stage = 'manual-resume';
  if ((await tasks(page)).find((t) => t.id === paused.id)?.status !== 'paused')
    throw new Error('Unexpected automatic resume');
  await page.getByRole('link', { name: '图库', exact: true }).click();
  await page.getByRole('button', { name: '传输记录', exact: true }).click();
  await center.getByRole('button', { name: new RegExp(paused.id.slice(0, 8)) }).click();
  await center.getByRole('button', { name: '继续 / 重试明确失败项', exact: true }).click();
  await page
    .getByRole('dialog', { name: '确认任务操作', exact: true })
    .getByRole('button', { name: '确认', exact: true })
    .click();
  await expect
    .poll(async () => (await tasks(current)).find((t) => t.id === paused.id)?.status, { timeout: 90_000 })
    .toBe('completed');
  if ((await tasks(page)).find((t) => t.id === paused.id)?.items[0]?.requestId !== firstRequestId)
    throw new Error('Already-confirmed asset was repeated');
  await page.screenshot({ path: resolve(directory, 'task-recovery.png') });
  await center.getByRole('button', { name: '关闭详情' }).click();
  stage = 'zip-import';
  await page.getByRole('button', { name: 'ov-260-local-20260910', exact: true }).click();
  await page.getByRole('button', { name: '导入', exact: true }).click();
  const importing = page.getByRole('dialog', { name: '导入图库素材', exact: true });
  await importing.locator('input[type="file"]').setInputFiles(resolve(directory, 'gallery-export.zip'));
  await expect(importing.getByRole('button', { name: '导入', exact: true })).toBeEnabled();
  await importing.getByRole('button', { name: '导入', exact: true }).click();
  await page
    .getByRole('dialog', { name: '确认导入图库', exact: true })
    .getByRole('button', { name: '导入', exact: true })
    .click();
  await expect
    .poll(
      async () => (await tasks(current)).find((t) => t.direction === 'import' && t.storage === 'zip')?.status,
      { timeout: 120_000 }
    )
    .toBe('completed');
  await atomicWriteJson(resolve(directory, 'task-recovery-report.json'), {
    status: 'passed',
    capturedAtUtc: new Date().toISOString(),
    stages: [
      'real-put-inflight-pause',
      'navigate',
      'reload-no-auto-resume',
      'manual-resume',
      's3-digest-readback',
      'zip-import'
    ],
    tasks: (await tasks(page)).map(galleryTaskReport),
    bffRequired: false,
    firstWriteRequestId: firstRequestId
  });
  console.log('Extension real pause, manual recovery, S3 export and ZIP import verified.');
} catch (error) {
  if (page) await page.evaluate('window.__gallerySmoke?.release?.()').catch(() => undefined);
  await atomicWriteJson(resolve(directory, 'task-recovery-report.json'), {
    status: 'incomplete',
    stage,
    reason: error instanceof Error ? error.message.slice(0, 400) : 'unknown',
    tasks: page ? (await tasks(page).catch(() => [])).map(galleryTaskReport) : []
  });
  console.error(`Extension recovery stopped at ${stage}; no automatic retry.`);
  process.exitCode = 1;
} finally {
  await context.close();
}

async function tasks(page: Page) {
  const raw = await page.evaluate(
    () =>
      new Promise<unknown[]>((resolve, reject) => {
        const open = indexedDB.open('one-vegetable-gallery-transfers-v1');
        open.onerror = () => {
          reject(new Error('open'));
        };
        open.onsuccess = () => {
          const db = open.result;
          const read = db.transaction('tasks').objectStore('tasks').getAll();
          read.onerror = () => {
            db.close();
            reject(new Error('read'));
          };
          read.onsuccess = () => {
            db.close();
            resolve(read.result as unknown[]);
          };
        };
      })
  );
  return raw.map(validateGalleryTransferTask);
}
