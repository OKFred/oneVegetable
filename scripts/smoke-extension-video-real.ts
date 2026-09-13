import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { parseAlibabaOpenApiCredentialBundle, ALIBABA_GATEWAY } from '../packages/core/src/index';
import { validateVideoPage } from '../packages/core/src/generated/validators-video';
import { atomicWriteJson } from './openapi-auth/storage';
if (process.env.ONE_VEGETABLE_VIDEO_SMOKE !== '1') throw new Error('Explicit read-only opt-in required');
const directory = resolve('artifacts/video-read-validation', `extension-${randomUUID()}`);
await mkdir(directory, { recursive: true });
const bundle = parseAlibabaOpenApiCredentialBundle(
  JSON.parse(
    await readFile(
      process.env.ONE_VEGETABLE_ALIBABA_CREDENTIAL_FILE ?? 'artifacts/openapi-auth/credentials.json',
      'utf8'
    )
  ) as unknown
);
const extensionPath = resolve('apps/extension/.output/chrome-mv3');
const context = await chromium.launchPersistentContext(await mkdtemp(resolve(directory, 'profile-')), {
  headless: false,
  locale: 'zh-CN',
  args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
});
const reports: Record<string, unknown>[] = [];
let stage = 'setup',
  passed = false;
try {
  await context.route('https://eco.taobao.com/**', async (route) => {
    const method = new URLSearchParams(route.request().postData() ?? '').get('method') ?? '';
    if (
      ![
        'alibaba.icbu.video.query',
        'alibaba.icbu.video.relation.product.list',
        'alibaba.icbu.product.id.decrypt',
        'alibaba.icbu.product.list'
      ].includes(method)
    )
      return route.abort();
    await route.continue();
  });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const page = await context.newPage();
  await page.goto(`chrome-extension://${new URL(worker.url()).host}/options.html#/settings`);
  const guide = page.getByRole('dialog', { name: '四步连接 Alibaba 开放平台' });
  await guide.getByRole('checkbox').check();
  await guide.getByRole('button', { name: '稍后，仅浏览' }).click();
  const saved = await page.evaluate(
    async (payload) => {
      const { chrome } = globalThis as unknown as {
        chrome: { runtime: { sendMessage(input: object): Promise<{ ok: boolean }> } };
      };
      return (
        await chrome.runtime.sendMessage({
          requestId: crypto.randomUUID(),
          kind: 'credential-vault-request',
          operation: 'create',
          payload
        })
      ).ok;
    },
    {
      passphrase: randomBytes(24).toString('base64url'),
      settings: {
        appKey: bundle.application.appKey,
        appSecret: bundle.application.appSecret,
        accessToken: bundle.oauth.accessToken,
        endpoint: ALIBABA_GATEWAY,
        signMethod: 'hmac'
      }
    }
  );
  if (!saved) throw new Error('Setup failed');
  async function list() {
    const requestId = randomUUID();
    const value: unknown = await page.evaluate(async (requestId) => {
      const { chrome } = globalThis as unknown as {
        chrome: { runtime: { sendMessage(input: object): Promise<unknown> } };
      };
      return chrome.runtime.sendMessage({
        requestId,
        kind: 'gateway-request',
        operation: 'listVideos',
        payload: { page: 1, pageSize: 20 }
      });
    }, requestId);
    if (!record(value) || value.ok !== true || !validateVideoPage(value.data))
      throw new Error('Invalid video response');
    reports.push({ operation: 'listVideos', requestId, ok: true });
  }
  stage = 'query';
  await list();
  await page.goto(`chrome-extension://${new URL(worker.url()).host}/options.html#/photos/videos`);
  const library = page.getByTestId('video-library');
  await expect(library.getByRole('button', { name: /查看:/ }).first()).toBeVisible();
  await library.getByRole('button', { name: /查看:/ }).nth(1).click();
  const dialog = page.getByRole('dialog'),
    media = dialog.locator('video');
  stage = 'playback';
  reports.push(
    await media.evaluate(async (element) => {
      const v = element as HTMLVideoElement;
      try {
        await Promise.race([
          v.play(),
          new Promise<never>((_, reject) =>
            globalThis.setTimeout(() => {
              reject(new Error('timeout'));
            }, 15000)
          )
        ]);
      } catch {
        /* Keep playback evidence separate. */
      }
      return {
        stage: 'native-playback',
        duration: Number.isFinite(v.duration) ? v.duration : null,
        paused: v.paused,
        readyState: v.readyState,
        error: v.error?.code ?? null
      };
    })
  );
  await page.keyboard.press('Escape');
  await library.getByRole('button', { name: /查看:/ }).first().click();
  stage = 'relations';
  await dialog.getByRole('button', { name: '关联商品', exact: true }).click();
  await expect(dialog.getByText('当前类型未返回关联商品')).toBeVisible();
  await dialog.getByRole('button', { name: '详情关联', exact: true }).click();
  await expect(dialog.getByRole('link', { name: '商品链接', exact: true })).toBeVisible({ timeout: 30000 });
  await page.screenshot({ path: resolve(directory, 'related.png') });
  await page.keyboard.press('Escape');
  stage = 'restart';
  const before = await worker.evaluate(() => performance.timeOrigin);
  const internals = await context.newPage();
  await internals.goto('chrome://serviceworker-internals');
  await internals.getByText('Stop', { exact: true }).click();
  await expect(internals.locator('body')).toContainText('STOPPED');
  await list();
  const after = context.serviceWorkers().at(-1) ?? (await context.waitForEvent('serviceworker'));
  expect(await after.evaluate(() => performance.timeOrigin)).toBeGreaterThan(before);
  passed = true;
} catch {
  process.exitCode = 1;
} finally {
  await atomicWriteJson(resolve(directory, 'report.json'), {
    passed,
    stage,
    capturedAtUtc: new Date().toISOString(),
    mutations: 0,
    reports
  });
  await context.close();
  console.log(JSON.stringify({ passed, stage, directory }));
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
