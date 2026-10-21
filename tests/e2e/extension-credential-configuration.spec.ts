import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { chromium, expect, test } from '@playwright/test';
import fixture from '../../mock/data/node-gateway-credentials.json' with { type: 'json' };
import connection from '../../mock/data/alibaba-auth/credential-connection.json' with { type: 'json' };
import business from '../../mock/data/alibaba-auth/iop-business-responses.json' with { type: 'json' };
import { completeOnboarding, ONBOARDING_STORAGE_KEY } from '../../packages/core/src/privacy';

for (const locale of ['zh-CN', 'en-US'] as const) {
  for (const width of [1440, 390]) {
    test(`formal extension credential configuration: ${locale}, ${width}px`, async () => {
      test.setTimeout(120_000);
      const profile = await mkdtemp(resolve(tmpdir(), 'one-vegetable-credential-ui-'));
      const extension = resolve(import.meta.dirname, '../../apps/extension/.output/chrome-mv3');
      const context = await chromium.launchPersistentContext(profile, {
        channel: 'chromium',
        headless: true,
        locale,
        viewport: { width, height: 940 },
        reducedMotion: 'reduce',
        args: ['--disable-extensions-except=' + extension, '--load-extension=' + extension]
      });
      try {
        // Isolated test profile only: no native permission grants or real Alibaba calls.
        await context.route(/^https?:\/\//u, (route) => route.abort());
        const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
        await worker.evaluate(
          async ({ top, iop, key, onboarding }) => {
            const target = globalThis as unknown as {
              chrome: {
                permissions: { contains(input: unknown): Promise<boolean> };
                storage: { local: { set(value: Record<string, unknown>): Promise<void> } };
              };
              credentialTestPaths: string[];
              fetch: typeof fetch;
            };
            await target.chrome.storage.local.set({ [key]: onboarding });
            target.chrome.permissions.contains = () => Promise.resolve(true);
            target.credentialTestPaths = [];
            target.fetch = (input) => {
              const url = new URL(input instanceof Request ? input.url : String(input));
              if (!['eco.taobao.com', 'openapi-api.alibaba.com'].includes(url.hostname))
                return Promise.reject(new Error('Unexpected test destination'));
              target.credentialTestPaths.push(url.pathname);
              return Promise.resolve(Response.json(url.hostname === 'eco.taobao.com' ? top : iop));
            };
          },
          {
            top: connection.top,
            iop: business.products,
            key: ONBOARDING_STORAGE_KEY,
            onboarding: completeOnboarding()
          }
        );
        const page = await context.newPage();
        await page.addInitScript(
          ({ key, onboarding, locale }) => {
            localStorage.setItem(key, JSON.stringify(onboarding));
            localStorage.setItem(
              'one-vegetable:preferences:v2',
              JSON.stringify({
                version: 2,
                uiLocale: locale,
                alibabaLanguage: 'zh_CN',
                theme: 'dark'
              })
            );
            const target = globalThis as unknown as {
              chrome?: { permissions: { request(input: unknown): Promise<boolean> } };
            };
            if (target.chrome) target.chrome.permissions.request = () => Promise.resolve(true);
          },
          { key: ONBOARDING_STORAGE_KEY, onboarding: completeOnboarding(), locale }
        );
        const origin = 'chrome-extension://' + new URL(worker.url()).host;
        await page.goto(origin + '/options.html#/settings');
        await page.getByTestId('open-authorization-guide').click();
        await page.getByTestId('authorization-wizard-continue').click();
        const en = locale === 'en-US';
        const acquisition = page.getByRole('dialog', {
          name: en ? 'Connect your Alibaba account' : '连接 Alibaba 账号',
          exact: true
        });
        await acquisition.getByTestId('continue-authorization-protection').click();
        await acquisition.getByTestId('authorization-method-file').click();
        await acquisition.locator('input[type="file"]').setInputFiles({
          name: 'credentialInfo.json',
          mimeType: 'application/json',
          buffer: Buffer.from(
            JSON.stringify([fixture.oauthBundle, { ...fixture.oauthBundle, protocol: 'iop' }])
          )
        });
        await acquisition.getByTestId('confirm-authorization-file-import').click();
        await expect(acquisition).toBeHidden();
        await expect(page.getByTestId('default-authorization-top')).toHaveAttribute('aria-pressed', 'true');
        const panel = page.getByTestId('alibaba-authorizations-panel');
        await expect(panel.getByTestId('open-authorization-guide')).toHaveText(
          en ? 'Quick setup' : '一键配置'
        );
        await expect(panel.getByTestId('default-authorization-top')).toHaveText(en ? 'Default' : '默认');
        await expect(panel.getByTestId('select-authorization-top')).toHaveText(en ? 'Configure' : '配置');
        await expect(panel.getByTestId('clear-authorization-top')).toHaveText(en ? 'Clear' : '清除');
        await expect(page.getByTestId('credential-import-actions')).toHaveCount(0);
        const baseline = await worker.evaluate(
          () => (globalThis as unknown as { credentialTestPaths: string[] }).credentialTestPaths.length
        );
        await page.getByTestId('select-authorization-iop').click();
        const configuration = page.getByRole('dialog', {
          name: en ? 'IOP authorization settings' : 'IOP 授权配置',
          exact: true,
          includeHidden: true
        });
        await expect(configuration.getByTestId('credential-import-actions')).toBeVisible();
        await expect(configuration.getByTestId('credential-connection-actions')).toBeVisible();
        await expect(configuration.getByTestId('clear-authorization-iop')).toHaveCount(0);
        await expect(configuration.getByRole('note')).toHaveCount(0);
        await expect(page.getByTestId('settings-independent-notice')).toHaveCount(1);
        expect(
          await worker.evaluate(
            () => (globalThis as unknown as { credentialTestPaths: string[] }).credentialTestPaths.length
          )
        ).toBe(baseline);
        await configuration
          .getByRole('button', { name: en ? 'Enter manually' : '手动填写', exact: true })
          .click();
        const manual = page.getByRole('dialog', { name: en ? 'Enter manually' : '手动填写', exact: true });
        await manual.getByLabel('App Secret', { exact: true }).fill(fixture.manual.appSecret);
        await page.keyboard.press('Escape');
        const discard = page.getByRole('dialog', {
          name: en ? 'Discard unsaved changes?' : '放弃未保存的修改？',
          exact: true
        });
        await expect(discard).toBeVisible();
        expect(await page.locator('[role="dialog"][data-state="open"]').count()).toBe(3);
        expect(await discard.evaluate((element) => Number(getComputedStyle(element).zIndex))).toBeGreaterThan(
          await configuration.evaluate((element) => Number(getComputedStyle(element).zIndex))
        );
        expect(await discard.evaluate((element) => element.contains(document.activeElement))).toBe(true);
        await discard
          .getByRole('button', { name: en ? 'Continue editing' : '继续编辑', exact: true })
          .click();
        await expect(manual.getByLabel('App Secret', { exact: true })).toHaveValue(fixture.manual.appSecret);
        await manual.getByRole('button', { name: en ? 'Cancel' : '取消', exact: true }).click();
        await discard
          .getByRole('button', { name: en ? 'Discard changes and leave' : '放弃修改并离开', exact: true })
          .click();
        await expect(manual).toBeHidden();
        await expect(configuration).toBeVisible();
        await configuration
          .getByRole('button', { name: en ? 'Test connection' : '测试连接', exact: true })
          .click();
        await expect(configuration.getByTestId('credential-connection-actions')).toContainText(
          en ? 'Connection verified' : '连接测试通过'
        );
        const paths = await worker.evaluate(() =>
          (globalThis as unknown as { credentialTestPaths: string[] }).credentialTestPaths.slice()
        );
        expect(paths.slice(baseline)).toEqual(['/rest/alibaba/icbu/product/list']);
        await expect(configuration).toHaveCSS('opacity', '1');
        await configuration.screenshot({ path: `artifacts/unified-credentials-${locale}-${width}.png` });
        expect(
          await configuration.evaluate((element) => element.getBoundingClientRect().width)
        ).toBeLessThanOrEqual(width);
        await configuration.getByRole('button', { name: en ? 'Done' : '完成', exact: true }).click();
        await expect(configuration).toBeHidden();
        const clear = panel.getByTestId('clear-authorization-iop');
        for (const method of ['cancel', 'escape', 'close', 'overlay']) {
          await clear.click();
          const confirmation = page.getByRole('dialog', {
            name: en ? 'Clear this local authorization?' : '确认清除此本机授权？',
            exact: true
          });
          await expect(confirmation).toBeVisible();
          await expect(confirmation).toContainText(en ? 'local authorization tool' : '授权工具');
          expect(await confirmation.evaluate((element) => element.contains(document.activeElement))).toBe(
            true
          );
          await page.keyboard.press('Tab');
          expect(await confirmation.evaluate((element) => element.contains(document.activeElement))).toBe(
            true
          );
          if (method === 'cancel') {
            await page.screenshot({ path: `artifacts/nested-clear-${locale}-${width}.png` });
            await confirmation.getByRole('button', { name: en ? 'Cancel' : '取消', exact: true }).click();
          } else if (method === 'escape') await page.keyboard.press('Escape');
          else if (method === 'close') await confirmation.locator('header button').click();
          else await page.mouse.click(8, 8);
          await expect(confirmation).toBeHidden();
          await expect(configuration).toBeHidden();
          await expect(clear).toBeFocused();
          await expect(clear).toBeEnabled();
        }
        await expect(page.getByTestId('default-authorization-top')).toHaveAttribute('aria-pressed', 'true');
        await page.getByTestId('default-authorization-iop').click();
        await expect(page.getByTestId('default-authorization-iop')).toHaveAttribute('aria-pressed', 'true');
        await page.reload();
        await expect(page.getByTestId('default-authorization-iop')).toHaveAttribute('aria-pressed', 'true');
        await page.getByTestId('select-authorization-top').click();
        const top = page.getByRole('dialog', {
          name: en ? 'TOP authorization settings' : 'TOP 授权配置',
          exact: true
        });
        await expect(top).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(top).toBeHidden();
        const protection = page.getByTestId('alibaba-credential-protection-panel');
        await expect(protection.getByRole('button')).toHaveCount(2);
        await page.getByTestId('open-vault-passphrase').click();
        const rotate = page.getByRole('dialog', {
          name: en ? 'Change the local protection passphrase' : '更换本机保护口令',
          exact: true
        });
        await expect(
          rotate.getByLabel(en ? 'New protection passphrase' : '新保护口令', { exact: true })
        ).toBeVisible();
        await rotate.getByRole('button', { name: en ? 'Cancel' : '取消', exact: true }).click();
        await expect(rotate).toBeHidden();
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      } finally {
        await context.close();
      }
    });
  }
}
