import { test, expect } from '@playwright/test';

test('showcase drawer confirms removal and addition without changing product listing', async ({ page }) => {
  await page.goto('/#/products');
  await page.getByRole('button', { name: '更多', exact: true }).click();
  await page.getByRole('menuitem', { name: '橱窗管理', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: '橱窗管理', exact: true });
  await expect(drawer.getByText('总额度 2 · 已用 1 · 剩余 1')).toBeVisible();
  await drawer.getByRole('button', { name: '移出橱窗', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: '确认移出橱窗 1 个商品？', exact: true });
  await expect(confirmation).toBeVisible();
  await expect(drawer.getByText('总额度 2 · 已用 1 · 剩余 1')).toBeVisible();
  await confirmation.getByRole('button', { name: '确认', exact: true }).click();
  await expect(drawer.getByText('总额度 2 · 已用 0 · 剩余 2')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('checkbox', { name: '选择 Portable solar power station 1000W', exact: true }).check();
  await page.getByRole('button', { name: '更多', exact: true }).click();
  await page.getByRole('menuitem', { name: '加入橱窗', exact: true }).click();
  const add = page.getByRole('dialog', { name: '确认加入橱窗 1 个商品？', exact: true });
  await expect(add).toBeVisible();
  await add.getByRole('button', { name: '确认', exact: true }).click();
  await expect(drawer.getByText('总额度 2 · 已用 1 · 剩余 1')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '显示列', exact: true }).click();
  await page.getByRole('checkbox', { name: '橱窗', exact: true }).check();
  await page.keyboard.press('Escape');
  await expect(page.locator('table tbody tr').first().getByText('已加入', { exact: true })).toBeVisible();
  await expect(page.locator('table tbody tr').first().getByText('在线', { exact: true })).toBeVisible();
});

test('English showcase drawer supports dark mode, keyboard close and no selection', async ({ page }) => {
  await page.goto('/#/products');
  await page
    .getByRole('button', { name: /Switch.*English|切换.*英文|English/ })
    .first()
    .click();
  await page.evaluate(() => {
    document.documentElement.classList.add('dark');
  });
  await page.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Showcase', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Showcase', exact: true })).toBeVisible();
  await expect(page.getByText('Total 2 · Used 1 · Available 1')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Showcase', exact: true })).toHaveCount(0);
});
