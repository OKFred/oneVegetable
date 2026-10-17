import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { chromium, expect, test, type Worker } from '@playwright/test';
import fixture from '../../mock/data/node-gateway-credentials.json' with { type: 'json' };

function permissions(worker: Worker): Promise<unknown> {
  return worker.evaluate(() => {
    const api = (globalThis as unknown as { chrome: { permissions: { getAll(): Promise<unknown> } } }).chrome;
    return api.permissions.getAll();
  });
}

test('formal extension imports TOP and IOP without provider pages or extra permissions', async () => {
  test.setTimeout(120_000);
  const profile = await mkdtemp(resolve(tmpdir(), 'one-vegetable-offline-'));
  const extension = resolve(import.meta.dirname, '../../apps/extension/.output/chrome-mv3');
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    locale: 'zh-CN',
    args: ['--disable-extensions-except=' + extension, '--load-extension=' + extension]
  });
  try {
    const network: string[] = [];
    await context.route(/^https?:\/\//u, (route) => {
      network.push(new URL(route.request().url()).origin);
      return route.abort();
    });
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    const origin = 'chrome-extension://' + new URL(worker.url()).host;
    const page = await context.newPage();
    await page.goto(origin + '/options.html#/settings');
    const guide = page.getByRole('dialog', { name: '四步连接 Alibaba 开放平台' });
    await guide.getByRole('checkbox').check();
    await guide.getByRole('button', { name: '稍后，仅浏览' }).click();
    const permissionsBefore = await permissions(worker);
    const pageCount = context.pages().length;
    for (const protocol of ['top', 'iop'] as const) {
      await page.getByTestId('get-alibaba-credentials').click();
      const dialog = page.getByRole('dialog', { name: '连接 Alibaba 账号', exact: true });
      if (protocol === 'top') await dialog.getByTestId('continue-authorization-protection').click();
      else await expect(dialog.getByTestId('authorization-protection')).toHaveCount(0);
      await expect(dialog.getByTestId('authorization-method-choices')).toBeVisible();
      if (protocol === 'top') {
        const path = resolve(import.meta.dirname, '../../artifacts/authorization-methods');
        await mkdir(path, { recursive: true });
        await page.mouse.move(0, 0);
        await dialog.evaluate(async (element) => {
          await Promise.all(
            element
              .getAnimations({ subtree: true })
              .map((animation) => animation.finished.catch(() => undefined))
          );
        });
        await page.screenshot({ path: resolve(path, 'connection-methods.png') });
      }
      expect(context.pages()).toHaveLength(pageCount);
      await dialog.getByTestId('authorization-method-file').click();
      await dialog.getByLabel('选择授权 JSON 文件', { exact: true }).setInputFiles({
        name: 'credentialInfo.json',
        mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify({ ...fixture.oauthBundle, protocol }))
      });
      await expect(dialog.getByTestId('authorization-file-preview')).toContainText(protocol.toUpperCase());
      await expect(dialog).not.toContainText(fixture.oauthBundle.application.appSecret);
      if (protocol === 'top') {
        const path = resolve(import.meta.dirname, '../../artifacts/authorization-methods');
        await mkdir(path, { recursive: true });
        await dialog.evaluate(async (element) => {
          await Promise.all(
            element
              .getAnimations({ subtree: true })
              .map((animation) => animation.finished.catch(() => undefined))
          );
        });
        await page.screenshot({ path: resolve(path, 'offline-file-preview.png') });
      }
      await dialog.getByTestId('confirm-authorization-file-import').click();
      await expect(dialog).toBeHidden();
    }
    const saved = await page.evaluate(() => {
      const api = (
        globalThis as unknown as { chrome: { runtime: { sendMessage(value: unknown): Promise<unknown> } } }
      ).chrome;
      return api.runtime.sendMessage({
        kind: 'credential-vault-request',
        operation: 'authorizations',
        requestId: crypto.randomUUID()
      });
    });
    expect(saved).toMatchObject({ ok: true, data: { top: { configured: true }, iop: { configured: true } } });
    expect(context.pages()).toHaveLength(pageCount);
    expect(network).toEqual([]);
    expect(await permissions(worker)).toEqual(permissionsBefore);
  } finally {
    await context.close();
  }
});
