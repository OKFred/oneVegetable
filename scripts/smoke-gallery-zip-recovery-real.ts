import { resolve } from 'node:path';
import { chromium, expect, type Page } from '@playwright/test';
import { galleryTaskReport, validateGalleryTransferTask } from '../packages/core/src/gallery-transfer-task';
import { atomicWriteJson } from './openapi-auth/storage';

if (process.env.ONE_VEGETABLE_GALLERY_REAL_SMOKE !== '1') throw new Error('Explicit opt-in required');
const directory = resolve('artifacts/gallery-transfer-2.6/local');
const context = await chromium.launchPersistentContext(resolve(directory, 'profile'), {
  headless: true,
  locale: 'zh-CN'
});
const page = context.pages()[0] ?? (await context.newPage());
let release = () => undefined;
let stage = 'initialize';
const uploads: string[] = [];
const uploadCount = () => uploads.length;
try {
  await page.goto('http://localhost:4286/#/photos');
  await expect(page.getByRole('heading', { name: '图库', exact: true })).toBeVisible({ timeout: 30_000 });
  if ((await tasks(page)).some((t) => t.direction === 'import' && t.storage === 'zip'))
    throw new Error('Existing ZIP import receipt: do not create another.');
  await page.getByRole('button', { name: 'ov-260-local-20260910', exact: true }).click();
  let reached = false;
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/operations/call', async (route) => {
    const body: unknown = route.request().postDataJSON();
    if (!record(body) || body.operation !== 'uploadPhoto') return route.continue();
    if (typeof body.requestId !== 'string') throw new Error('Missing requestId');
    uploads.push(body.requestId);
    const response = await route.fetch();
    if (uploads.length === 1) {
      reached = true;
      await hold;
    }
    await route.fulfill({ response });
  });
  stage = 'first-upload-and-pause';
  await page.getByRole('button', { name: '导入', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '导入图库素材', exact: true });
  await dialog.locator('input[type="file"]').setInputFiles(resolve(directory, 'gallery-export.zip'));
  await expect(dialog.getByRole('button', { name: '导入', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: '导入', exact: true }).click();
  await page
    .getByRole('dialog', { name: '确认导入图库', exact: true })
    .getByRole('button', { name: '导入', exact: true })
    .click();
  await expect.poll(() => reached, { timeout: 60_000 }).toBe(true);
  const center = page.getByRole('dialog', { name: '传输记录', exact: true });
  await center.getByRole('button', { name: '暂停', exact: true }).click();
  release();
  await expect
    .poll(
      async () => (await tasks(page)).find((t) => t.direction === 'import' && t.storage === 'zip')?.status
    )
    .toBe('paused');
  const paused = (await tasks(page)).find((t) => t.direction === 'import' && t.storage === 'zip');
  if (!paused || paused.items[0]?.status !== 'confirmed' || paused.items[1]?.status !== 'pending')
    throw new Error('Unexpected pause receipt');
  await page.reload();
  stage = 'reselect-original';
  await page.getByRole('button', { name: '传输记录', exact: true }).click();
  await center.getByRole('button', { name: new RegExp(paused.id.slice(0, 8)) }).click();
  if (uploadCount() !== 1 || (await tasks(page)).find((t) => t.id === paused.id)?.status !== 'paused')
    throw new Error('Reload resumed automatically');
  await center.locator('input[type="file"]').setInputFiles({
    name: 'wrong.zip',
    mimeType: 'application/zip',
    buffer: Buffer.from('not-the-original')
  });
  await expect(page.getByText(/GALLERY_TASK_ARCHIVE_CHANGED/).last()).toBeVisible();
  if (uploadCount() !== 1) throw new Error('Wrong archive caused a write');
  await center.locator('input[type="file"]').setInputFiles(resolve(directory, 'gallery-export.zip'));
  await expect(page.getByText('原 ZIP 已核对一致，请点击继续。', { exact: true }).last()).toBeVisible();
  stage = 'manual-resume';
  await center.getByRole('button', { name: '继续 / 重试明确失败项', exact: true }).click();
  await page
    .getByRole('dialog', { name: '确认任务操作', exact: true })
    .getByRole('button', { name: '确认', exact: true })
    .click();
  await expect
    .poll(async () => (await tasks(page)).find((t) => t.id === paused.id)?.status, { timeout: 90_000 })
    .toBe('completed');
  if (new Set(uploads).size !== 2) throw new Error('Expected exactly two real uploads');
  await atomicWriteJson(resolve(directory, 'zip-recovery-report.json'), {
    status: 'passed',
    capturedAtUtc: new Date().toISOString(),
    stages: [
      'pause-after-first-upload',
      'reload-no-autoresume',
      'wrong-archive-rejected',
      'original-archive-confirmed',
      'resume-pending-only'
    ],
    uploadRequestIds: uploads,
    tasks: (await tasks(page)).map(galleryTaskReport),
    productMutations: 0
  });
  console.log('Real Web ZIP import/reselection/manual recovery passed; first upload was not repeated.');
} catch (error) {
  release();
  await atomicWriteJson(resolve(directory, 'zip-recovery-report.json'), {
    status: 'incomplete',
    stage,
    reason: error instanceof Error ? error.message.slice(0, 400) : 'unknown',
    uploadRequestIds: uploads,
    tasks: (await tasks(page).catch(() => [])).map(galleryTaskReport)
  });
  console.error(`ZIP recovery stopped at ${stage}; inspect receipts, no automatic retry.`);
  process.exitCode = 1;
} finally {
  release();
  await context.close();
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
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
