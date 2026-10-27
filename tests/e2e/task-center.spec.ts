import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { settings as settingsZh } from '../../packages/ui/src/i18n/messages/zh-CN/settings';
import {
  prepareExtensionVault,
  openExtensionCredentialEditor,
  closeExtensionCredentialConfiguration
} from './helpers/extension-credentials';
import { chromium, expect, test, type Page } from '@playwright/test';
import galleryFixture from '../../mock/data/gallery-transfer-task.json' with { type: 'json' };
import associationFixture from '../../mock/data/video/association-core.json' with { type: 'json' };
import type { GalleryTransferContext } from '../../packages/core/src/gallery-transfer-task';

/** Test-only seed: use each runtime's actual current context. Never add test hooks to production. */
async function seedReceipts(page: Page, layout = false) {
  await page.evaluate(
    async ({ gallery, association, layout }) => {
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
      const tasks = layout
        ? [
            {
              ...task,
              id: 'layout-confirmed',
              status: 'completed',
              items: task.items.map((item) => ({ ...item, status: 'confirmed', fileId: 'layout-asset' }))
            },
            {
              ...task,
              id: 'layout-submitted',
              items: task.items.map((item) => ({ ...item, status: 'unconfirmed' }))
            },
            { ...task, id: 'layout-attention' }
          ]
        : [task];
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
          tasks.forEach((item) => tx.objectStore('tasks').put(item));
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
    { gallery: galleryFixture, association: associationFixture, layout }
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

test('web task status labels stay complete on one line across languages and narrow tables', async ({
  page
}) => {
  await page.route(/^https:\/\//u, (route) => route.abort());
  await page.goto('/#/dashboard');
  await page.getByRole('link', { name: '\u4efb\u52a1\u4e2d\u5fc3', exact: true }).waitFor();
  await seedReceipts(page, true);
  await page.getByRole('link', { name: '\u4efb\u52a1\u4e2d\u5fc3', exact: true }).click();
  const center = page.getByTestId('unified-task-center');
  const locales = [
    [
      '\u5df2\u786e\u8ba4',
      '\u5df2\u63d0\u4ea4 / \u5f85\u6838\u5bf9',
      '\u9700\u5904\u7406 / \u7ed3\u679c\u4e0d\u660e'
    ],
    ['Confirmed', 'Submitted / awaiting verification', 'Needs attention / unknown']
  ];
  for (const [index, labels] of locales.entries()) {
    if (index > 0)
      await page
        .getByRole('button', { name: /Switch.*English|\u5207\u6362.*\u82f1\u6587|English/ })
        .first()
        .click();
    for (const width of [390, 768, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      for (const [rowIndex, id] of ['confirmed', 'submitted', 'attention'].entries()) {
        const label = labels[rowIndex];
        if (!label) throw new Error('Missing layout label');
        const row = center.locator('tbody tr').filter({ hasText: `layout-${id}` });
        const badge = row.getByText(label, { exact: true });
        await expect(badge).toBeVisible();
        const geometry = await badge.evaluate((element) => {
          const range = document.createRange();
          range.selectNodeContents(element);
          const text = range.getBoundingClientRect();
          const box = element.getBoundingClientRect();
          const cell = element.closest('td')?.getBoundingClientRect();
          const style = getComputedStyle(element);
          return {
            textHeight: text.height,
            textWidth: text.width,
            lineHeight: Number.parseFloat(style.lineHeight),
            contentWidth:
              element.clientWidth -
              Number.parseFloat(style.paddingLeft) -
              Number.parseFloat(style.paddingRight),
            fitsCell: !!cell && box.left >= cell.left - 1 && box.right <= cell.right + 1,
            uncut: element.scrollWidth <= element.clientWidth + 1
          };
        });
        expect(geometry.textHeight, `${label} at ${width}px wraps`).toBeLessThanOrEqual(
          geometry.lineHeight + 1
        );
        expect(geometry.textWidth, `${label} at ${width}px is clipped`).toBeLessThanOrEqual(
          geometry.contentWidth + 1
        );
        expect(geometry.fitsCell, `${label} at ${width}px overlaps another cell`).toBe(true);
        expect(geometry.uncut).toBe(true);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      if (width === 390) {
        const scroll = await center.locator('table').evaluate((table) => ({
          content: table.parentElement?.scrollWidth ?? 0,
          viewport: table.parentElement?.clientWidth ?? 0
        }));
        expect(scroll.content).toBeGreaterThan(scroll.viewport);
      }
    }
  }
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
    await prepareExtensionVault(page);
    await openExtensionCredentialEditor(page);
    await page.getByLabel('App Key').fill('e2e-app-key');
    await page.getByLabel('App Secret').fill('e2e-secret');
    await page.getByLabel('Access Token').fill('e2e-token');
    await page.getByRole('button', { name: '保存设置', exact: true }).click();
    await expect(page.getByText(settingsZh.credentials.encryptedSavedFeedback)).toBeVisible();
    await closeExtensionCredentialConfiguration(page);
    await seedReceipts(page);
    const baseline = externalRequests.length;
    await checkCenter(page);
    expect(externalRequests.slice(baseline)).toEqual([]);
  } finally {
    await context.close();
  }
});
