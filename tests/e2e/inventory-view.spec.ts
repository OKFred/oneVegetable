import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  // Keep concurrent worktree edits from HMR-resetting the mock regression session.
  await page.routeWebSocket(/\/.*$/u, async (socket) => {
    await socket.close();
  });
  await page.route('https://**', (route) => route.abort());
  await page.goto('/#/inventory');
  await expect(page.getByRole('heading', { name: '库存', exact: true })).toBeVisible();
});

test('inventory exposes pending-row and selected/page readonly queries without opening the row menu', async ({
  page
}) => {
  const toolbar = page.getByTestId('inventory-toolbar');
  const rows = page.locator('table tbody tr');
  await expect(rows).toHaveCount(3);
  await expect(toolbar.getByRole('button', { name: '查询本页库存', exact: true })).toBeEnabled();
  await expect(toolbar.getByRole('button', { name: '查询所选库存 (0)', exact: true })).toBeDisabled();
  await rows.first().getByRole('button', { name: '待查询 · 查询库存：商品 10000001', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: '库存', exact: true });
  await expect(drawer.getByText('已返回库存', { exact: true })).toBeVisible();
  await expect(drawer.getByRole('cell', { name: '0', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await expect(rows.first()).toContainText('已返回库存');
  await expect(rows.nth(1)).toContainText('待查询');

  await rows.nth(1).getByRole('checkbox').check();
  await toolbar.getByRole('button', { name: '查询所选库存 (1)', exact: true }).click();
  await expect(rows.nth(1)).toContainText('已返回库存');
  await expect(rows.nth(2)).toContainText('待查询');
  await toolbar.getByRole('button', { name: '查询本页库存', exact: true }).click();
  await expect(rows.nth(2)).toContainText('已返回库存');
  await expect(toolbar.getByRole('button', { name: '停止后续查询' })).toHaveCount(0);

  await toolbar.getByRole('combobox', { name: '接口来源' }).selectOption('sku');
  await expect(rows.first()).toContainText('待查询');
  await toolbar.getByRole('button', { name: '查询本页库存', exact: true }).click();
  await expect(rows.nth(2)).toContainText('已返回库存');
  await expect(page.getByText(/空记录不代表库存为 0；不同库存编码不合计/)).toBeVisible();
});

test('inventory toolbar keeps full-width search alone above right-aligned actions in Chinese and narrow English', async ({
  page
}) => {
  const toolbar = page.getByTestId('inventory-toolbar');
  const searchRow = toolbar.locator('[data-slot="list-toolbar-search"]');
  const actions = toolbar.locator('[data-slot="list-toolbar-actions"]');
  for (const narrow of [false, true]) {
    if (narrow) {
      await page
        .getByRole('button', { name: /Switch.*English|切换.*英文|English/ })
        .first()
        .click();
      await page.evaluate(() => {
        document.documentElement.classList.add('dark');
      });
      await page.setViewportSize({ width: 390, height: 844 });
    }
    const search = searchRow.getByRole('button', { name: narrow ? 'Search' : '搜索', exact: true });
    const filters = actions.getByRole('button', { name: narrow ? 'Filters' : '筛选', exact: true });
    await expect(searchRow.getByRole('button')).toHaveCount(1);
    await expect(searchRow.getByRole('textbox')).toBeVisible();
    await expect(search).toBeVisible();
    await expect(filters).toBeVisible();
    await expect(
      actions.getByRole('button', { name: narrow ? 'Query page inventory' : '查询本页库存', exact: true })
    ).toBeVisible();
    const formBox = await searchRow.boundingBox();
    const inputBox = await searchRow.getByRole('textbox').boundingBox();
    const searchBox = await search.boundingBox();
    const actionsBox = await actions.boundingBox();
    const filtersBox = await filters.boundingBox();
    if (!formBox || !inputBox || !searchBox || !actionsBox || !filtersBox)
      throw new Error('Missing inventory toolbar layout');
    expect(Math.abs(inputBox.width + searchBox.width + 8 - formBox.width)).toBeLessThan(2);
    expect(Math.abs(inputBox.y - searchBox.y)).toBeLessThan(2);
    expect(actionsBox.y).toBeGreaterThanOrEqual(formBox.y + formBox.height);
    expect(Math.abs(filtersBox.x + filtersBox.width - formBox.x - formBox.width)).toBeLessThan(2);
    if (narrow) expect(formBox.x + formBox.width).toBeLessThanOrEqual(390);
  }
  await page
    .getByRole('button', { name: 'Not queried · Query inventory: product 10000001', exact: true })
    .click();
  await expect(
    page
      .getByRole('dialog', { name: 'Inventory', exact: true })
      .getByText('Inventory returned', { exact: true })
  ).toBeVisible();
});

test('inventory search clears selected rows and disables queries on an empty page', async ({ page }) => {
  const toolbar = page.getByTestId('inventory-toolbar');
  await page.locator('table tbody tr').first().getByRole('checkbox').check();
  await expect(toolbar.getByRole('button', { name: '查询所选库存 (1)', exact: true })).toBeEnabled();
  await toolbar.getByRole('textbox').fill('no-inventory-product-match');
  await toolbar.getByRole('button', { name: '搜索', exact: true }).click();
  await expect(toolbar.getByRole('button', { name: '查询所选库存 (0)', exact: true })).toBeDisabled();
  await expect(toolbar.getByRole('button', { name: '查询本页库存', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: /待查询 · 查询库存/ })).toHaveCount(0);
});
