import { expect, test } from '@playwright/test';

test('sales and purchase lists isolate selection and drawers without purchase write workspaces', async ({
  page
}) => {
  await page.goto('/#/orders');
  const roles = page.getByTestId('order-role-tabs');
  await expect(roles.getByRole('button', { name: '销售订单', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  const table = page.locator('table').first();
  await expect(table.locator('tbody tr').first()).toBeVisible();
  await table.locator('tbody tr').first().getByRole('checkbox').check();
  await expect(page.getByText('已选 1 个', { exact: true })).toBeVisible();
  await roles.getByRole('button', { name: '采购订单', exact: true }).click();
  await expect(roles.getByRole('button', { name: '采购订单', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await expect(page.getByRole('button', { name: '信保订单草稿', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '资金与履约', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '地址 Schema', exact: true })).toHaveCount(0);
  await expect(page.getByTestId('order-toolbar').getByRole('textbox')).toHaveCount(0);
  await expect(table.locator('tbody tr').first().getByRole('checkbox')).not.toBeChecked();
  await table.locator('tbody tr').first().locator('td').nth(1).click();
  const drawer = page.getByRole('dialog');
  await expect(drawer).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await roles.getByRole('button', { name: '销售订单', exact: true }).click();
  await expect(page.getByRole('button', { name: '信保订单草稿', exact: true })).toBeVisible();
  await expect(page.getByTestId('order-toolbar').getByRole('textbox')).toBeEnabled();
});

test('purchase role survives live UI-language switching in dark and narrow layouts', async ({ page }) => {
  await page.goto('/#/orders');
  await page.getByTestId('order-role-tabs').getByRole('button', { name: '采购订单', exact: true }).click();
  await page.evaluate(() => {
    document.documentElement.classList.add('dark');
  });
  await page.getByTestId('language-toggle').click();
  const roles = page.getByTestId('order-role-tabs');
  await expect(roles.getByRole('button', { name: 'Purchase orders', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await expect(page.getByRole('button', { name: 'Trade Assurance order draft', exact: true })).toHaveCount(0);
  await page.setViewportSize({ width: 480, height: 850 });
  await expect(roles.getByRole('button', { name: 'Purchase orders', exact: true })).toBeInViewport();
  await expect(page.getByTestId('order-toolbar').getByRole('textbox')).toHaveCount(0);
  await expect(roles).not.toHaveCSS('color', 'rgba(0, 0, 0, 0)');
  await page.reload();
  await expect(roles.getByRole('button', { name: 'Sales orders', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
});
