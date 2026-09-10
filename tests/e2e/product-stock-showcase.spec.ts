import { expect, test } from '@playwright/test';
import { STOCK_SHOWCASE_METHODS } from '../../scripts/lib/product-stock-smoke';

test('five stock and showcase read definitions are searchable in the debugger', async ({ page }) => {
  await page.goto('/#/capabilities');
  for (const method of STOCK_SHOWCASE_METHODS) {
    await page.getByPlaceholder('搜索 API 方法').fill(method);
    await page.getByRole('button', { name: method, exact: true }).click();
    await expect(page.locator('textarea').first()).toHaveValue(
      method.endsWith('inventory.get')
        ? /product_id/
        : method.endsWith('showcase.list')
          ? /per_page_size/
          : method.endsWith('type.available.get')
            ? /type_request/
            : /^\{\}$/
    );
    await page.getByRole('button', { name: '调用能力', exact: true }).click();
    await expect(page.getByRole('dialog').locator('pre').last()).toContainText('"contractValid": true');
    await page.getByRole('button', { name: '关闭详情', exact: true }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
  }
});
