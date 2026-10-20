import { expect, test } from '@playwright/test';
import fixture from '../../mock/data/node-gateway-credentials.json' with { type: 'json' };
import overview from '../../mock/data/dashboard-authorization.json' with { type: 'json' };
import dualLayout from '../../mock/data/dashboard-authorization-layout.json' with { type: 'json' };
import adminLayout from '../../mock/data/admin-configuration-layout.json' with { type: 'json' };
import { completeOnboarding, ONBOARDING_STORAGE_KEY } from '../../packages/core/src/privacy';
import { expectDefaultActionSizing } from '../e2e/helpers/button-sizing';

for (const locale of ['zh-CN', 'en-US'] as const) {
  for (const theme of ['light', 'dark'] as const) {
    for (const width of [1440, 390]) {
      test(`${locale}/${theme}/${width}: self-hosted authorization configuration is compact and scoped to its dialog`, async ({
        page
      }) => {
        const en = locale === 'en-US';
        const api = 'http://127.0.0.1:8786/api/v1';
        const http = page.context().request;
        const bootstrap = await http.post(`${api}/auth/bootstrap`, {
          data: {
            requestId: crypto.randomUUID(),
            bootstrapToken: 'node-credential-e2e-bootstrap-32-bytes',
            ...fixture.workbench
          }
        });
        if (!bootstrap.ok())
          expect(
            (
              await http.post(`${api}/auth/login`, {
                data: { requestId: crypto.randomUUID(), ...fixture.workbench }
              })
            ).ok()
          ).toBe(true);
        await page.setViewportSize({ width, height: 960 });
        await page.addInitScript(
          ({ key, state, locale, theme }) => {
            localStorage.setItem(key, JSON.stringify(state));
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
          { key: ONBOARDING_STORAGE_KEY, state: completeOnboarding(), locale, theme }
        );
        await page.route('**/admin/system/get', async (route) => {
          const response = await route.fetch();
          const body = (await response.json()) as { data: { environment: string } };
          body.data.environment = 'self-hosted';
          await route.fulfill({ response, json: body });
        });
        await page.route('**/auth/passkeys/list', (route) =>
          route.fulfill({
            json: {
              requestId: (route.request().postDataJSON() as { requestId: string }).requestId,
              ok: true,
              data: adminLayout.passkeys
            }
          })
        );
        await page.route('**/admin/real-mutations/status/get', (route) =>
          route.fulfill({
            json: {
              requestId: (route.request().postDataJSON() as { requestId: string }).requestId,
              ok: true,
              data: adminLayout.mutationStatus
            }
          })
        );
        const profiles = {
          top: { ...overview.credential, ...dualLayout.top },
          iop: {
            ...overview.credential,
            ...dualLayout.iop,
            accessTokenExpiresTimeUtc: Date.now() + 30 * 86_400_000
          }
        };
        await page.route('**/admin/gateway-credentials/authorizations/get', (route) =>
          route.fulfill({
            json: {
              requestId: (route.request().postDataJSON() as { requestId: string }).requestId,
              ok: true,
              data: { ...dualLayout, ...profiles }
            }
          })
        );
        await page.route('**/admin/gateway-credentials/get', (route) => {
          const body = route.request().postDataJSON() as { requestId: string; protocol?: 'top' | 'iop' };
          return route.fulfill({
            json: { requestId: body.requestId, ok: true, data: profiles[body.protocol ?? 'top'] }
          });
        });
        const writes: string[] = [];
        page.on('request', (request) => {
          if (/gateway-credentials\/(?:save|import|clear|refresh|test)$/u.test(request.url()))
            writes.push(request.url());
        });
        await page.goto('/#/admin');
        const sections = page.getByTestId('self-hosted-settings-sections');
        await expect(sections).toBeVisible();
        await expect(page.getByTestId('select-authorization-iop')).toBeVisible();
        await expect(page.getByTestId('gateway-credential-panel')).toHaveCount(0);
        const dimensions = await sections.evaluate((element) => {
          const cards = [...element.children].map((child) => child.getBoundingClientRect());
          return {
            horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
            stacked: cards.every(
              (card, index) => index === 0 || card.top >= (cards[index - 1]?.bottom ?? Infinity)
            ),
            authorizationHeight: cards[0]?.height ?? Infinity
          };
        });
        expect(dimensions.horizontalOverflow).toBe(false);
        // Layout bounds are checked before opening any overlay.
        expect(dimensions.stacked).toBe(true);
        expect(dimensions.authorizationHeight).toBeLessThan(width > 1000 ? 440 : 800);
        await sections.screenshot({
          path: `artifacts/admin-configuration-${locale}-${theme}-${width}.png`,
          animations: 'disabled'
        });
        for (const protocol of ['top', 'iop'] as const) {
          const configuration = page.getByRole('dialog', {
            name: en
              ? `${protocol.toUpperCase()} authorization settings`
              : `${protocol.toUpperCase()} 授权配置`,
            exact: true
          });
          const trigger = page.getByTestId(`select-authorization-${protocol}`);
          await trigger.click();
          await expect(configuration).toBeVisible();
          const panel = configuration.getByTestId('gateway-credential-panel');
          await expect(panel.getByTestId('gateway-protocol-summary')).toContainText(protocol.toUpperCase());
          await expect(configuration.getByTestId('credential-import-actions')).toContainText(
            en ? 'Import authorization JSON' : '导入授权 JSON'
          );
          await expect(configuration.getByTestId('credential-connection-actions')).toContainText(
            en ? 'Test connection' : '测试连接'
          );
          await expectDefaultActionSizing(configuration.getByTestId('credential-import-actions'));
          await expectDefaultActionSizing(configuration.getByTestId('credential-connection-actions'));
          const bounds = await configuration.boundingBox();
          if (!bounds) throw new Error('Missing configuration dialog bounds');
          expect(bounds.height).toBeLessThanOrEqual(960 * 0.88 + 1);
          expect(bounds.width).toBeLessThanOrEqual(width);
          await expect(configuration).toHaveCSS('opacity', '1');
          await page.screenshot({
            path: `artifacts/button-sizing-consistency/after-web-${protocol}-${locale}-${theme}-${width}.png`,
            animations: 'disabled'
          });
          await configuration
            .getByRole('button', { name: en ? 'Enter manually' : '手动填写', exact: true })
            .click();
          const manual = page.getByRole('dialog', { name: en ? 'Enter manually' : '手动填写', exact: true });
          await expect(manual).toBeVisible();
          await expect(manual.getByLabel(en ? 'Gateway protocol' : '网关协议')).toHaveValue(protocol);
          await page.keyboard.press('Escape');
          await expect(manual).toBeHidden();
          await expect(configuration).toBeVisible();
          await configuration
            .getByRole('button', { name: en ? 'Enter manually' : '手动填写', exact: true })
            .click();
          await manual.locator('input[type="password"]').first().fill(fixture.manual.appKey);
          await page.keyboard.press('Escape');
          const discard = page.getByRole('dialog', {
            name: en ? 'Discard unsaved changes?' : '放弃未保存的修改？',
            exact: true
          });
          await expect(discard).toBeVisible();
          await discard
            .getByRole('button', { name: en ? 'Continue editing' : '继续编辑', exact: true })
            .click();
          await expect(manual.locator('input[type="password"]').first()).toHaveValue(fixture.manual.appKey);
          await page.keyboard.press('Escape');
          await discard
            .getByRole('button', { name: en ? 'Discard changes and leave' : '放弃修改并离开', exact: true })
            .click();
          await expect(manual).toBeHidden();
          await expect(configuration).toBeVisible();
          await configuration.getByRole('button', { name: en ? 'Done' : '完成', exact: true }).click();
          await expect(configuration).toBeHidden();
          for (const close of ['escape', 'button', 'overlay'] as const) {
            await trigger.click();
            await expect(configuration).toBeVisible();
            if (close === 'escape') await page.keyboard.press('Escape');
            else if (close === 'button')
              await configuration
                .getByRole('button', {
                  name: en
                    ? `Close ${protocol.toUpperCase()} authorization settings`
                    : `关闭${protocol.toUpperCase()} 授权配置`,
                  exact: true
                })
                .click();
            else await page.locator('.ov-dialog-overlay').click({ position: { x: 5, y: 5 } });
            await expect(configuration).toBeHidden();
          }
        }
        expect(writes).toEqual([]);
      });
    }
  }
}
