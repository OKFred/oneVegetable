import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { chromium, expect, test, type BrowserContext } from '@playwright/test';

let context: BrowserContext;

test.beforeAll(async () => {
  const extensionPath = resolve(import.meta.dirname, '../../apps/extension/.output/chrome-mv3');
  const userDataDir = await mkdtemp(resolve(tmpdir(), 'one-vegetable-e2e-'));
  context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
  });
});

test.afterAll(async () => {
  await context.close();
});

test('MV3 options page persists settings and exposes the audited catalog', async () => {
  let serviceWorker = context.serviceWorkers()[0];
  serviceWorker ??= await context.waitForEvent('serviceworker');
  const extensionId = new URL(serviceWorker.url()).host;
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);

  await expect(page.getByRole('heading', { name: '运营总览' })).toBeVisible();
  await page.getByRole('button', { name: '设置' }).click();
  await page.getByLabel('App Key').fill('e2e-app-key');
  await page.getByRole('button', { name: '保存设置' }).click();
  await expect(page.getByText('设置已安全写入 chrome.storage.local。')).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: '设置' }).click();
  await expect(page.getByLabel('App Key')).toHaveValue('e2e-app-key');

  await page.getByRole('button', { name: 'API 能力' }).click();
  await expect(page.locator('tbody tr')).toHaveCount(84);
});
