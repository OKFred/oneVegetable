import { expect, test } from '@playwright/test';
import { productQuality as zh } from '../../packages/ui/src/i18n/messages/zh-CN/productQuality';
import { productQuality as en } from '../../packages/ui/src/i18n/messages/en-US/productQuality';

for (const locale of ['zh', 'en'] as const) {
  test(`assess selected products and return from targeted editing (${locale})`, async ({ page }) => {
    const copy = locale === 'zh' ? zh : en;
    await page.goto('/#/products');
    await expect(page.locator('table tbody tr')).toHaveCount(3);
    await page.locator('table tbody tr').first().getByRole('checkbox').check();
    await page.getByRole('button', { name: '更多', exact: true }).click();
    await page.getByRole('menuitem', { name: zh.title, exact: true }).click();
    const report = page.getByTestId('product-quality-workspace');
    await expect(report).toBeVisible();
    await expect(report).toContainText(zh.pending);
    if (locale === 'en') {
      await page
        .getByRole('button', { name: /切换.*英文|Switch.*English|English/ })
        .first()
        .click();
      await page.evaluate(() => {
        document.documentElement.classList.add('dark');
      });
      await page.setViewportSize({ width: 390, height: 844 });
    }
    await report.getByRole('button', { name: copy.start, exact: true }).click();
    await expect(report).toContainText('4.6');
    await expect(report.getByRole('status')).toContainText('1 / 1');
    await report.getByRole('button', { name: copy.edit, exact: true }).click();
    const review = page.getByTestId('product-quality-review');
    await expect(review).toBeVisible();
    await expect(review).toContainText(copy.local);
    await review.getByRole('button', { name: copy.recheck, exact: true }).click();
    await expect(review.getByRole('button', { name: copy.recheck, exact: true })).toBeEnabled();
    await page.getByRole('button', { name: copy.backReport, exact: true }).click();
    await expect(report).toBeVisible();
    await expect(report).toContainText('4.6');
    const overflow = await report.evaluate((element) => element.scrollWidth > element.clientWidth + 1);
    expect(overflow).toBe(false);
    await report.getByRole('button', { name: copy.back, exact: true }).click();
    await expect(page.locator('table tbody tr')).toHaveCount(3);
  });
}
