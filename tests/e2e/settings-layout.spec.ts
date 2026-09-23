import { expect, test } from '@playwright/test';

test('settings sections keep edits, support keyboard navigation and fit both languages on narrow screens', async ({
  page
}, testInfo) => {
  await page.goto('/#/settings');
  const nav = page.getByRole('navigation', { name: '设置', exact: true });
  const credentials = page.locator('#settings-credentials');
  const preferences = page.locator('#settings-preferences');
  await expect(credentials).toBeVisible();
  await expect(preferences).toBeHidden();
  await page.getByLabel('App Key', { exact: true }).fill('layout-check');
  await nav.getByRole('button', { name: '连接与语言', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(preferences).toBeVisible();
  await expect(credentials).toBeHidden();
  const language = await page.getByLabel('平台请求语言').inputValue();
  await page.getByTestId('language-toggle').click();
  await expect(page.getByLabel('Platform request language')).toHaveValue(language);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'API credentials', exact: true }).click();
  await expect(page.getByRole('button', { name: 'API credentials', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await expect(page.getByLabel('App Key', { exact: true })).toHaveValue('layout-check');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.screenshot({ path: testInfo.outputPath('settings-en-dark.png'), animations: 'disabled' });

  for (const width of [390, 768]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(page.getByRole('button', { name: 'Diagnostics & data', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole('button', { name: 'Diagnostics & data', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Redacted diagnostics', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`settings-en-dark-${width}.png`),
      animations: 'disabled'
    });
  }
  await page.getByTestId('language-toggle').click();
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.getByRole('heading', { name: '脱敏诊断', exact: true })).toBeVisible();
  await expect(page.locator('html')).not.toHaveClass(/dark/);
  await page.screenshot({
    path: testInfo.outputPath('settings-zh-light-mobile.png'),
    animations: 'disabled'
  });
});
