import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { chromium } from '@playwright/test';

const root = resolve(import.meta.dirname, '..');
const extensionPath = resolve(root, 'apps/extension/.output/chrome-mv3');
const assetsDirectory = resolve(root, 'store-listing/assets');
const screenshotsDirectory = resolve(assetsDirectory, 'screenshots');
const userDataDirectory = await mkdtemp(resolve(tmpdir(), 'one-vegetable-store-assets-'));

await mkdir(screenshotsDirectory, { recursive: true });
await copyFile(resolve(extensionPath, 'icon.png'), resolve(assetsDirectory, 'icon-128.png'));

const context = await chromium.launchPersistentContext(userDataDirectory, {
  headless: false,
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 1,
  args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
});

try {
  let serviceWorker = context.serviceWorkers()[0];
  serviceWorker ??= await context.waitForEvent('serviceworker');
  const extensionId = new URL(serviceWorker.url()).host;
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await page.getByRole('heading', { name: '先确认数据与调用边界' }).waitFor();
  await page.screenshot({ path: resolve(screenshotsDirectory, '01-onboarding.png') });

  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: '开始使用' }).click();
  await page.getByRole('heading', { name: '运营总览' }).waitFor();

  await page.getByRole('button', { name: 'API 能力' }).click();
  await page.getByRole('heading', { name: 'API 能力目录' }).waitFor();
  await page.screenshot({ path: resolve(screenshotsDirectory, '02-capability-catalog.png') });

  await page.getByRole('button', { name: '设置' }).click();
  await page.getByRole('heading', { name: '本地数据与隐私' }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: resolve(screenshotsDirectory, '03-local-data-control.png') });
} finally {
  await context.close();
  await rm(userDataDirectory, { recursive: true, force: true });
}

process.stdout.write('Captured 3 extension screenshots at 1280x800 and copied the 128px store icon.\n');
