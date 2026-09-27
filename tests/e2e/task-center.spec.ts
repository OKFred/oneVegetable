import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { chromium, expect, test, type Page } from '@playwright/test';
import galleryFixture from '../../mock/data/gallery-transfer-task.json' with { type: 'json' };
import associationFixture from '../../mock/data/video/association-core.json' with { type: 'json' };
import type { GalleryTransferContext } from '../../packages/core/src/gallery-transfer-task';

/** Test-only seed: use each runtime's actual current context. Never add test hooks to production. */
async function seedReceipts(page: Page) {
  await page.evaluate(
    async ({ gallery, association }) => {
      const object = (value: unknown): Record<PropertyKey, unknown> => {
        if (!value || typeof value !== 'object') throw new Error('Missing test host');
        return value as Record<PropertyKey, unknown>;
      };
      const extension = location.protocol === 'chrome-extension:';
      let mode: string;
      let context: GalleryTransferContext;
      if (extension) {
        const runtime = (
          globalThis as unknown as {
            chrome: { runtime: { sendMessage(message: unknown): Promise<unknown> } };
          }
        ).chrome.runtime;
        const requestId = crypto.randomUUID();
        const result = object(await runtime.sendMessage({ kind: 'gallery-transfer-context', requestId }));
        if (result.ok !== true || result.requestId !== requestId)
          throw new Error('Fixture context unavailable');
        const data = object(result.data);
        if (
          typeof data.identity !== 'string' ||
          typeof data.gateway !== 'string' ||
          (data.storage !== null && typeof data.storage !== 'string')
        )
          throw new Error('Invalid fixture context');
        context = { identity: data.identity, gateway: data.gateway, storage: data.storage };
        mode = 'extension';
      } else {
        const root = document.querySelector('#app');
        const app = object(root && Reflect.get(root, '__vue_app__'));
        const provides = object(object(app._instance).provides);
        const key = Reflect.ownKeys(provides).find(
          (value) => typeof value === 'symbol' && value.description === 'one-vegetable-services'
        );
        if (!key) throw new Error('Missing services');
        const services = object(provides[key]);
        const gateway = object(services.gateway);
        context = await (gateway.galleryTransferContext as () => Promise<GalleryTransferContext>)();
        mode = String(services.mode);
      }
      const task = {
        ...gallery,
        context,
        status: 'attention',
        createTimeUtc: Date.now(),
        updateTimeUtc: Date.now(),
        items: gallery.items.map((item) => ({ ...item, status: 'unknown' }))
      };
      await new Promise<void>((done, fail) => {
        const request = indexedDB.open('one-vegetable-gallery-transfers-v1', 1);
        request.onupgradeneeded = () => {
          request.result.createObjectStore('tasks', { keyPath: 'id' });
          request.result.createObjectStore('quarantine', { keyPath: 'id' });
        };
        request.onerror = () => {
          fail(new Error('Fixture database'));
        };
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction('tasks', 'readwrite');
          tx.objectStore('tasks').put(task);
          tx.oncomplete = () => {
            db.close();
            done();
          };
          tx.onerror = () => {
            db.close();
            fail(new Error('Fixture transaction'));
          };
        };
      });
      const { confirmed: _confirmed, ...request } = association.request;
      const receiptKey =
        'one-vegetable:video-association:v1:' +
        JSON.stringify([mode, JSON.stringify([context.identity, context.gateway]), request.productId]);
      localStorage.setItem(
        receiptKey,
        JSON.stringify({
          version: 1,
          requestId: crypto.randomUUID(),
          request,
          state: 'unknown',
          outcome: 'unknown',
          updatedAt: Date.now(),
          traceId: null,
          code: null
        })
      );
    },
    { gallery: galleryFixture, association: associationFixture }
  );
}

async function checkCenter(page: Page) {
  await page.getByRole('link', { name: '任务中心', exact: true }).click();
  const center = page.getByTestId('unified-task-center');
  await expect(center.getByText('需要处理 2', { exact: true })).toBeVisible();
  await center.getByRole('button', { name: `gallery:${galleryFixture.id}的操作`, exact: true }).click();
  await page.getByRole('button', { name: '查看详情', exact: true }).click();
  const detail = page.getByRole('dialog', { name: '查看详情', exact: true });
  await expect(detail).toContainText('不要重复上传或提交');
  await expect(detail).toContainText('结果不明');
  await page.screenshot({ path: test.info().outputPath('task-center.png') });
  await detail.getByRole('button', { name: '打开原任务', exact: true }).click();
  const original = page.getByRole('dialog', { name: '传输记录', exact: true });
  // The existing gallery dialog owns every verify/resume confirmation.
  await expect(original).toBeVisible();
  await expect(original).toContainText(galleryFixture.id.slice(0, 8));
  await page.keyboard.press('Escape');
  await page
    .getByRole('button', { name: /Switch.*English|切换.*英文|English/ })
    .first()
    .click();
  await page.evaluate(() => {
    document.documentElement.classList.add('dark');
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(center.getByRole('heading', { name: 'Task center', exact: true })).toBeVisible();
  await center.getByRole('button', { name: 'Filters', exact: true }).click();
  const filter = page.getByRole('dialog');
  await filter.getByLabel('Business area', { exact: true }).selectOption('video-association');
  await filter.getByRole('button', { name: 'Apply filters', exact: true }).click();
  await expect(filter).toBeHidden();
  await expect(center.locator('tbody tr')).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('task-center-en-dark.png') });
  const saved = await page.evaluate(() =>
    Object.keys(localStorage)
      .filter((key) => key.startsWith('one-vegetable:video-association:v1:'))
      .map((key) => JSON.parse(localStorage.getItem(key) ?? '{}') as { state: string })
  );
  expect(saved.map((value) => value.state)).toEqual(['unknown']);
}

test('web task center aggregates existing receipts without replaying work', async ({ page }) => {
  await page.route(/^https:\/\//u, (route) => route.abort());
  await page.goto('/#/dashboard');
  await page.getByRole('link', { name: '任务中心', exact: true }).waitFor();
  await seedReceipts(page);
  await checkCenter(page);
});

test('formal MV3 task center keeps uncertain receipts and reuses the original task dialog', async () => {
  test.setTimeout(90_000);
  const extensionPath = resolve('apps/extension/.output/chrome-mv3');
  const profile = await mkdtemp(resolve(tmpdir(), 'onevegetable-task-center-'));
  const context = await chromium.launchPersistentContext(profile, {
    headless: false,
    locale: 'zh-CN',
    reducedMotion: 'reduce',
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
  });
  const externalRequests: string[] = [];
  await context.route(/^https?:\/\//u, (route) => {
    externalRequests.push(route.request().url());
    return route.abort();
  });
  try {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    const page = await context.newPage();
    await page.goto(`chrome-extension://${new URL(worker.url()).host}/options.html#/settings`);
    const guide = page.getByRole('dialog', { name: '四步连接 Alibaba 开放平台' });
    await guide.getByRole('checkbox').check();
    await guide.getByRole('button', { name: '稍后，仅浏览' }).click();
    await page.getByLabel('App Key').fill('e2e-app-key');
    await page.getByLabel('App Secret').fill('e2e-secret');
    await page.getByLabel('Access Token').fill('e2e-token');
    await page.getByLabel('设置保护口令').fill('e2e-vault-password');
    await page.getByLabel('确认保护口令').fill('e2e-vault-password');
    await page.getByRole('button', { name: '保存设置', exact: true }).click();
    await expect(page.getByText('凭证与设置已加密保存，并将在当前 Chrome 会话内保持可用。')).toBeVisible();
    await seedReceipts(page);
    const baseline = externalRequests.length;
    await checkCenter(page);
    expect(externalRequests.slice(baseline)).toEqual([]);
  } finally {
    await context.close();
  }
});
