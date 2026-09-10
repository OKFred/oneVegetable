import { chromium, expect } from '@playwright/test';
import { resolve } from 'node:path';
import { validateGalleryTransferTask } from '../packages/core/src/gallery-transfer-task';
import { atomicWriteJson } from './openapi-auth/storage';

// Read-only investigation of a successful upload whose target group did not verify.
if (process.env.ONE_VEGETABLE_GALLERY_REAL_SMOKE !== '1') throw new Error('Explicit opt-in required.');
const directory = resolve('artifacts/gallery-transfer-2.6/oss');
const context = await chromium.launchPersistentContext(resolve(directory, 'profile'), {
  headless: true,
  locale: 'zh-CN'
});
const page = context.pages()[0] ?? (await context.newPage());
const reads: { operation: string; requestId: string }[] = [];
try {
  await page.goto('http://localhost:4286/#/photos');
  await expect(page.getByRole('heading', { name: '图库', exact: true })).toBeVisible({ timeout: 30_000 });
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
          read.onsuccess = () => {
            db.close();
            resolve(read.result as unknown[]);
          };
          read.onerror = () => {
            db.close();
            reject(new Error('read'));
          };
        };
      })
  );
  const task = raw.map(validateGalleryTransferTask).find((t) => t.status === 'attention');
  const item = task?.items.find((i) => i.status === 'unconfirmed' && i.fileId);
  if (!task || !item) throw new Error('Expected unconfirmed receipt not found.');
  async function read(operation: 'listPhotos' | 'listPhotoGroups', payload: Record<string, unknown>) {
    const requestId = crypto.randomUUID();
    reads.push({ operation, requestId });
    const response = await page.request.post('http://localhost:8886/api/v1/operations/call', {
      data: { requestId, operation, payload },
      headers: { Origin: 'http://localhost:4286' }
    });
    const body: unknown = await response.json();
    if (!record(body) || body.ok !== true) throw new Error('Read-only lookup rejected');
    return body.data;
  }
  const groups = await read('listPhotoGroups', {});
  const local = Array.isArray(groups)
    ? (groups.find((g: unknown) => record(g) && g.name === 'ov-260-local-20260910') as unknown)
    : null;
  if (!record(local) || typeof local.id !== 'string') throw new Error('Original isolated group unavailable');
  const target = await read('listPhotos', { groupId: item.targetGroupId, page: 1, pageSize: 100 });
  const original = await read('listPhotos', { groupId: local.id, page: 1, pageSize: 100 });
  const matches = (value: unknown) =>
    record(value) &&
    Array.isArray(value.items) &&
    value.items.some((p: unknown) => record(p) && p.id === item.fileId);
  await atomicWriteJson(resolve(directory, 'unconfirmed-readback.json'), {
    capturedAtUtc: new Date().toISOString(),
    taskId: task.id,
    fileId: item.fileId,
    foundInTargetGroup: matches(target),
    foundInOriginalLocalTestGroup: matches(original),
    reads,
    taskStatus: task.status,
    secondAssetStatus: task.items.filter((i) => i.kind === 'asset')[1]?.status,
    mutationRequests: 0,
    note: 'No retry, movement or deletion was performed.'
  });
  console.log(
    `Read-only check: target group match=${matches(target)}, original group match=${matches(original)}; no writes.`
  );
} finally {
  await context.close();
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
