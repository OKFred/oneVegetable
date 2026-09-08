import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { chromium, expect, test } from '@playwright/test';
import fixture from '../../mock/data/extension-s3.json' with { type: 'json' };
declare const chrome: {
  runtime: { sendMessage(message: unknown): Promise<unknown> };
  storage: { local: { get(key: string): Promise<Record<string, unknown>> } };
};

test('MV3 stores S3 encrypted, restores after worker shutdown and rejects non-options senders', async () => {
  const extensionPath = resolve('apps/extension/.output/chrome-mv3');
  const profile = await mkdtemp(resolve(tmpdir(), 'one-vegetable-s3-e2e-'));
  const context = await chromium.launchPersistentContext(profile, {
    headless: false,
    locale: 'zh-CN',
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
  });
  try {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    const id = new URL(worker.url()).host;
    const page = await context.newPage();
    await page.goto(`chrome-extension://${id}/options.html`);
    const onboarding = page.getByRole('dialog', { name: '四步连接 Alibaba 开放平台' });
    await onboarding.getByRole('checkbox').check();
    await onboarding.getByRole('button', { name: '稍后，仅浏览' }).click();
    await page.goto(`chrome-extension://${id}/options.html#/settings`);
    await expect(page.getByRole('heading', { name: 'S3 素材存储', exact: true })).toBeVisible();
    // Uses an already-granted origin but performs NO network request. Permission UI is covered separately.
    const configuration = { ...fixture.configuration, endpoint: 'https://eco.taobao.com' };
    const response: unknown = await page.evaluate(
      (configuration) =>
        chrome.runtime.sendMessage({
          kind: 's3-storage-request',
          requestId: crypto.randomUUID(),
          operation: 'save',
          payload: { configuration, revision: null, remark: null }
        }),
      configuration
    );
    expect(response).toMatchObject({ ok: true, data: { configured: true, revision: 1 } });
    const stored = await page.evaluate(() => chrome.storage.local.get('one-vegetable.s3.v1'));
    expect(JSON.stringify(stored)).not.toContain(configuration.secretAccessKey);
    const cdp = await context.newCDPSession(page);
    await cdp.send('ServiceWorker.enable');
    await cdp.send('ServiceWorker.stopAllWorkers');
    await page.reload();
    await expect(page.getByLabel('Endpoint', { exact: true })).toHaveValue(configuration.endpoint);
    await expect(page.getByLabel('Secret Access Key', { exact: true })).toHaveValue('');
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${id}/popup.html`);
    const denied: unknown = await popup.evaluate(() =>
      chrome.runtime.sendMessage({
        kind: 's3-storage-request',
        requestId: crypto.randomUUID(),
        operation: 'summary',
        payload: {}
      })
    );
    expect(denied).toMatchObject({ ok: false, error: { code: 'S3_UNTRUSTED_SENDER' } });
    await page.getByRole('button', { name: '清除配置', exact: true }).click();
    await page
      .getByRole('dialog', { name: '确认清除 S3 配置' })
      .getByRole('button', { name: '清除配置', exact: true })
      .click();
    await expect(page.getByText('S3 配置已清除。', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => chrome.storage.local.get('one-vegetable.s3.v1'))).toEqual({});
  } finally {
    await context.close();
  }
});
