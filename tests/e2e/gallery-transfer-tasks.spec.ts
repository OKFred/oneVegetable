import { expect, test, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { zipSync } from 'fflate';
import photoFixture from '../../mock/data/photos.json' with { type: 'json' };
import fixture from '../../mock/data/gallery-task-assets.json' with { type: 'json' };
import taskFixture from '../../mock/data/gallery-transfer-task.json' with { type: 'json' };

const databaseName = 'one-vegetable-gallery-transfers-v1';
test('ZIP import stays in the task center across navigation; reload requires manual recovery', async ({
  page
}) => {
  const bytes = Buffer.from(fixture.base64, 'base64');
  const path = `assets/${fixture.fileName}`;
  const buffer = zipSync({
    'gallery.json': Buffer.from(
      JSON.stringify({
        schemaVersion: 1,
        kind: 'one-vegetable-gallery-transfer',
        createdTimeUtc: taskFixture.createTimeUtc,
        assets: [
          {
            path,
            fileName: fixture.fileName,
            sourcePhotoId: 'test',
            groupPath: 'Test',
            contentType: fixture.contentType,
            byteLength: bytes.length,
            sha256: createHash('sha256').update(bytes).digest('hex'),
            width: null,
            height: null,
            modifiedTimeUtc: null
          }
        ]
      })
    ),
    [path]: bytes
  });
  await page.goto('/#/photos');
  await page.getByRole('button', { name: '导入', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '导入图库素材', exact: true });
  await dialog
    .locator('input[type="file"]')
    .setInputFiles({ name: 'task.zip', mimeType: 'application/zip', buffer: Buffer.from(buffer) });
  await dialog.getByRole('button', { name: '导入', exact: true }).click();
  const confirm = page.getByRole('dialog', { name: '确认导入图库', exact: true });
  await expect(confirm).toBeVisible();
  expect(await countTasks(page)).toBe(0);
  await confirm.getByRole('button', { name: '导入', exact: true }).click();
  const center = page.getByRole('dialog', { name: '传输记录', exact: true });
  await expect(center.getByRole('button', { name: /已完成/ })).toBeVisible();
  await center.getByRole('button', { name: '关闭详情' }).click();
  await page.getByRole('link', { name: '商品', exact: true }).click();
  expect(await countTasks(page)).toBe(1);
  await page.getByRole('link', { name: '图库', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: '传输记录', exact: true }).click();
  await expect(center.getByRole('button', { name: /已完成/ })).toBeVisible();
});

test('interrupted writes remain unknown; a live tab lock prevents recovery and other tabs never auto-start', async ({
  context,
  page
}) => {
  await page.goto('/#/photos');
  await page.evaluate(
    async ({ name, fixture, identity }) => {
      await new Promise<void>((resolve, reject) => {
        const open = indexedDB.open(name, 1);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction('tasks', 'readwrite');
          tx.objectStore('tasks').put({
            ...fixture,
            createTimeUtc: Date.now(),
            updateTimeUtc: Date.now(),
            context: identity,
            status: 'running',
            items: fixture.items.map((item) => ({ ...item, status: 'running' }))
          });
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => {
            db.close();
            reject(new Error('write'));
          };
        };
        open.onerror = () => {
          reject(new Error('open'));
        };
      });
      // A test-owned lock simulates another still-active executor, without a fake network write.
      void navigator.locks.request('one-vegetable.gallery-transfer.executor.v1', async () => {
        await new Promise<void>((resolve) => {
          window.addEventListener(
            'release-gallery-test-lock',
            () => {
              resolve();
            },
            { once: true }
          );
        });
      });
    },
    { name: databaseName, fixture: taskFixture, identity: photoFixture.transferContext }
  );
  const second = await context.newPage();
  await second.goto('/#/photos');
  await second.getByRole('button', { name: '传输记录', exact: true }).click();
  const center = second.getByRole('dialog', { name: '传输记录', exact: true });
  await expect(center.getByRole('button', { name: /执行中/ })).toBeVisible();
  await page.close(); // releases the lock; the observer still does not auto-take over
  await center.getByRole('button', { name: '刷新', exact: true }).click();
  await expect(center.getByRole('button', { name: /已暂停/ })).toBeVisible();
  await center.getByRole('button', { name: /task-tes/ }).click();
  await expect(center.getByText('结果不明', { exact: true })).toBeVisible();
  await expect(center.getByRole('button', { name: '核对结果', exact: true })).toBeVisible();
  await center.getByRole('button', { name: '关闭详情' }).click();
  await second.getByTestId('language-toggle').click();
  await second.getByRole('button', { name: 'Transfer history', exact: true }).click();
  const englishCenter = second.getByRole('dialog', { name: 'Transfer history', exact: true });
  await englishCenter.getByRole('button', { name: /task-tes/ }).click();
  await expect(englishCenter.getByText('Unknown outcome', { exact: true })).toBeVisible();
});
async function countTasks(page: Page): Promise<number> {
  return page.evaluate(async (name) => {
    if (!(await indexedDB.databases()).some((db) => db.name === name)) return 0;
    return new Promise<number>((resolve, reject) => {
      const open = indexedDB.open(name);
      open.onsuccess = () => {
        const db = open.result;
        const request = db.transaction('tasks').objectStore('tasks').count();
        request.onsuccess = () => {
          db.close();
          resolve(request.result);
        };
        request.onerror = () => {
          db.close();
          reject(new Error('count'));
        };
      };
    });
  }, databaseName);
}
