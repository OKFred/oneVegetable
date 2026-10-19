import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { chromium, expect, test, type Page, type Worker } from '@playwright/test';
import fixture from '../../mock/data/node-gateway-credentials.json' with { type: 'json' };

function permissions(worker: Worker): Promise<unknown> {
  return worker.evaluate(() => {
    const api = (globalThis as unknown as { chrome: { permissions: { getAll(): Promise<unknown> } } }).chrome;
    return api.permissions.getAll();
  });
}

function authorizationSummary(page: Page): Promise<unknown> {
  return page.evaluate(async () => {
    const api = (
      globalThis as unknown as {
        chrome: { runtime: { sendMessage(value: unknown): Promise<{ ok: boolean; data: unknown }> } };
      }
    ).chrome;
    const response = await api.runtime.sendMessage({
      kind: 'credential-vault-request',
      operation: 'authorizations',
      requestId: crypto.randomUUID()
    });
    if (!response.ok) throw new Error('Unable to read test authorization summary');
    return response.data;
  });
}

test('formal extension imports locally and requests only the required IOP business origin', async () => {
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
    await page.evaluate(() => {
      const target = globalThis as unknown as {
        importPermissionAllowed: boolean;
        importPermissionRequests: { origins: string[]; active: boolean }[];
        chrome: { permissions: { request(input: { origins: string[] }): Promise<boolean> } };
      };
      target.importPermissionAllowed = false;
      target.importPermissionRequests = [];
      // Isolate the native permission decision; do not grant hosts or contact Alibaba in CI.
      target.chrome.permissions.request = (input) => {
        target.importPermissionRequests.push({
          origins: input.origins,
          active: navigator.userActivation.isActive
        });
        return Promise.resolve(target.importPermissionAllowed);
      };
    });
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
        buffer: Buffer.from(
          JSON.stringify(
            protocol === 'iop'
              ? [
                  { ...fixture.oauthBundle, protocol: 'iop' },
                  { ...fixture.oauthBundle, protocol: 'top' }
                ]
              : { ...fixture.oauthBundle, protocol }
          )
        )
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
      if (protocol === 'iop') {
        await expect(dialog.getByTestId('authorization-file-preview')).toContainText('TOP');
        const before = await authorizationSummary(page);
        await dialog.getByTestId('confirm-authorization-file-import').click();
        await expect(
          page.getByText('导入未完成，请检查本机保护及域名访问权限后重试。未自动发起在线授权。', {
            exact: true
          })
        ).toBeVisible();
        await expect(dialog).toBeVisible();
        expect(await authorizationSummary(page)).toEqual(before);
        await page.evaluate(() => {
          (globalThis as unknown as { importPermissionAllowed: boolean }).importPermissionAllowed = true;
        });
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
    expect(
      await page.evaluate(
        () => (globalThis as unknown as { importPermissionRequests: unknown[] }).importPermissionRequests
      )
    ).toEqual([
      { origins: ['https://openapi-api.alibaba.com/*'], active: true },
      { origins: ['https://openapi-api.alibaba.com/*'], active: true }
    ]);
    expect(await permissions(worker)).toEqual(permissionsBefore);
  } finally {
    await context.close();
  }
});
