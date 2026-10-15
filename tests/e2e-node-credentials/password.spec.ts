import { expect, test } from '@playwright/test';
import fixture from '../../mock/data/node-gateway-credentials.json' with { type: 'json' };
import { completeOnboarding, ONBOARDING_STORAGE_KEY } from '../../packages/core/src/privacy';

for (const locale of ['zh-CN', 'en-US'] as const) {
  test(`${locale}: six-character password signs in through the workspace form`, async ({ page }) => {
    await page.addInitScript(
      ({ key, state, locale }) => {
        localStorage.setItem(key, JSON.stringify(state));
        localStorage.setItem(
          'one-vegetable:preferences:v2',
          JSON.stringify({
            version: 2,
            uiLocale: locale,
            alibabaLanguage: 'zh_CN',
            theme: 'dark'
          })
        );
      },
      { key: ONBOARDING_STORAGE_KEY, state: completeOnboarding(), locale }
    );
    await page.goto('/#/templates');
    await expect(
      page.getByText(locale === 'zh-CN' ? '至少 6 个字符' : 'At least 6 characters', { exact: true })
    ).toBeVisible();
    await page.locator('input[name="username"]').fill(fixture.workbench.username);
    await page.locator('input[name="password"]').fill(fixture.workbench.password);
    await page.getByRole('button', { name: locale === 'zh-CN' ? '登录' : 'Sign in', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: locale === 'zh-CN' ? '模板' : 'Templates', exact: true })
    ).toBeVisible();
    await expect(page.locator('input[name="password"]')).toHaveCount(0);
  });
}
