import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { chromium, expect, test } from '@playwright/test';
import credentials from '../../mock/data/node-gateway-credentials.json' with { type: 'json' };
import iop from '../../mock/data/alibaba-auth/iop-business-responses.json' with { type: 'json' };
import rejected from '../../mock/data/video/iop-rejections.json' with { type: 'json' };
import top from '../../mock/data/video/top.json' with { type: 'json' };
import { importExtensionAuthorization } from './helpers/extension-credentials';

test('formal MV3 media guidance stops unverified imports and uses TOP before dispatch when added', async () => {
  test.setTimeout(120_000);
  const extension = resolve('apps/extension/.output/chrome-mv3');
  const profile = await mkdtemp(resolve(tmpdir(), 'one-vegetable-media-guidance-'));
  const context = await chromium.launchPersistentContext(profile, {
    headless: false,
    locale: 'zh-CN',
    reducedMotion: 'reduce',
    args: ['--disable-extensions-except=' + extension, '--load-extension=' + extension]
  });
  const calls: string[] = [];
  try {
    await context.route(/^https?:\/\//u, (route) => route.abort());
    const headers = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Request-ID'
    };
    await context.route('https://openapi-api.alibaba.com/**', async (route) => {
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
      const path = new URL(route.request().url()).pathname;
      calls.push(path);
      if (path.endsWith('/icbu/product/photobank/group/list'))
        return route.fulfill({ headers, json: iop.photoGroups });
      if (path.endsWith('/alibaba/icbu/video/query'))
        return route.fulfill({ headers, json: rejected.business });
      return route.abort();
    });
    await context.route('https://eco.taobao.com/**', async (route) => {
      const method = new URLSearchParams(route.request().postData() ?? '').get('method') ?? '';
      calls.push(method);
      if (method === 'alibaba.icbu.video.query')
        return route.fulfill({ json: { alibaba_icbu_video_query_response: top.query } });
      return route.abort();
    });
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    const origin = 'chrome-extension://' + new URL(worker.url()).host;
    const page = await context.newPage();
    await page.goto(origin + '/options.html#/settings');
    const onboarding = page.getByRole('dialog', { name: '四步连接 Alibaba 开放平台' });
    await onboarding.getByRole('checkbox').check();
    await onboarding.getByRole('button', { name: '稍后，仅浏览' }).click();
    // Only this isolated page simulates host consent; no live service is reachable.
    await page.evaluate(() => {
      const permissions = (
        globalThis as unknown as {
          chrome: {
            permissions: {
              contains(query: { origins?: string[] }): Promise<boolean>;
              request(query: { origins?: string[] }): Promise<boolean>;
            };
          };
        }
      ).chrome.permissions;
      const contains = permissions.contains.bind(permissions);
      permissions.contains = (query) =>
        query.origins?.[0] === 'https://openapi-api.alibaba.com/*' ? Promise.resolve(true) : contains(query);
      permissions.request = () => Promise.resolve(true);
    });
    await importExtensionAuthorization(page, { ...credentials.oauthBundle, protocol: 'iop' });
    await page.goto(origin + '/options.html#/photos');
    await page.getByRole('button', { name: '导入', exact: true }).click();
    await expect(page.getByTestId('media-error-guidance')).toContainText('已停止后续上传和建目录');
    await expect(page.getByTestId('gallery-transfer-prepare')).toBeDisabled();
    await expect(page.getByTestId('media-authorization-settings')).toHaveAttribute('href', '#/settings');
    expect(calls.some((path) => /upload|operate/iu.test(path))).toBe(false);
    await page.goto(origin + '/options.html#/photos/videos');
    await expect(page.getByTestId('media-error-guidance')).toContainText('不能据此认定缺少权限');
    await expect(page.getByTestId('media-official-page')).toHaveAttribute('target', '_blank');
    expect(calls.filter((path) => path.endsWith('/alibaba/icbu/video/query'))).toHaveLength(1);
    await page.getByTestId('language-toggle').click();
    await page.getByTestId('theme-toggle').click();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByTestId('media-error-guidance')).toContainText('No automatic retry');
    expect(await page.locator('body').evaluate((node) => node.scrollWidth > innerWidth)).toBe(false);
    await page.getByTestId('language-toggle').click();
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(origin + '/options.html#/settings');
    await importExtensionAuthorization(page, credentials.oauthBundle);
    await page.goto(origin + '/options.html#/photos/videos');
    await expect(page.getByRole('button', { name: '查看: Example video', exact: true })).toBeVisible();
    await expect(page.getByTestId('media-error-guidance')).toHaveCount(0);
    expect(calls.filter((path) => path === 'alibaba.icbu.video.query')).toHaveLength(1);
    expect(calls.filter((path) => path.endsWith('/alibaba/icbu/video/query'))).toHaveLength(1);
    expect(calls.some((path) => /upload|operate/iu.test(path))).toBe(false);
  } finally {
    await context.close();
  }
});
