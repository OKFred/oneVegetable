import { expect, test } from '@playwright/test';
import fixture from '../../mock/data/node-gateway-credentials.json' with { type: 'json' };
import overview from '../../mock/data/dashboard-authorization.json' with { type: 'json' };
import dualLayout from '../../mock/data/dashboard-authorization-layout.json' with { type: 'json' };
import { completeOnboarding, ONBOARDING_STORAGE_KEY } from '../../packages/core/src/privacy';

for (const locale of ['zh-CN', 'en-US'] as const) {
  test(`${locale}: overview colors the recorded lifetime without refreshing authorization`, async ({
    page
  }) => {
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
    await page.addInitScript(
      ({ key, state, locale }) => {
        localStorage.setItem(key, JSON.stringify(state));
        localStorage.setItem(
          'one-vegetable:preferences:v2',
          JSON.stringify({
            version: 2,
            uiLocale: locale,
            alibabaLanguage: 'zh_CN',
            theme: locale === 'zh-CN' ? 'light' : 'dark'
          })
        );
      },
      { key: ONBOARDING_STORAGE_KEY, state: completeOnboarding(), locale }
    );
    let fraction = 0.8;
    let dual = false;
    let refreshes = 0;
    page.on('request', (request) => {
      if (request.url().endsWith('/admin/gateway-credentials/refresh')) refreshes++;
    });
    // This case also protects the legacy-server fallback: only the old status endpoint
    // is available, so optional dual metadata must not replace its expiry evidence.
    await page.route('**/admin/gateway-credentials/authorizations/get', (route) => {
      const requestId = (route.request().postDataJSON() as { requestId: string }).requestId;
      if (dual) {
        const now = Date.now();
        return route.fulfill({
          json: {
            requestId,
            ok: true,
            data: {
              ...dualLayout,
              top: { ...overview.credential, ...dualLayout.top },
              iop: {
                ...overview.credential,
                ...dualLayout.iop,
                accessTokenCapturedTimeUtc: now - 80 * 86_400_000,
                accessTokenExpiresTimeUtc: now + 20 * 86_400_000
              }
            }
          }
        });
      }
      return route.fulfill({
        status: 404,
        contentType: 'application/json',
        json: {
          requestId,
          ok: false,
          error: { code: 'ROUTE_NOT_FOUND', message: 'fixture legacy server', retryable: false }
        }
      });
    });
    await page.route('**/admin/gateway-credentials/get', async (route) => {
      const now = Date.now();
      const lifetime = 100 * 86_400_000;
      const body = route.request().postDataJSON() as { requestId: string };
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          requestId: body.requestId,
          ok: true,
          data: {
            ...overview.credential,
            accessTokenCapturedTimeUtc: Math.round(now - (1 - fraction) * lifetime),
            accessTokenExpiresTimeUtc: Math.round(now + fraction * lifetime),
            // A recent permission check must never reset the lifetime baseline.
            permissionCapturedTimeUtc: now,
            systemApiPermission: 'active'
          }
        })
      });
    });
    for (const [remaining, tone] of [
      [0.8, 'normal'],
      [0.4, 'warning'],
      [0.2, 'danger']
    ] as const) {
      fraction = remaining;
      if (tone === 'normal') await page.goto('/#/dashboard');
      else await page.reload();
      const card = page.getByTestId('dashboard-authorization-card');
      await expect(card).toHaveAttribute('aria-busy', 'false');
      await expect(card.getByRole('status')).toHaveAttribute('data-tone', tone);
      await expect(card.getByRole('status')).toContainText(locale === 'zh-CN' ? '天' : 'days');
      await expect(card.getByRole('button')).toHaveCount(0);
      await page.screenshot({ path: `artifacts/authorization-countdown-${tone}-${locale}.png` });
    }
    dual = true;
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.reload();
    const card = page.getByTestId('dashboard-authorization-card');
    await expect(card).toHaveAttribute('aria-busy', 'false');
    await expect(card.getByRole('button')).toHaveCount(0);
    await expect(card.getByTestId('authorization-top')).toContainText(
      locale === 'zh-CN' ? '未知' : 'Unknown'
    );
    await expect(card.getByTestId('authorization-iop').getByRole('status')).toHaveAttribute(
      'data-tone',
      'danger'
    );
    const grid = page.getByTestId('dashboard-metrics');
    await expect(grid).toHaveCSS('align-items', 'stretch');
    expect(await grid.locator(':scope > *').count()).toBe(4);
    const heights: number[] = [];
    for (const metric of await grid.locator(':scope > *').all()) {
      const box = await metric.boundingBox();
      expect(box).not.toBeNull();
      if (!box) throw new Error('Dashboard metric is not visible');
      heights.push(box.height);
      expect(box.height).toBeLessThanOrEqual(160);
    }
    expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: `artifacts/dashboard-compact-desktop-${locale}.png` });
    await card.getByTestId('authorization-details').focus();
    await expect(page.getByRole('tooltip')).toContainText('TOP');
    await expect(page.getByRole('tooltip')).toContainText('IOP');
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 390, height: 844 });
    const navigation = page.locator('#app-primary-navigation');
    await expect(navigation).toHaveAttribute('aria-hidden', 'true');
    await expect
      .poll(async () => {
        const box = await navigation.boundingBox();
        return box ? Math.round(box.x + box.width) : 0;
      })
      .toBeLessThanOrEqual(0);
    const contentWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(contentWidth).toBeLessThanOrEqual(390);
    await page.screenshot({ path: `artifacts/dashboard-compact-mobile-${locale}.png` });
    expect(refreshes).toBe(0);
  });
}
