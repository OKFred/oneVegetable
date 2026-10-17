import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { chromium, expect, test, type Page } from '@playwright/test';
import fixture from '../../mock/data/node-gateway-credentials.json' with { type: 'json' };

async function invoke(page: Page, kind: string, operation: string, payload: unknown = {}) {
  return page.evaluate(
    async (input) => {
      const runtime = (
        globalThis as unknown as {
          chrome: { runtime: { sendMessage(message: unknown): Promise<unknown> } };
        }
      ).chrome.runtime;
      return runtime.sendMessage({
        requestId: crypto.randomUUID(),
        kind: input.kind,
        payload: input.payload,
        ...(input.kind === 'iop-authorization-request'
          ? { action: input.operation, protocol: 'top' }
          : { operation: input.operation })
      });
    },
    { kind, operation, payload }
  );
}

for (const passphrase of ['', fixture.workbench.password]) {
  test(
    'shares authorization protection with Settings: ' + (passphrase ? 'passphrase' : 'optional blank'),
    async () => {
      test.setTimeout(120_000);
      const profile = await mkdtemp(resolve(tmpdir(), 'one-vegetable-shared-'));
      const extension = resolve(import.meta.dirname, '../../apps/extension/.output/chrome-mv3');
      const launch = () =>
        chromium.launchPersistentContext(profile, {
          channel: 'chromium',
          headless: true,
          locale: 'zh-CN',
          args: ['--disable-extensions-except=' + extension, '--load-extension=' + extension]
        });
      let context = await launch();
      try {
        await context.route(/^https?:\/\//u, (route) => route.abort());
        const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
        const origin = 'chrome-extension://' + new URL(worker.url()).host;
        const settings = await context.newPage();
        await settings.goto(origin + '/options.html#/settings');
        const guide = settings.getByRole('dialog', { name: '四步连接 Alibaba 开放平台' });
        await guide.getByRole('checkbox').check();
        await guide.getByRole('button', { name: '稍后，仅浏览' }).click();
        await expect(settings.getByTestId('vault-passphrase-setup')).toBeVisible();
        await settings.getByTestId('get-alibaba-credentials').click();
        await expect(settings.getByTestId('authorization-protection')).toBeVisible();
        await expect(settings.getByTestId('alibaba-authorization-protocol-choices')).toHaveCount(0);
        await expect(settings.getByTestId('authorization-protection-passphrase')).not.toHaveAttribute(
          'required'
        );
        const screenshots = resolve(import.meta.dirname, '../../artifacts/authorization-protection');
        await mkdir(screenshots, { recursive: true });
        await settings.screenshot({
          path: resolve(
            screenshots,
            'optional-preflight-' + (passphrase ? 'with-passphrase' : 'blank') + '.png'
          )
        });
        await settings.keyboard.press('Escape');
        await expect(settings.getByTestId('authorization-protection')).toHaveCount(0);
        const authorization = await context.newPage();
        await authorization.goto(origin + '/authorization.html?protocol=top');
        await expect(authorization.locator('#protectionSection')).toBeVisible();
        await expect(authorization.locator('#sharedPassphrase')).not.toHaveAttribute('required');
        if (passphrase) await authorization.locator('#sharedPassphrase').fill(passphrase);
        await authorization.locator('#protectionForm button').click();
        await expect(authorization.locator('#protectionSection')).toBeHidden();
        await expect(settings.getByTestId('vault-passphrase-setup')).toHaveCount(0);
        expect(
          await invoke(authorization, 'iop-authorization-request', 'import', {
            bundle: { ...fixture.oauthBundle, protocol: 'top' },
            passphrase: ''
          })
        ).toMatchObject({ ok: true, data: { state: 'ready' } });
        await settings.bringToFront();
        await settings.getByLabel('导入授权包 JSON', { exact: true }).setInputFiles({
          name: 'credentialInfo.json',
          mimeType: 'application/json',
          buffer: Buffer.from(JSON.stringify(fixture.oauthBundle))
        });
        await settings.getByRole('button', { name: '保存设置', exact: true }).click();
        await expect
          .poll(() => invoke(settings, 'credential-vault-request', 'status'))
          .toMatchObject({
            ok: true,
            data: { state: 'unlocked', hasAccessToken: true, deviceProtected: !passphrase }
          });
        await context.close();
        context = await launch();
        await context.route(/^https?:\/\//u, (route) => route.abort());
        const restarted = await context.newPage();
        await restarted.goto(origin + '/options.html#/settings');
        expect(await invoke(restarted, 'credential-vault-request', 'status')).toMatchObject({
          ok: true,
          data: { state: 'unlocked', hasAccessToken: true }
        });
        expect(await invoke(restarted, 'credential-vault-request', 'lock')).toMatchObject({
          ok: true,
          data: { state: 'locked' }
        });
        await restarted.reload();
        expect(await invoke(restarted, 'credential-vault-request', 'status')).toMatchObject({
          ok: true,
          data: { state: 'locked' }
        });
        expect(await invoke(restarted, 'credential-vault-request', 'unlock', { passphrase })).toMatchObject({
          ok: true,
          data: { state: 'unlocked', hasAccessToken: true }
        });
      } finally {
        await context.close();
      }
    }
  );
}
