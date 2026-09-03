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
    startAuthorization: string;
    acquisitionHeading: string;
    closeAcquisition: string;
    capabilitiesLink: string;
    capabilitiesHeading: string;
    settingsLink: string;
    settingsHeading: string;
  };
}

const screenshotLocales: readonly StoreScreenshotLocale[] = [
  {
    browserLocale: 'zh-CN',
    alibabaLanguage: 'zh_CN',
    directoryName: 'zh-CN',
    labels: {
      onboardingHeading: '四步连接 Alibaba 开放平台',
      startAuthorization: '开始授权向导',
      acquisitionHeading: '获取开放平台凭证',
      closeAcquisition: '关闭',
      capabilitiesLink: 'API 能力',
      capabilitiesHeading: 'API 能力目录',
      settingsLink: '设置',
      settingsHeading: '开放平台凭证保护'
    }
  },
  {
    browserLocale: 'en-US',
    alibabaLanguage: 'en_US',
    directoryName: 'en-US',
    labels: {
      onboardingHeading: 'Connect Alibaba Open Platform in four steps',
      startAuthorization: 'Start authorization assistant',
      acquisitionHeading: 'Get Open Platform credentials',
      closeAcquisition: 'Close',
      capabilitiesLink: 'API capabilities',
      capabilitiesHeading: 'API capabilities',
      settingsLink: 'Settings',
      settingsHeading: 'Open Platform credential protection'
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
await copyFile(
  resolve(screenshotsDirectory, 'zh-CN/01-onboarding.png'),
  resolve(screenshotsDirectory, '01-onboarding.png')
);

process.stdout.write(
  'Captured 8 extension screenshots (4 zh-CN and 4 en-US) at 1280x800, refreshed the primary onboarding screenshot, and copied the 128px store icon.\n'
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
    await page.getByRole('button', { name: screenshotLocale.labels.startAuthorization, exact: true }).click();
    const acquisitionDialog = page.getByRole('dialog', {
      name: screenshotLocale.labels.acquisitionHeading,
      exact: true
    });
    await acquisitionDialog.waitFor();
    await settlePointer(page);
    await assertNoInternalReleaseText(page.locator('body').innerText());
    await page.screenshot({
      path: resolve(localeScreenshotsDirectory, '02-authorization-guide.png')
    });
    await acquisitionDialog
      .getByRole('button', { name: screenshotLocale.labels.closeAcquisition, exact: true })
      .click();
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
      path: resolve(localeScreenshotsDirectory, '03-capability-catalog.png')
    });

    await page.getByRole('link', { name: screenshotLocale.labels.settingsLink, exact: true }).click();
    const settingsHeading = page.getByRole('heading', {
      name: screenshotLocale.labels.settingsHeading,
      exact: true
    });
    await settingsHeading.waitFor();
    await page.evaluate(() => {
      window.scrollTo(0, 0);
    });
    await settlePointer(page);
    await assertNoInternalReleaseText(page.locator('body').innerText());
    await page.screenshot({
      path: resolve(localeScreenshotsDirectory, '04-credential-settings.png')
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
