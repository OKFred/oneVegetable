import { expect, test } from '@playwright/test';

test('batch maintenance previews, confirms only selected records and keeps receipts without restoring rules', async ({
  page
}) => {
  test.setTimeout(60_000);
  await page.addInitScript(() => {
    localStorage.setItem(
      'one-vegetable:preferences:v2',
      JSON.stringify({ uiLocale: 'zh-CN', alibabaLanguage: 'en_US', theme: 'dark' })
    );
  });
  await page.goto('/#/products');
  await expect(page.getByRole('heading', { name: '商品管理', exact: true })).toBeVisible();
  await page.getByRole('checkbox', { name: /^选择本页全部/u }).check();
  await page.getByRole('button', { name: '更多', exact: true }).click();
  await page.getByRole('menuitem', { name: '批量维护', exact: true }).click();
  await expect(page.getByTestId('product-batch-maintenance')).toBeVisible();
  await page.getByTestId('product-batch-maintenance').locator('select').selectOption('append');
  await page.getByLabel('关键词 1', { exact: true }).fill('Linen');
  await page.getByRole('button', { name: '预览差异', exact: true }).click();
  const rows = page.getByTestId('product-batch-maintenance').locator('input[type=checkbox][value]');
  await expect(rows.first()).toBeEnabled();
  const count = await rows.count();
  expect(count).toBeGreaterThan(0);
  for (let index = 1; index < count; index++) await rows.nth(index).uncheck();
  await page.getByRole('button', { name: '确认执行', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('实际提交 1 件');
  await page.getByRole('dialog').getByRole('button', { name: '确认', exact: true }).click();
  await expect(page.getByText('回读已确认', { exact: true })).toBeVisible({ timeout: 25_000 });
  await page.getByRole('button', { name: '查看任务', exact: true }).click();
  await expect(page.getByRole('button', { name: /批次 / }).first()).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('product-batch-maintenance')).toHaveCount(0);
});
