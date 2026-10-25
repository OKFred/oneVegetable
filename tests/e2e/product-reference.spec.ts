import { expect, test } from '@playwright/test';
import { productReference as zh } from '../../packages/ui/src/i18n/messages/zh-CN/productReference';
import { productReference as en } from '../../packages/ui/src/i18n/messages/en-US/productReference';

test('product reference is lazy, readonly and preserves missing values', async ({ page }) => {
  await page.goto('/#/products');
  await expect(page.getByRole('dialog', { name: zh.view, exact: true })).toHaveCount(0);
  await page.locator('table tbody tr').first().locator('td').last().getByRole('button').click();
  await page.getByRole('button', { name: zh.view, exact: true }).click();
  const drawer = page.getByRole('dialog', { name: zh.view, exact: true });
  await expect(drawer.getByText('Portable solar power station 1000W', { exact: true })).toBeVisible();
  await expect(drawer.getByText('审核通过', { exact: true })).toBeVisible();
  await expect(drawer.getByRole('button', { name: /提交|发布|保存/ })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await expect(page.locator('table tbody tr').first()).toContainText('Portable solar power station 1000W');
});

test('category assistance requires an explicit query and confirmation', async ({ page }) => {
  await page.goto('/#/products');
  await page.getByRole('button', { name: '新增', exact: true }).click();
  await page.getByRole('button', { name: zh.recommend, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: zh.assistance, exact: true });
  await expect(dialog.getByRole('button', { name: zh.confirm, exact: true })).toHaveCount(0);
  await dialog.getByRole('textbox', { name: zh.enteredTitle, exact: true }).fill('Glass cup');
  await dialog.getByRole('button', { name: zh.recommend, exact: true }).click();
  await expect(dialog.getByText('Home / Drinkware / Drinking Glasses', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: zh.confirm, exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: zh.attributes, exact: true }).click();
  await expect(dialog.getByRole('heading', { name: 'Material ID 301', exact: true })).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Color ID 302', exact: true })).toBeVisible();
  // Closing the reference is not acceptance, nor a publish/write operation.
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});

test('English dark narrow shipping reference remains searchable and readonly', async ({ page }) => {
  await page.goto('/#/logistics');
  await page
    .getByRole('button', { name: /Switch.*English|切换.*英文|English/ })
    .first()
    .click();
  await page.evaluate(() => {
    document.documentElement.classList.add('dark');
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: en.shipping, exact: true }).click();
  const drawer = page.getByRole('dialog', { name: en.shipping, exact: true });
  await expect(drawer.getByText('Standard shipping', { exact: true })).toBeVisible();
  await drawer.getByRole('textbox', { name: en.search, exact: true }).fill('Express');
  await expect(drawer.getByText('Express shipping', { exact: true })).toBeVisible();
  await expect(drawer.getByText('Standard shipping', { exact: true })).toHaveCount(0);
  await expect(drawer.getByRole('button', { name: en.copy, exact: true })).toBeVisible();
  await expect(drawer.getByRole('button', { name: /Apply|Save|Publish/ })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
});
