import { expect, test } from '@playwright/test';

test('country list debugger exposes the authorized object request', async ({ page }) => {
  await page.goto('/#/capabilities');
  await page.getByPlaceholder('搜索 API 方法').fill('alibaba.icbu.product.country.getcountrylist');
  await page
    .getByRole('button', { name: 'alibaba.icbu.product.country.getcountrylist', exact: true })
    .click();
  await expect(page.locator('textarea').first()).toHaveValue(/country_request/);
  await expect(page.locator('textarea').first()).toHaveValue(/zh_cn/);
});
