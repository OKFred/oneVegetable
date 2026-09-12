import { test, expect } from '@playwright/test';

test('inventory drawer preserves true zero, switches source and shares optional columns', async ({
  page
}) => {
  await page.goto('/#/products');
  await page.getByRole('button', { name: '库存', exact: true }).first().click();
  const drawer = page.getByRole('dialog', { name: '库存', exact: true });
  await expect(drawer.getByText('已返回库存', { exact: true })).toBeVisible();
  await expect(drawer.getByRole('cell', { name: '0', exact: true })).toBeVisible();
  await drawer.getByRole('combobox').first().selectOption('sku');
  await expect(drawer.getByText('已返回库存', { exact: true })).toBeVisible();
  await drawer.getByRole('button', { name: '刷新库存' }).click();
  await expect(drawer.getByText('已返回库存', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await page.getByRole('button', { name: '显示列', exact: true }).click();
  await page.getByRole('checkbox', { name: '库存状态', exact: true }).check();
  await page.keyboard.press('Escape');
  await expect(page.locator('table tbody tr').first().getByText('已返回库存', { exact: true })).toBeVisible();
});

test('English dark inventory drawer remains usable on narrow screens', async ({ page }) => {
  await page.goto('/#/products');
  await page
    .getByRole('button', { name: /Switch.*English|切换.*英文|English/ })
    .first()
    .click();
  await page.evaluate(() => {
    document.documentElement.classList.add('dark');
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Inventory', exact: true }).first().click();
  const drawer = page.getByRole('dialog', { name: 'Inventory', exact: true });
  await expect(drawer.getByText('Inventory returned', { exact: true })).toBeVisible();
  await expect(drawer.getByRole('button', { name: 'Refresh inventory' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
});
