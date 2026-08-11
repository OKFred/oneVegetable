import { expect, test } from '@playwright/test';

test('web mock exposes the migrated operations workspace', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '运营总览' })).toBeVisible();
  await expect(page.getByText('OpenAPI Mock')).toBeVisible();

  await page.getByRole('button', { name: '商品' }).click();
  await expect(page.getByRole('heading', { name: '商品管理' })).toBeVisible();
  await expect(page.getByText('Portable solar power station 1000W')).toBeVisible();

  await page.getByRole('button', { name: 'API 能力' }).click();
  await expect(page.getByRole('heading', { name: 'API 能力目录' })).toBeVisible();
  await expect(page.locator('tbody tr')).toHaveCount(84);
});
