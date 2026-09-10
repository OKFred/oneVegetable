import { expect, test } from '@playwright/test';

test('product action link and per-table column preferences persist without changing selection', async ({
  page
}) => {
  await page.goto('/#/products');
  const table = page.locator('table').first();
  await expect(table.getByRole('link', { name: '链接', exact: true }).first()).toHaveAttribute(
    'href',
    /https:\/\/www\.alibaba\.com\/product-detail\//
  );
  await expect(table.getByRole('link', { name: '链接', exact: true }).first()).toHaveAttribute(
    'rel',
    'noopener noreferrer'
  );
  const actionCell = table.locator('tbody tr').first().locator('td').last();
  await expect(actionCell).toHaveText('链接编辑');
  const widths = await table.evaluate((element) => ({
    table: element.getBoundingClientRect().width,
    product: element.querySelector('tbody tr td:nth-child(3)')?.getBoundingClientRect().width ?? Infinity
  }));
  expect(widths.product).toBeLessThanOrEqual(widths.table * 0.4);
  await page.getByRole('button', { name: '显示列', exact: true }).click();
  await page.getByRole('textbox', { name: '搜索列', exact: true }).fill('关键词');
  await page.getByRole('checkbox', { name: '关键词', exact: true }).check();
  await page.keyboard.press('Escape');
  await expect(table.getByRole('columnheader', { name: '关键词', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('columnheader', { name: '关键词', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '加载本页扩展信息', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '停止', exact: true })).toHaveCount(0, { timeout: 15_000 });
  await expect(table.getByText(/\d(?:\.\d)?\/6/).first()).toBeVisible();
  await page.getByRole('link', { name: '图库', exact: true }).click();
  await page.getByRole('button', { name: '列表', exact: true }).click();
  await page.getByRole('button', { name: '显示列', exact: true }).click();
  await page.getByRole('checkbox', { name: '原始文件名', exact: true }).check();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('columnheader', { name: '原始文件名', exact: true })).toBeVisible();
  await page.getByRole('link', { name: '订单', exact: true }).click();
  await page.getByRole('button', { name: '显示列', exact: true }).click();
  await page.getByRole('checkbox', { name: '已付金额', exact: true }).check();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('columnheader', { name: '已付金额', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '加载本页扩展信息', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '停止', exact: true })).toHaveCount(0, { timeout: 15_000 });
  await page.getByRole('button', { name: '显示列', exact: true }).click();
  await page.getByRole('button', { name: '恢复默认', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('columnheader', { name: '已付金额', exact: true })).toHaveCount(0);
});

test('English column picker remains readable in dark mode and hiding images preserves pinned columns', async ({
  page
}) => {
  await page.goto('/#/products');
  await page.evaluate(() => {
    document.documentElement.classList.add('dark');
  });
  await page.getByRole('button', { name: '显示列', exact: true }).click();
  await page.getByRole('checkbox', { name: '图片', exact: true }).uncheck();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('columnheader', { name: '图片', exact: true })).toHaveCount(0);
  await expect(page.locator('table tbody tr').first().locator('td').first()).toHaveCSS('left', '0px');
  await page
    .getByRole('button', { name: /Switch.*English|切换.*英文|English/ })
    .first()
    .click();
  await page.getByRole('button', { name: 'Columns', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Search columns', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reset defaults', exact: true })).toBeVisible();
});
