import { chromium, expect, type Page } from '@playwright/test';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { unzipSync } from 'fflate';
import { createHash } from 'node:crypto';
import { validateGalleryTransferTask, galleryTaskReport } from '../packages/core/src/gallery-transfer-task';
import { atomicWriteJson } from './openapi-auth/storage';

if (process.env.ONE_VEGETABLE_GALLERY_REAL_SMOKE !== '1')
  throw new Error('Explicit gallery smoke opt-in required');
const directory = resolve('artifacts/gallery-transfer-2.6/local');
const context = await chromium.launchPersistentContext(resolve(directory, 'profile'), {
  headless: true,
  locale: 'zh-CN',
  viewport: { width: 1440, height: 1000 }
});
const page = context.pages()[0] ?? (await context.newPage());
let release = () => undefined;
let stage = 'load-original-import';
const puts: string[] = [];
const putCount = () => puts.length;
try {
  await page.goto('http://localhost:4286/#/photos');
  await expect(page.getByRole('heading', { name: '图库', exact: true })).toBeVisible({ timeout: 30_000 });
  const original = await tasks(page);
  if (original.some((task) => task.direction === 'export'))
    throw new Error('Export receipts already exist. Inspect them before creating another export.');
  const imported = original.find((task) => task.direction === 'import' && task.status === 'completed');
  const group = imported?.items.find((item) => item.kind === 'group' && item.status === 'confirmed');
  if (!group) throw new Error('Verified isolated import group is required');
  await page.getByRole('button', { name: group.fileName, exact: true }).click();
  await expect(page.getByRole('checkbox', { name: /^选择 / })).toHaveCount(2);
  for (let index = 0; index < 2; index++)
    await page
      .getByRole('checkbox', { name: /^选择 / })
      .first()
      .check();
  let firstPut = () => undefined;
  const firstPutReached = new Promise<void>((resolve) => {
    firstPut = resolve;
  });
  const heldResponse = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/admin/storage/s3/objects/put', async (route) => {
    const body: unknown = route.request().postDataJSON();
    if (!record(body) || typeof body.requestId !== 'string') throw new Error('Invalid write envelope');
    puts.push(body.requestId);
    const response = await route.fetch();
    if (puts.length === 1) {
      firstPut();
      await heldResponse;
    }
    await route.fulfill({ response });
  });
  stage = 'export-and-pause';
  await page.getByRole('button', { name: '导出', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '导出图库素材', exact: true });
  await dialog.getByRole('button', { name: 'S3', exact: true }).click();
  await dialog.getByRole('button', { name: '导出到 S3', exact: true }).click();
  await page
    .getByRole('dialog', { name: '确认导出图库', exact: true })
    .getByRole('button', { name: '导出到 S3', exact: true })
    .click();
  await Promise.race([
    firstPutReached,
    new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error('First PUT was not reached'));
      }, 60_000);
    })
  ]);
  const center = page.getByRole('dialog', { name: '传输记录', exact: true });
  await center.getByRole('button', { name: '暂停', exact: true }).click();
  release();
  await expect
    .poll(async () => (await tasks(page)).find((task) => task.direction === 'export')?.status, {
      timeout: 30_000
    })
    .toBe('paused');
  const paused = (await tasks(page)).find((task) => task.direction === 'export');
  if (
    !paused ||
    paused.items[0]?.status !== 'confirmed' ||
    paused.items[1]?.status !== 'pending' ||
    putCount() !== 1
  )
    throw new Error('Pause did not preserve the current receipt / prevent later PUTs');
  await page.screenshot({ path: resolve(directory, 'paused.png') });
  await center.getByRole('button', { name: '关闭详情' }).click();
  await page.getByRole('link', { name: '设置', exact: true }).click();
  stage = 'reload-and-manual-resume';
  await page.reload();
  await page.getByRole('link', { name: '图库', exact: true }).click();
  if (putCount() !== 1) throw new Error('Reload automatically resumed a write');
  await page.getByRole('button', { name: '传输记录', exact: true }).click();
  await center.getByRole('button', { name: new RegExp(paused.id.slice(0, 8)) }).click();
  await center.getByRole('button', { name: '继续 / 重试明确失败项', exact: true }).click();
  await page
    .getByRole('dialog', { name: '确认任务操作', exact: true })
    .getByRole('button', { name: '确认', exact: true })
    .click();
  await expect
    .poll(async () => (await tasks(page)).find((task) => task.id === paused.id)?.status, { timeout: 90_000 })
    .toBe('completed');
  if (new Set(puts).size !== 3 || putCount() !== 3)
    throw new Error('Expected two unique asset writes and one final manifest, without repeats');
  await page.screenshot({ path: resolve(directory, 'recovered.png') });
  await center.getByRole('button', { name: '关闭详情' }).click();
  stage = 'zip-export';
  await page.getByRole('button', { name: group.fileName, exact: true }).click();
  for (let index = 0; index < 2; index++)
    await page
      .getByRole('checkbox', { name: /^选择 / })
      .first()
      .check();
  await page.getByRole('button', { name: '导出', exact: true }).click();
  await dialog.getByRole('button', { name: '导出', exact: true }).click();
  const download = page.waitForEvent('download');
  await page
    .getByRole('dialog', { name: '确认导出图库', exact: true })
    .getByRole('button', { name: '导出', exact: true })
    .click();
  const artifact = await download;
  const path = resolve(directory, 'gallery-export.zip');
  await artifact.saveAs(path);
  const archive = unzipSync(await readFile(path));
  if (
    !archive['gallery.json'] ||
    Object.keys(archive).filter((key) => key.startsWith('assets/')).length !== 2
  )
    throw new Error('ZIP manifest/assets incomplete');
  await atomicWriteJson(resolve(directory, 'recovery-real-report.json'), {
    status: 'passed',
    capturedAtUtc: new Date().toISOString(),
    stages: [
      'pause-after-inflight',
      'navigation',
      'reload-no-autoresume',
      'manual-resume',
      's3-readback',
      'zip-download'
    ],
    putRequestIds: puts,
    archiveSha256: createHash('sha256')
      .update(await readFile(path))
      .digest('hex'),
    tasks: (await tasks(page)).map(galleryTaskReport),
    productMutations: 0
  });
  console.log(
    'Real S3 export, pause, reload/manual resume and ZIP export passed; first asset was not uploaded twice.'
  );
} catch (error) {
  release();
  await atomicWriteJson(resolve(directory, 'recovery-real-report.json'), {
    status: 'incomplete',
    stage,
    reason: error instanceof Error ? error.message.slice(0, 400) : 'unknown',
    putRequestIds: puts,
    tasks: (await tasks(page).catch(() => [])).map(galleryTaskReport)
  });
  await page.screenshot({ path: resolve(directory, 'recovery-failure.png') }).catch(() => undefined);
  console.log(`Recovery validation stopped at ${stage}; inspect local receipts before retrying.`);
  process.exitCode = 1;
} finally {
  release();
  await context.close();
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
async function tasks(page: Page) {
  const raw: unknown[] = await page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open('one-vegetable-gallery-transfers-v1');
        open.onsuccess = () => {
          const db = open.result;
          const read = db.transaction('tasks').objectStore('tasks').getAll();
          read.onsuccess = () => {
            db.close();
            resolve(read.result as unknown[]);
          };
          read.onerror = () => {
            db.close();
            reject(new Error('Read failed'));
          };
        };
        open.onerror = () => {
          reject(new Error('Open failed'));
        };
      })
  );
  return raw.map(validateGalleryTransferTask);
}
