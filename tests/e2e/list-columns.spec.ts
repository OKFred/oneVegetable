import { expect, test, type Page } from '@playwright/test';

async function openColumns(page: Page, label = '显示列', search = '搜索列') {
  await page.locator('table').first().getByRole('button', { name: label, exact: true }).click();
  const picker = page
    .getByRole('dialog')
    .filter({ has: page.getByRole('textbox', { name: search, exact: true }) });
  await expect(picker).toBeVisible();
  await expect(picker.getByRole('textbox', { name: search, exact: true })).toBeInViewport();
  return picker;
}

for (const scenario of [
  { key: 'products', route: '/#/products', first: '图片', second: '商品', extra: '关键词' },
  { key: 'photos', route: '/#/photos', first: '图片', second: '名称', extra: '原始文件名' },
  { key: 'orders', route: '/#/orders', first: '订单号', second: '买家登录名', extra: '已付金额' }
] as const) {
  test(`${scenario.key}: tri-state all columns, ordering and local preferences preserve only fixed anchors`, async ({
    page
  }) => {
    await page.goto(scenario.route);
    if (scenario.key === 'photos') await page.getByRole('button', { name: '列表', exact: true }).click();
    const table = page.locator('table').first();
    await expect(table.locator('tbody tr').first().getByRole('checkbox')).toBeVisible();
    await table.locator('tbody tr').first().getByRole('checkbox').check();
    const picker = await openColumns(page);
    const all = picker.getByRole('checkbox', { name: '全选可选列', exact: true });
    await expect(all).toHaveAttribute('aria-checked', 'mixed');
    await expect(all).toHaveJSProperty('indeterminate', true);
    await picker.getByRole('textbox', { name: '搜索列', exact: true }).fill(scenario.extra);
    await all.check();
    await expect(all).toBeChecked();
    await picker.getByRole('textbox', { name: '搜索列', exact: true }).fill('');
    for (const checkbox of await picker.getByRole('checkbox').all()) await expect(checkbox).toBeChecked();
    await expect(all).toBeInViewport();
    await all.uncheck();
    for (const label of ['选择', '操作']) {
      await expect(picker.getByRole('checkbox', { name: label, exact: true })).toBeChecked();
      await expect(picker.getByRole('checkbox', { name: label, exact: true })).toBeDisabled();
      await expect(picker.getByRole('button', { name: `上移${label}`, exact: true })).toHaveCount(0);
    }
    await expect(table.getByRole('columnheader')).toHaveCount(2);
    for (const label of [scenario.first, scenario.second, scenario.extra]) {
      await picker.getByRole('checkbox', { name: label, exact: true }).check();
    }
    await picker.getByRole('button', { name: `上移${scenario.second}`, exact: true }).click();
    await expect(all).toHaveAttribute('aria-checked', 'mixed');
    await page.keyboard.press('Escape');
    await expect(table.getByRole('columnheader').nth(1)).toHaveText(scenario.second);
    await expect(table.getByRole('columnheader').nth(2)).toHaveText(scenario.first);
    await expect(table.getByRole('columnheader').first()).toHaveCSS('left', '0px');
    await expect(table.getByRole('columnheader').last()).toHaveCSS('right', '0px');
    await expect(
      page.getByText(scenario.key === 'photos' ? '已选 1 张' : '已选 1 个', { exact: true })
    ).toBeVisible();
    await expect(table.getByRole('columnheader', { name: scenario.extra, exact: true })).toBeVisible();
    const saved = await page.evaluate(
      (key) => JSON.parse(localStorage.getItem(`one-vegetable:columns:v2:${key}`) ?? 'null') as unknown,
      scenario.key
    );
    expect(saved).toMatchObject({ version: 2 });
    await page.reload();
    if (scenario.key === 'photos') await page.getByRole('button', { name: '列表', exact: true }).click();
    await expect(table.getByRole('columnheader').nth(1)).toHaveText(scenario.second);
    await expect(table.getByRole('columnheader').nth(2)).toHaveText(scenario.first);
    await expect(table.getByRole('columnheader', { name: scenario.extra, exact: true })).toBeVisible();
    await expect(
      page.getByText(scenario.key === 'photos' ? '已选 0 张' : '已选 0 个', { exact: true })
    ).toBeVisible();
    const reopened = await openColumns(page);
    await reopened.getByRole('button', { name: '恢复默认', exact: true }).click();
    await page.keyboard.press('Escape');
    await expect(table.getByRole('columnheader', { name: scenario.extra, exact: true })).toHaveCount(0);
    await expect(table.getByRole('columnheader').nth(1)).toHaveText(scenario.first);
  });
}

test('product link lives inside the row action menu and title width remains bounded', async ({ page }) => {
  await page.goto('/#/products');
  const table = page.locator('table').first();
  await expect(page.getByRole('link', { name: '链接', exact: true })).toHaveCount(0);
  await table.locator('tbody tr').first().locator('td').last().getByRole('button').click();
  const link = page.getByRole('link', { name: '链接', exact: true });
  await expect(link).toHaveAttribute('href', /https:\/\/www\.alibaba\.com\/product-detail\//);
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(page.getByRole('button', { name: '编辑', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  const picker = await openColumns(page);
  const all = picker.getByRole('checkbox', { name: '全选可选列', exact: true });
  await all.check();
  await all.uncheck();
  await picker.getByRole('checkbox', { name: '商品', exact: true }).check();
  await page.keyboard.press('Escape');
  for (const viewport of [
    { width: 1600, height: 900 },
    { width: 768, height: 900 }
  ]) {
    await page.setViewportSize(viewport);
    const widths = await table.evaluate((element) => ({
      table: element.getBoundingClientRect().width,
      product: element.querySelector('tbody tr td:nth-child(2)')?.getBoundingClientRect().width ?? Infinity
    }));
    expect(widths.product).toBeLessThanOrEqual(widths.table * 0.4 + 1);
  }
});

test('legacy column choices migrate to V2 and unknown column IDs are discarded', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'one-vegetable:columns:v1:products',
      JSON.stringify({ version: 1, visible: ['subject', 'keywords', 'removed-field'] })
    );
  });
  await page.goto('/#/products');
  const table = page.locator('table').first();
  await expect(table.getByRole('columnheader', { name: '关键词', exact: true })).toBeVisible();
  await expect(table.getByRole('columnheader', { name: '图片', exact: true })).toHaveCount(0);
  const stored = await page.evaluate(() => ({
    current: JSON.parse(localStorage.getItem('one-vegetable:columns:v2:products') ?? 'null') as unknown,
    legacy: localStorage.getItem('one-vegetable:columns:v1:products')
  }));
  expect(stored.current).toMatchObject({ version: 2, visible: ['select', 'subject', 'keywords', 'actions'] });
  expect(JSON.stringify(stored.current)).not.toContain('removed-field');
  expect(stored.legacy).toBeNull();
});

test('English dark column settings remain readable and fixed anchors survive hiding images', async ({
  page
}) => {
  await page.goto('/#/products');
  await page.evaluate(() => {
    document.documentElement.classList.add('dark');
  });
  const picker = await openColumns(page);
  await picker.getByRole('checkbox', { name: '图片', exact: true }).uncheck();
  await page.keyboard.press('Escape');
  await page.getByTestId('language-toggle').click();
  const table = page.locator('table').first();
  await expect(table.getByRole('columnheader', { name: 'Image', exact: true })).toHaveCount(0);
  await expect(table.getByRole('columnheader').first()).toHaveCSS('left', '0px');
  await expect(table.getByRole('columnheader').last()).toHaveCSS('right', '0px');
  const englishPicker = await openColumns(page, 'Columns', 'Search columns');
  await expect(englishPicker.getByRole('button', { name: 'Reset defaults', exact: true })).toBeVisible();
  await expect(
    englishPicker.getByRole('checkbox', { name: 'Select all optional columns', exact: true })
  ).toHaveAttribute('aria-checked', 'mixed');
  await expect(englishPicker).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  const colors = await englishPicker.evaluate((element) => ({
    background: getComputedStyle(element).backgroundColor,
    foreground: getComputedStyle(element).color
  }));
  expect(colors.foreground).not.toBe(colors.background);
});

for (const viewport of [
  { width: 1280, height: 520 },
  { width: 390, height: 640 }
]) {
  test(`column search, select-all and reset stay reachable at ${viewport.width}x${viewport.height}`, async ({
    page
  }) => {
    await page.setViewportSize(viewport);
    await page.goto('/#/products');
    const picker = await openColumns(page);
    const search = picker.getByRole('textbox', { name: '搜索列', exact: true });
    const all = picker.getByRole('checkbox', { name: '全选可选列', exact: true });
    const reset = picker.getByRole('button', { name: '恢复默认', exact: true });
    for (const control of [search, all, reset]) await expect(control).toBeInViewport({ ratio: 0.99 });

    // A long list scrolls internally, without pushing either toolbar out of view.
    await picker.getByRole('checkbox', { name: '操作', exact: true }).scrollIntoViewIfNeeded();
    for (const control of [search, all, reset]) await expect(control).toBeInViewport({ ratio: 0.99 });
    await all.check();
    await expect(all).toBeChecked();
    await reset.click();
    await expect(all).toHaveAttribute('aria-checked', 'mixed');
    const bounds = await picker.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds?.y).toBeGreaterThanOrEqual(7);
    expect((bounds?.y ?? Infinity) + (bounds?.height ?? Infinity)).toBeLessThanOrEqual(viewport.height - 7);
    await page.keyboard.press('Escape');
    await expect(picker).toHaveCount(0);
  });
}
