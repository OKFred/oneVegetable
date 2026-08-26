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
  await page.waitForFunction(() => document.querySelector('.ov-modal-enter-active') === null);
  await assertNoInternalReleaseText(page.locator('body').innerText());
  await page.screenshot({ path: resolve(screenshotsDirectory, '01-onboarding.png') });

  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: '开始使用' }).click();
  await page.getByRole('heading', { name: '运营总览' }).waitFor();

  await page.getByRole('link', { name: 'API 能力' }).click();
  await page.getByRole('heading', { name: 'API 能力目录' }).waitFor();
  await assertNoInternalReleaseText(page.locator('body').innerText());
  await page.screenshot({ path: resolve(screenshotsDirectory, '02-capability-catalog.png') });

  await page.getByRole('link', { name: '设置' }).click();
  await page.getByRole('heading', { name: '本地数据与隐私' }).scrollIntoViewIfNeeded();
  await page.getByRole('button', { name: '清空诊断' }).click();
  await page.getByText('诊断记录已清空。').waitFor();
  await page.getByRole('button', { name: '刷新清单' }).click();
  await page.getByLabel('诊断记录数量').filter({ hasText: '0 条' }).waitFor();
  await assertNoInternalReleaseText(page.locator('body').innerText());
  await page.screenshot({ path: resolve(screenshotsDirectory, '03-local-data-control.png') });
} finally {
  await context.close();
  await rm(userDataDirectory, { recursive: true, force: true });
}

process.stdout.write('Captured 3 extension screenshots at 1280x800 and copied the 128px store icon.\n');

async function assertNoInternalReleaseText(textPromise: Promise<string>): Promise<void> {
  const text = await textPromise;
  if (/\bmock\b|测试账号|test account|smoke test|真实账号验收/iu.test(text)) {
    throw new Error('Store screenshot page contains internal test or demonstration terminology.');
  }
}
