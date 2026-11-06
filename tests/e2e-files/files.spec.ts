import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import fixture from '../../mock/data/s3-files-e2e.json' with { type: 'json' };
import { completeOnboarding, ONBOARDING_STORAGE_KEY } from '../../packages/core/src/privacy';
import type { APIRequestContext, Page } from '@playwright/test';

const server = 'http://127.0.0.1:4184';
interface Stats {
  requests: { method: string; key: string; continuation: string | null; conditional: boolean }[];
  objects: { key: string; size: number; sha256: string }[];
}
async function stats(http: APIRequestContext): Promise<Stats> {
  const response = await http.get(server + '/__files_test/stats');
  expect(response.ok()).toBe(true);
  return (await response.json()) as Stats;
}
async function openFiles(
  page: Page,
  locale: 'en-US' | 'zh-CN' = 'en-US',
  theme: 'light' | 'dark' = 'dark'
): Promise<void> {
  const http = page.context().request;
  expect((await http.post(server + '/__files_test/reset')).ok()).toBe(true);
  expect(
    (
      await http.post(server + '/api/v1/auth/login', {
        data: {
          requestId: crypto.randomUUID(),
          username: fixture.auth.username,
          password: fixture.auth.password
        }
      })
    ).ok()
  ).toBe(true);
  await page.addInitScript(
    ({ locale, key, onboarding, theme }) => {
      localStorage.setItem(key, JSON.stringify(onboarding));
      localStorage.setItem(
        'one-vegetable:preferences:v2',
        JSON.stringify({
          version: 2,
          uiLocale: locale,
          alibabaLanguage: 'zh_CN',
          theme
        })
      );
    },
    { locale, key: ONBOARDING_STORAGE_KEY, onboarding: completeOnboarding(), theme }
  );
  page.on('pageerror', (error) => {
    throw error;
  });
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    expect(url.pathname).not.toBe('/api/v1/operations/call');
    if (url.protocol === 'blob:' || (url.hostname === '127.0.0.1' && ['4183', '4184'].includes(url.port)))
      await route.continue();
    else {
      await route.abort('blockedbyclient');
      throw new Error('Unexpected external browser request: ' + url.origin);
    }
  });
  await page.goto('/#/settings');
  const themeToggle = page.getByTestId('theme-toggle');
  await expect(themeToggle).toBeVisible();
  const shellStyle = await themeToggle.evaluate((button) => {
    const style = getComputedStyle(button);
    return {
      height: style.height,
      width: style.width,
      font: style.font,
      padding: style.padding,
      radius: style.borderRadius,
      color: style.color,
      background: style.backgroundColor
    };
  });
  await page.evaluate(() => {
    location.hash = '/files';
  });
  await expect(page.getByTestId('files-view')).toBeVisible();
  const tabs = page.getByTestId('assets-tabs');
  await expect(tabs.getByRole('link')).toHaveText(
    locale === 'en-US' ? ['Images', 'Videos', 'Files'] : ['图片', '视频', '文件']
  );
  await expect(tabs.locator('a[href="#/files"]')).toHaveAttribute('aria-current', 'page');
  const navigation = page.locator('aside nav');
  await expect(navigation.locator('a[href="#/files"]')).toHaveCount(0);
  await expect(navigation.locator('a[href="#/photos"]')).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.vuefinder')).toBeVisible();
  expect(
    await themeToggle.evaluate((button) => {
      const style = getComputedStyle(button);
      return {
        height: style.height,
        width: style.width,
        font: style.font,
        padding: style.padding,
        radius: style.borderRadius,
        color: style.color,
        background: style.backgroundColor
      };
    })
  ).toEqual(shellStyle);
  await expect(
    page.getByRole('button', { name: locale === 'en-US' ? 'Folder: docs' : '目录: docs', exact: true })
  ).toBeVisible();
  await expect(page.getByTestId('files-pagination')).toContainText(locale === 'en-US' ? 'Page 1' : '第 1');
}
function putRequests(state: Stats) {
  return state.requests.filter((request) => request.method === 'PUT');
}

test('real VueFinder browses private directories, opaque pages and filters only the loaded page', async ({
  page
}, testInfo) => {
  await openFiles(page, 'en-US', 'light');
  const http = page.context().request;
  await page.screenshot({ path: testInfo.outputPath('files-en-light-desktop.png'), fullPage: true });
  await page.getByRole('button', { name: 'List', exact: true }).click();
  await expect(page.locator('.vuefinder__explorer__item-list-content')).toHaveCount(4);
  await expect(page.locator('.vuefinder__explorer__item-grid-content')).toHaveCount(0);
  await expect(page.locator('.vuefinder')).toContainText('readme.txt');
  await page.getByRole('button', { name: 'Grid', exact: true }).click();
  await expect(page.locator('.vuefinder__explorer__item-grid-content')).toHaveCount(4);
  await page.getByRole('button', { name: 'Folder: docs', exact: true }).click();
  await expect(page.getByTestId('files-breadcrumbs')).toContainText('docs');
  await expect(page.locator('.vuefinder')).toContainText('guide.txt');
  await page.getByTestId('files-breadcrumbs').getByRole('button', { name: 'Root', exact: true }).click();
  await page.getByRole('button', { name: 'Folder: many', exact: true }).click();
  await expect(page.getByTestId('files-pagination')).toContainText('100 entries');
  const first = await stats(http);
  await page.getByTestId('files-search').fill('entry-104');
  await expect(page.locator('.vuefinder').getByText('entry-104.txt', { exact: true })).toHaveCount(0);
  expect((await stats(http)).requests).toEqual(first.requests);
  await page.getByTestId('files-search').fill('');
  await page.getByTestId('files-pagination').getByRole('button', { name: 'Next page', exact: true }).click();
  await expect(page.getByTestId('files-pagination')).toContainText('Page 2 · 5 entries');
  await expect(page.locator('.vuefinder')).toContainText('entry-104.txt');
  const second = await stats(http);
  expect(second.requests.some((request) => request.continuation !== null)).toBe(true);
  expect(putRequests(second)).toHaveLength(0);
  await page
    .getByTestId('files-pagination')
    .getByRole('button', { name: 'Previous page', exact: true })
    .click();
  await expect(page.getByTestId('files-pagination')).toContainText('Page 1 · 100 entries');
});

test('upload requires confirmation and readback; collision never overwrites; download preserves bytes', async ({
  page
}) => {
  await openFiles(page);
  const http = page.context().request;
  const input = page.getByTestId('files-input');
  await input.setInputFiles({
    name: fixture.upload.name,
    mimeType: fixture.upload.contentType,
    buffer: Buffer.from(fixture.upload.text)
  });
  const confirmation = page.getByRole('dialog', { name: 'Confirm new file', exact: true });
  await expect(confirmation).toBeVisible();
  expect(putRequests(await stats(http))).toHaveLength(0);
  await confirmation.getByRole('button', { name: 'Confirm creation', exact: true }).click();
  await expect(confirmation).toBeHidden();
  await expect(page.locator('.vuefinder')).toContainText(fixture.upload.name);
  const uploaded = await stats(http);
  expect(putRequests(uploaded)).toEqual([
    expect.objectContaining({ key: 'workspace/uploaded.txt', conditional: true })
  ]);
  expect(
    uploaded.requests.some((request) => request.method === 'GET' && request.key === 'workspace/uploaded.txt')
  ).toBe(true);
  expect(uploaded.objects.find((object) => object.key === 'workspace/uploaded.txt')?.sha256).toBe(
    createHash('sha256').update(fixture.upload.text).digest('hex')
  );
  await input.setInputFiles({
    name: fixture.upload.name,
    mimeType: 'text/plain',
    buffer: Buffer.from('Do not overwrite')
  });
  await confirmation.getByRole('button', { name: 'Confirm creation', exact: true }).click();
  await expect(confirmation).toBeHidden();
  await expect(page.getByRole('alert')).toContainText('Nothing was overwritten');
  const collision = await stats(http);
  expect(putRequests(collision)).toHaveLength(2);
  expect(collision.objects.find((object) => object.key === 'workspace/uploaded.txt')?.sha256).toBe(
    createHash('sha256').update(fixture.upload.text).digest('hex')
  );
  await page.getByTestId('files-refresh').click();
  await page.locator('.vuefinder').getByText(fixture.upload.name, { exact: true }).first().click();
  const download = page.waitForEvent('download');
  await page.getByTestId('files-download').click();
  const received = await download;
  expect(received.suggestedFilename()).toBe(fixture.upload.name);
  const path = await received.path();
  if (!path) throw new Error('Downloaded file is missing');
  expect(await readFile(path, 'utf8')).toBe(fixture.upload.text);
});

test('exactly 5 MB uploads through the real BFF, verifies stored hash and downloads identical bytes', async ({
  page
}) => {
  await openFiles(page);
  const http = page.context().request;
  const name = 'exact-5mb.bin';
  const key = fixture.configuration.rootPrefix + '/' + name;
  const bytes = Buffer.alloc(5_000_000, 0x5a);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  await page.getByTestId('files-input').setInputFiles({
    name,
    mimeType: 'application/octet-stream',
    buffer: bytes
  });
  const confirmation = page.getByRole('dialog', { name: 'Confirm new file', exact: true });
  await expect(confirmation).toBeVisible();
  expect(putRequests(await stats(http))).toHaveLength(0);
  await confirmation.getByRole('button', { name: 'Confirm creation', exact: true }).click();
  await expect(confirmation).toBeHidden();
  await expect(page.locator('.vuefinder')).toContainText(name);
  const uploaded = await stats(http);
  expect(putRequests(uploaded)).toEqual([expect.objectContaining({ key, conditional: true })]);
  expect(uploaded.objects.find((object) => object.key === key)).toEqual({
    key,
    size: bytes.length,
    sha256
  });
  expect(uploaded.requests.filter((request) => request.method === 'GET' && request.key === key)).toHaveLength(
    1
  );
  await page.locator('.vuefinder').getByText(name, { exact: true }).first().click();
  await expect(page.getByTestId('files-download')).toBeEnabled();
  await expect(page.getByTestId('files-order-attachment')).toBeEnabled();
  const download = page.waitForEvent('download');
  await page.getByTestId('files-download').click();
  const received = await download;
  expect(received.suggestedFilename()).toBe(name);
  const path = await received.path();
  if (!path) throw new Error('Downloaded boundary file is missing');
  const downloaded = await readFile(path);
  expect(downloaded.byteLength).toBe(bytes.length);
  expect(createHash('sha256').update(downloaded).digest('hex')).toBe(sha256);
  const completed = await stats(http);
  expect(putRequests(completed)).toHaveLength(1);
  expect(
    completed.requests.filter((request) => request.method === 'GET' && request.key === key)
  ).toHaveLength(2);
});

for (const locale of ['zh-CN', 'en-US'] as const) {
  test(
    locale + ': folder confirmation and escaped HTML preview work in the narrow dark layout',
    async ({ page }, testInfo) => {
      const en = locale === 'en-US';
      await page.setViewportSize({ width: 390, height: 844 });
      await openFiles(page, locale);
      const http = page.context().request;
      await page.getByTestId('files-new-folder').click();
      await page.getByTestId('files-folder-name').fill('empty');
      await page.getByTestId('files-prepare-folder').click();
      const confirmation = page.getByRole('dialog', {
        name: en ? 'Confirm new folder' : '确认新建目录',
        exact: true
      });
      await expect(confirmation).toBeVisible();
      expect(putRequests(await stats(http))).toHaveLength(0);
      await confirmation
        .getByRole('button', { name: en ? 'Confirm creation' : '确认创建', exact: true })
        .click();
      await expect(confirmation).toBeHidden();
      await expect(
        page.getByRole('button', { name: en ? 'Folder: empty' : '目录: empty', exact: true })
      ).toBeVisible();
      const created = await stats(http);
      expect(putRequests(created)).toEqual([
        expect.objectContaining({ key: 'workspace/empty/', conditional: true })
      ]);
      expect(created.objects.find((object) => object.key === 'workspace/empty/')?.size).toBe(0);
      await page
        .getByRole('button', { name: en ? 'Preview: unsafe.html' : '预览: unsafe.html', exact: true })
        .click();
      const preview = page.getByRole('dialog', { name: en ? 'Preview' : '预览', exact: true });
      const text = preview.getByTestId('files-text-preview');
      await expect(text).toHaveText(fixture.objects[1]?.text ?? '');
      await expect(text.locator('script, iframe, svg')).toHaveCount(0);
      expect(
        await page.evaluate(() => Reflect.get(globalThis, '__filesInjected') as unknown)
      ).toBeUndefined();
      await page.keyboard.press('Escape');
      await expect(preview).toBeHidden();
      await expect(page.locator('html')).toHaveClass(/dark/u);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath('files-' + locale + '-dark-390.png'),
        fullPage: true
      });
    }
  );
}

test('cancelling creation and 5 MB + 1 uploads never send an object request', async ({ page }) => {
  await openFiles(page);
  const http = page.context().request;
  await page.getByTestId('files-input').setInputFiles({
    name: 'cancelled.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('not sent')
  });
  await page
    .getByRole('dialog', { name: 'Confirm new file', exact: true })
    .getByRole('button', { name: 'Cancel', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const before = await stats(http);
  expect(putRequests(before)).toHaveLength(0);
  const objectRequests: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/api/v1/admin/storage/s3/objects/'))
      objectRequests.push(request.method() + ' ' + url.pathname);
  });
  await page.getByTestId('files-input').setInputFiles({
    name: 'oversized.bin',
    mimeType: 'application/octet-stream',
    buffer: Buffer.alloc(5_000_001)
  });
  await expect(page.getByRole('alert')).toContainText('exceeds 5 MB');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(objectRequests).toEqual([]);
  const after = await stats(http);
  expect(after.requests).toEqual(before.requests);
  expect(after.objects).toEqual(before.objects);
});
