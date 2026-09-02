import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { chromium, type Page } from '@playwright/test';

interface StoreScreenshotLocale {
  browserLocale: 'zh-CN' | 'en-US';
  alibabaLanguage: 'zh_CN' | 'en_US';
  directoryName: 'zh-CN' | 'en-US';
  labels: {
    onboardingHeading: string;
    browseOnly: string;
    dashboardHeading: string;
    capabilitiesLink: string;
    capabilitiesHeading: string;
    settingsLink: string;
    localDataHeading: string;
    refreshInventory: string;
    diagnosticsCount: string;
  };
}

const screenshotLocales: readonly StoreScreenshotLocale[] = [
  {
    browserLocale: 'zh-CN',
    alibabaLanguage: 'zh_CN',
    directoryName: 'zh-CN',
    labels: {
      onboardingHeading: '先确认数据与调用边界',
      browseOnly: '稍后，仅浏览',
      dashboardHeading: '运营总览',
      capabilitiesLink: 'API 能力',
      capabilitiesHeading: 'API 能力目录',
      settingsLink: '设置',
      localDataHeading: '本地数据与隐私',
      refreshInventory: '刷新清单',
      diagnosticsCount: '诊断记录数量'
    }
  },
  {
    browserLocale: 'en-US',
    alibabaLanguage: 'en_US',
    directoryName: 'en-US',
    labels: {
      onboardingHeading: 'Confirm data and API boundaries',
      browseOnly: 'Later — browse only',
      dashboardHeading: 'Operations dashboard',
      capabilitiesLink: 'API capabilities',
      capabilitiesHeading: 'API capabilities',
      settingsLink: 'Settings',
      localDataHeading: 'Local data and privacy',
      refreshInventory: 'Refresh inventory',
      diagnosticsCount: 'Diagnostic record count'
    }
  }
];

const root = resolve(import.meta.dirname, '..');
const extensionPath = resolve(root, 'apps/extension/.output/chrome-mv3');
const assetsDirectory = resolve(root, 'store-listing/assets');
const screenshotsDirectory = resolve(assetsDirectory, 'screenshots');

await mkdir(screenshotsDirectory, { recursive: true });
await copyFile(resolve(extensionPath, 'icon.png'), resolve(assetsDirectory, 'icon-128.png'));

for (const screenshotLocale of screenshotLocales) {
  await captureLocale(screenshotLocale);
}

process.stdout.write(
  'Captured 8 extension screenshots (4 zh-CN and 4 en-US) at 1280x800 and copied the 128px store icon.\n'
);

async function captureLocale(screenshotLocale: StoreScreenshotLocale): Promise<void> {
  const localeScreenshotsDirectory = resolve(screenshotsDirectory, screenshotLocale.directoryName);
  const userDataDirectory = await mkdtemp(
    resolve(tmpdir(), `one-vegetable-store-assets-${screenshotLocale.directoryName}-`)
  );
  await rm(localeScreenshotsDirectory, { recursive: true, force: true });
  await mkdir(localeScreenshotsDirectory, { recursive: true });

  const context = await chromium.launchPersistentContext(userDataDirectory, {
    headless: false,
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    locale: screenshotLocale.browserLocale,
    colorScheme: 'light',
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
  });

  try {
    let serviceWorker = context.serviceWorkers()[0];
    serviceWorker ??= await context.waitForEvent('serviceworker');
    const extensionId = new URL(serviceWorker.url()).host;
    const page = await context.newPage();
    await page.addInitScript(
      ({ alibabaLanguage, uiLocale }) => {
        localStorage.setItem(
          'one-vegetable:preferences:v2',
          JSON.stringify({ uiLocale, alibabaLanguage, theme: 'light' })
        );
      },
      {
        uiLocale: screenshotLocale.browserLocale,
        alibabaLanguage: screenshotLocale.alibabaLanguage
      }
    );
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await page
      .getByRole('heading', { name: screenshotLocale.labels.onboardingHeading, exact: true })
      .waitFor();
    await page.waitForFunction(() => document.querySelector('.ov-modal-enter-active') === null);
    await page.evaluate(
      (zoom) => {
        document.documentElement.style.zoom = zoom;
      },
      screenshotLocale.browserLocale === 'en-US' ? '0.8' : '0.92'
    );
    await settlePointer(page);
    await assertNoInternalReleaseText(page.locator('body').innerText());
    await page.screenshot({ path: resolve(localeScreenshotsDirectory, '01-onboarding.png') });

    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: screenshotLocale.labels.browseOnly, exact: true }).click();
    await page
      .getByRole('heading', { name: screenshotLocale.labels.dashboardHeading, exact: true })
      .waitFor();
    await page.evaluate(() => {
      document.documentElement.style.zoom = '';
    });
    await page.getByRole('link', { name: screenshotLocale.labels.capabilitiesLink, exact: true }).click();
    await page
      .getByRole('heading', { name: screenshotLocale.labels.capabilitiesHeading, exact: true })
      .waitFor();
    await settlePointer(page);
    await assertNoInternalReleaseText(page.locator('body').innerText());
    await page.screenshot({
      path: resolve(localeScreenshotsDirectory, '02-capability-catalog.png')
    });

    await page.getByRole('link', { name: screenshotLocale.labels.settingsLink, exact: true }).click();
    const localDataHeading = page.getByRole('heading', {
      name: screenshotLocale.labels.localDataHeading,
      exact: true
    });
    await localDataHeading.waitFor();
    await page.evaluate(() => {
      window.scrollTo(0, 0);
    });
    await settlePointer(page);
    await assertNoInternalReleaseText(page.locator('body').innerText());
    await page.screenshot({
      path: resolve(localeScreenshotsDirectory, '03-credential-settings.png')
    });

    await localDataHeading.evaluate((element) => {
      element.scrollIntoView({ block: 'start' });
    });
    await page.evaluate(() => {
      window.scrollBy(0, -96);
    });
    await page.getByRole('button', { name: screenshotLocale.labels.refreshInventory, exact: true }).click();
    await page.getByLabel(screenshotLocale.labels.diagnosticsCount, { exact: true }).waitFor();
    await settlePointer(page);
    await assertNoInternalReleaseText(page.locator('body').innerText());
    await page.screenshot({
      path: resolve(localeScreenshotsDirectory, '04-local-data-control.png')
    });
  } finally {
    await context.close();
    await rm(userDataDirectory, { recursive: true, force: true });
  }
}

async function assertNoInternalReleaseText(textPromise: Promise<string>): Promise<void> {
  const text = await textPromise;
  if (/\bmock\b|测试账号|test account|smoke test|真实账号验收/iu.test(text)) {
    throw new Error('Store screenshot page contains internal test or demonstration terminology.');
  }
}

async function settlePointer(page: Page): Promise<void> {
  await page.mouse.move(640, 16);
  await page.waitForTimeout(250);
}
