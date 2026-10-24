import { expect, test, type Page } from '@playwright/test';
import fixture from '../../mock/data/node-gateway-credentials.json' with { type: 'json' };
import overview from '../../mock/data/dashboard-authorization.json' with { type: 'json' };
import dual from '../../mock/data/dashboard-authorization-layout.json' with { type: 'json' };
import loading from '../../mock/data/loading-feedback.json' with { type: 'json' };
import { completeOnboarding, ONBOARDING_STORAGE_KEY } from '../../packages/core/src/privacy';

async function initialize(page: Page, locale: 'zh-CN' | 'en-US') {
  const api = 'http://127.0.0.1:8786/api/v1';
  const http = page.context().request;
  const response = await http.post(`${api}/auth/bootstrap`, {
    data: {
      requestId: crypto.randomUUID(),
      bootstrapToken: 'node-credential-e2e-bootstrap-32-bytes',
      ...fixture.workbench
    }
  });
  if (!response.ok()) {
    expect(
      (
        await http.post(`${api}/auth/login`, {
          data: { requestId: crypto.randomUUID(), ...fixture.workbench }
        })
      ).ok()
    ).toBe(true);
  }
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
}

for (const locale of ['zh-CN', 'en-US'] as const) {
  test(`${locale}: pending authorizations are visible and hidden settings load only when opened`, async ({
    page
  }, testInfo) => {
    await initialize(page, locale);
    await page.setViewportSize({ width: locale === 'zh-CN' ? 1440 : 390, height: 960 });
    let release!: () => void;
    const gate = new Promise<void>((done) => {
      release = done;
    });
    let requested = false;
    let storageReads = 0;
    const writes: string[] = [];
    page.on('request', (request) => {
      if (/gateway-credentials\/(save|import|clear|refresh|test)$/u.test(request.url()))
        writes.push(request.url());
    });
    await page.route('**/admin/gateway-credentials/authorizations/get', async (route) => {
      requested = true;
      await gate;
      await route.fulfill({
        json: {
          requestId: (route.request().postDataJSON() as { requestId: string }).requestId,
          ok: true,
          data: {
            ...dual,
            top: { ...overview.credential, ...dual.top },
            iop: { ...overview.credential, ...dual.iop }
          }
        }
      });
    });
    await page.route('**/admin/storage/s3/get', async (route) => {
      storageReads++;
      await route.fulfill({
        json: {
          requestId: (route.request().postDataJSON() as { requestId: string }).requestId,
          ok: true,
          data: loading.storage
        }
      });
    });
    await page.goto('/#/settings');
    await expect.poll(() => requested).toBe(true);
    const placeholder = page.locator('[data-skeleton-layout="authorization"]');
    await expect(placeholder).toBeVisible();
    await expect(placeholder).toContainText(locale === 'zh-CN' ? '正在加载' : 'Loading');
    await expect(page.getByTestId('alibaba-authorizations-panel')).toBeHidden();
    expect(storageReads).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    await page.screenshot({ path: testInfo.outputPath(`settings-${locale}-loading.png`) });
    release();
    await expect(page.getByTestId('alibaba-authorizations-panel')).toBeVisible();
    await expect(placeholder).toBeHidden();
    await page.locator('[aria-controls="settings-storage"]').click();
    const endpoint = page.locator('#settings-storage input').first();
    await expect(endpoint).toHaveValue(loading.storage.endpoint);
    await endpoint.fill('https://edited.example.com');
    await page.locator('[aria-controls="settings-credentials"]').click();
    await page.locator('[aria-controls="settings-storage"]').click();
    await expect(endpoint).toHaveValue('https://edited.example.com');
    expect(storageReads).toBe(1);
    expect(writes).toEqual([]);
  });
}

test('a slow page module has loading feedback while the shell remains interactive', async ({ page }) => {
  await initialize(page, 'en-US');
  let release!: () => void;
  const gate = new Promise<void>((done) => {
    release = done;
  });
  let requested = false;
  await page.route('**/views/SettingsView.vue', async (route) => {
    requested = true;
    await gate;
    await route.continue();
  });
  await page.goto('/#/settings');
  await expect.poll(() => requested).toBe(true);
  await expect(page.locator('[data-skeleton-layout="page"]')).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Loading' })).toBeVisible();
  release();
  await expect(page.locator('[aria-controls="settings-preferences"]')).toBeVisible();
  await expect(page.locator('[data-skeleton-layout="page"]')).toBeHidden();
});
