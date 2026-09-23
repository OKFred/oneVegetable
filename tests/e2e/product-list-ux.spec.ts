import { expect, test } from '@playwright/test';
import { expectTwoRowToolbar } from './helpers/list-toolbar';

test('product toolbar search fills the first row while filters and actions align right below', async ({
  page
}) => {
  await page.goto('/#/products');
  const toolbar = page.getByRole('toolbar', { name: '商品列表操作', exact: true });
  await expectTwoRowToolbar(toolbar);
  await page.setViewportSize({ width: 390, height: 844 });
  await expectTwoRowToolbar(toolbar);
  await expect(toolbar.getByRole('button', { name: '筛选', exact: true })).toBeInViewport();
  await expect(toolbar.getByRole('button', { name: '新增', exact: true })).toBeInViewport();
});

for (const scenario of [
  { route: '/#/orders', toolbar: 'order-toolbar', workspace: null },
  { route: '/#/rfqs', toolbar: 'rfq-toolbar', workspace: null },
  { route: '/#/logistics', toolbar: 'logistics-toolbar', workspace: '物流订单' }
] as const) {
  test(`${scenario.toolbar} shares the full-width two-row layout`, async ({ page }) => {
    await page.goto(scenario.route);
    if (scenario.workspace) await page.getByRole('button', { name: scenario.workspace, exact: true }).click();
    const toolbar = page.getByTestId(scenario.toolbar);
    await expectTwoRowToolbar(toolbar);
    await expect(toolbar.getByRole('button', { name: '刷新', exact: true })).toHaveCount(0);
    await page.setViewportSize({ width: 390, height: 844 });
    await expectTwoRowToolbar(toolbar);
    await expect(toolbar.getByRole('button', { name: /^筛选/ })).toBeInViewport();
  });
}

test('product search submits explicitly and advanced filter edits only apply on confirmation', async ({
  page
}) => {
  await page.goto('/#/products');
  const table = page.locator('table').first();
  await expect(table.locator('tbody tr')).toHaveCount(3);
  const search = page.getByPlaceholder('按标题搜索', { exact: true });
  const searchButton = page.getByRole('button', { name: '搜索', exact: true });
  await search.fill('solar');
  await expect(table.locator('tbody tr')).toHaveCount(3);
  await searchButton.click();
  await expect(table.locator('tbody tr')).toHaveCount(1);
  await expect(table.locator('tbody tr')).toContainText('Portable solar power station');
  await search.fill('');
  await search.press('Enter');
  await expect(table.locator('tbody tr')).toHaveCount(3);

  await page.getByRole('button', { name: '筛选', exact: true }).click();
  const filters = page.getByRole('dialog', { name: '筛选', exact: true });
  await filters.getByRole('combobox', { name: '状态', exact: true }).selectOption('draft');
  await expect(table.locator('tbody tr')).toHaveCount(3);
  await filters.getByRole('button', { name: '取消', exact: true }).click();
  await expect(filters).toHaveCount(0);
  await expect(table.locator('tbody tr')).toHaveCount(3);
  await page.getByRole('button', { name: '筛选', exact: true }).click();
  await expect(filters.getByRole('combobox', { name: '状态', exact: true })).toHaveValue('');
  await filters.getByLabel('商品 ID', { exact: true }).fill('9007199254740993');
  await expect(filters.getByRole('button', { name: '应用筛选', exact: true })).toBeDisabled();
  await filters.getByLabel('商品 ID', { exact: true }).fill('');
  await filters.getByLabel('修改时间起', { exact: true }).fill('2026-09-02T12:00');
  await filters.getByLabel('修改时间止', { exact: true }).fill('2026-09-01T12:00');
  await expect(filters.getByRole('button', { name: '应用筛选', exact: true })).toBeDisabled();
  await filters.getByRole('button', { name: '重置', exact: true }).click();
  await filters.getByRole('combobox', { name: '状态', exact: true }).selectOption('draft');
  await filters.getByRole('button', { name: '应用筛选', exact: true }).click();
  await expect(filters).toHaveCount(0);
  await expect(page.getByRole('button', { name: '筛选 · 1', exact: true })).toBeVisible();
  await expect(table.locator('tbody tr')).toHaveCount(1);
  await expect(table.locator('tbody tr')).toContainText('Custom recycled cotton canvas tote bag');

  await page.getByRole('button', { name: '筛选 · 1', exact: true }).click();
  await filters.getByRole('button', { name: '重置', exact: true }).click();
  await expect(table.locator('tbody tr')).toHaveCount(1);
  await filters.getByLabel('分组 ID', { exact: true }).fill('1001');
  await filters.getByRole('button', { name: '应用筛选', exact: true }).click();
  await expect(table.locator('tbody tr')).toHaveCount(1);
  await expect(table.locator('tbody tr')).toContainText('Portable solar power station');
  await expect(page.getByRole('combobox', { name: '每页条数', exact: true }).locator('option')).toHaveText([
    '10 条',
    '20 条',
    '30 条'
  ]);
});

test('search replaces refresh and repeated conditions still refetch the product list', async ({ page }) => {
  await page.goto('/#/products');
  await expect(page.locator('table tbody tr')).toHaveCount(3);
  const toolbar = page.getByRole('toolbar', { name: '商品列表操作', exact: true });
  await expect(toolbar.getByRole('button', { name: /刷新/ })).toHaveCount(0);
  const search = toolbar.getByRole('button', { name: '搜索', exact: true });
  const pageSize = page.getByRole('combobox', { name: '每页条数', exact: true });
  await expect(pageSize).toBeEnabled();

  // Mock queries stay in memory. Observe the real pagination loading state rather
  // than relying on unchanged fixture text as evidence of a repeated request.
  await pageSize.evaluate((element) => {
    element.setAttribute('data-e2e-loading-transitions', '0');
    new MutationObserver((records) => {
      const starts = records.filter((record) => record.oldValue === null).length;
      const previous = Number(element.getAttribute('data-e2e-loading-transitions'));
      element.setAttribute('data-e2e-loading-transitions', String(previous + starts));
    }).observe(element, {
      attributes: true,
      attributeFilter: ['disabled'],
      attributeOldValue: true
    });
  });

  await search.click();
  await expect(pageSize).toHaveAttribute('data-e2e-loading-transitions', '1');
  await expect(pageSize).toBeEnabled();
  await search.click();
  await expect(pageSize).toHaveAttribute('data-e2e-loading-transitions', '2');
  await expect(pageSize).toBeEnabled();
  await toolbar.getByPlaceholder('按标题搜索', { exact: true }).press('Enter');
  await expect(pageSize).toHaveAttribute('data-e2e-loading-transitions', '3');
  await expect(pageSize).toBeEnabled();
  await expect(page.locator('table tbody tr')).toHaveCount(3);
});

test('a local status filter with no matches never claims the whole store is empty', async ({ page }) => {
  await page.goto('/#/products');
  await expect(page.locator('table tbody tr')).toHaveCount(3);
  await page.getByRole('button', { name: '筛选', exact: true }).click();
  const filters = page.getByRole('dialog', { name: '筛选', exact: true });
  await expect(filters.getByText('仅筛选本页', { exact: true })).toBeVisible();
  await filters.getByRole('combobox', { name: '状态', exact: true }).selectOption('offline');
  await filters.getByRole('button', { name: '应用筛选', exact: true }).click();
  await expect(
    page.getByText('本页没有符合筛选条件的商品；可修改筛选或查看其他页。', { exact: true })
  ).toBeVisible();
});

test('product scores wait for visible cells and render only their numeric value', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#/products');
  const table = page.locator('table').first();
  await expect(table.locator('tbody tr')).toHaveCount(3);
  const header = table.getByRole('columnheader', { name: '产品分', exact: true });
  const index = await header.evaluate((element) => (element as HTMLTableCellElement).cellIndex);
  const score = table.locator('tbody tr').first().locator('td').nth(index);
  await expect(score).toContainText('待查询');
  // Scrolling the clipped score column into view is the explicit visibility signal.
  await score.scrollIntoViewIfNeeded();
  await expect(score.locator('span.font-medium')).toHaveText('4.6', { timeout: 10_000 });
  await expect(score).not.toContainText('/6');
  await table.getByRole('button', { name: '显示列', exact: true }).click();
  const picker = page
    .getByRole('dialog')
    .filter({ has: page.getByRole('textbox', { name: '搜索列', exact: true }) });
  await picker.getByRole('checkbox', { name: '产品分', exact: true }).uncheck();
  await page.keyboard.press('Escape');
  await expect(header).toHaveCount(0);
  await table.getByRole('button', { name: '显示列', exact: true }).click();
  await picker.getByRole('checkbox', { name: '产品分', exact: true }).check();
  await page.keyboard.press('Escape');
  await score.scrollIntoViewIfNeeded();
  await expect(score.locator('span.font-medium')).toHaveText('4.6');
});
