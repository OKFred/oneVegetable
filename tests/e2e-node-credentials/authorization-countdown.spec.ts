import { expect, test } from '@playwright/test';
import fixture from '../../mock/data/node-gateway-credentials.json' with { type: 'json' };
import overview from '../../mock/data/dashboard-authorization.json' with { type: 'json' };
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
    let refreshes = 0;
    page.on('request', (request) => {
      if (request.url().endsWith('/admin/gateway-credentials/refresh')) refreshes++;
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
      await expect(card).toContainText(locale === 'zh-CN' ? '剩余约' : 'About');
      await page.screenshot({ path: `artifacts/authorization-countdown-${tone}-${locale}.png` });
    }
    expect(refreshes).toBe(0);
  });
}
