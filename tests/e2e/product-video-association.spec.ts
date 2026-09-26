import { expect, test } from '@playwright/test';

test('video library selects a product without the editor and requires a separate association confirmation', async ({
  page
}) => {
  await page.route(/^https:\/\//u, (route) => route.abort());
  await page.goto('/#/photos/videos');
  await page
    .getByTestId('video-library')
    .getByRole('button', { name: '用于商品', exact: true })
    .first()
    .click();
  const dialog = page.getByRole('dialog', { name: '用于商品', exact: true });
  await expect(dialog).toContainText('Example clothing video');
  await dialog.getByRole('button', { name: '选择', exact: true }).first().click();
  const section = dialog.getByTestId('product-video-association');
  await expect(section).toContainText('900001');
  await expect(section.getByRole('button', { name: '选择视频', exact: true })).toHaveCount(0);
  await expect(section.getByTestId('video-association-receipt')).toHaveCount(0);
  await section.getByTestId('associate-video').click();
  const confirmation = page.getByRole('dialog', { name: '立即关联视频', exact: true });
  await expect(confirmation).toContainText('不保存或发布编辑器');
  await confirmation.getByRole('button', { name: '取消', exact: true }).click();
  await expect(dialog).toBeVisible();
  await expect(section.getByTestId('video-association-receipt')).toHaveCount(0);
  await section.getByRole('combobox', { name: '视频用途' }).selectOption('detail');
  await section.getByTestId('associate-video').click();
  await confirmation.getByRole('button', { name: '确认', exact: true }).click();
  await expect(section.getByTestId('video-association-receipt')).toContainText('回读已确认');
  await expect(page).toHaveURL(/#\/photos\/videos$/);
});

test('English dark mobile video-to-product selection fits the dialog and can be cancelled', async ({
  page
}) => {
  await page.route(/^https:\/\//u, (route) => route.abort());
  await page.goto('/#/photos/videos');
  await page
    .getByRole('button', { name: /Switch.*English|切换.*英文|English/ })
    .first()
    .click();
  await page.evaluate(() => {
    document.documentElement.classList.add('dark');
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByTestId('video-library')
    .getByRole('button', { name: 'Use in product', exact: true })
    .first()
    .click();
  const dialog = page.getByRole('dialog', { name: 'Use in product', exact: true });
  await dialog.getByRole('button', { name: 'Select', exact: true }).first().click();
  await expect(dialog.getByTestId('video-target-product')).toBeVisible();
  const bounds = await dialog.boundingBox();
  expect(bounds).not.toBeNull();
  expect((bounds?.x ?? -1) >= 0 && (bounds?.width ?? 1000) <= 390).toBe(true);
  const overflow = await dialog.evaluate((node) => node.scrollWidth > node.clientWidth);
  expect(overflow).toBe(false);
  await dialog.getByRole('button', { name: 'Close Use in product', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      Object.keys(localStorage).some((key) => key.startsWith('one-vegetable:video-association:v1:'))
    )
  ).toBe(false);
});

test('English dark mobile video selection keeps the editor and confirmation separate', async ({ page }) => {
  await page.goto('/#/products/publisher/quick/basics/10000001/100009999');
  await page
    .getByRole('button', { name: /Switch.*English|切换.*英文|English/ })
    .first()
    .click();
  await page.evaluate(() => {
    document.documentElement.classList.add('dark');
  });
  await page.setViewportSize({ width: 390, height: 844 });
  const section = page.getByTestId('product-video-association');
  await expect(section.getByRole('heading', { name: 'Product video association' })).toBeVisible();
  await section.getByRole('button', { name: 'Choose video', exact: true }).click();
  const picker = section.getByTestId('video-picker');
  await picker.getByTestId('choose-video').first().click();
  await section.getByRole('combobox', { name: 'Video use' }).selectOption('detail');
  await section.getByTestId('associate-video').click();
  const dialog = page.getByRole('dialog', { name: 'Associate video now', exact: true });
  await expect(dialog).toContainText('It does not save or publish this editor');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(section.getByTestId('video-association-receipt')).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      Object.keys(localStorage).some((key) => key.startsWith('one-vegetable:video-association:v1:'))
    )
  ).toBe(false);
  await expect(section.getByRole('combobox', { name: 'Video use' })).toHaveValue('detail');
});

test('existing-product picker previews, confirms a separate write and restores a durable unknown receipt', async ({
  page
}) => {
  await page.goto('/#/products/publisher/quick/basics/10000001/100009999');
  const section = page.getByTestId('product-video-association');
  await expect(section).toBeVisible();
  await section.getByRole('button', { name: '选择视频', exact: true }).click();
  const picker = section.getByTestId('video-picker');
  await picker.getByRole('textbox', { name: '视频标题', exact: true }).fill('clothing');
  await picker.getByRole('button', { name: '搜索', exact: true }).click();
  await expect(picker.getByTestId('choose-video')).toHaveCount(1);
  await picker.getByRole('button', { name: '查看', exact: true }).click();
  const preview = page.getByRole('dialog', { name: 'Example clothing video', exact: true });
  await expect(preview.locator('video')).toHaveAttribute('preload', 'none');
  // Test Escape from the media itself, not the auto-focused toolbar link's tooltip.
  await preview.locator('video').focus();
  await page.keyboard.press('Escape');
  await expect(preview).toHaveCount(0);
  await picker.getByTestId('choose-video').click();
  await section.getByRole('combobox', { name: '视频用途' }).selectOption('detail');
  await section.getByTestId('associate-video').click();
  const confirmation = page.getByRole('dialog', { name: '立即关联视频', exact: true });
  await expect(confirmation).toContainText('不保存或发布编辑器');
  await confirmation.getByRole('button', { name: '确认', exact: true }).click();
  const receipt = section.getByTestId('video-association-receipt');
  await expect(receipt).toContainText('回读已确认');
  await expect(receipt).toContainText('requestId:');
  // Simulate browser interruption after write-ahead persistence, without another platform write.
  await page.evaluate(() => {
    const key = Object.keys(localStorage).find((key) =>
      key.startsWith('one-vegetable:video-association:v1:')
    );
    if (!key) throw new Error('No receipt');
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? 'null');
    if (!value || typeof value !== 'object') throw new Error('Invalid receipt');
    localStorage.setItem(key, JSON.stringify({ ...value, state: 'sending', outcome: 'unknown' }));
  });
  await page.reload();
  await expect(section.getByTestId('video-association-receipt')).toContainText('结果不明');
  await expect(section.getByTestId('associate-video')).toBeDisabled();
  await section.getByTestId('verify-video').click();
  await expect(section.getByTestId('video-association-receipt')).toContainText('回读尚未确认关联');
  await expect(section.getByTestId('associate-video')).toBeDisabled();
  await page.goto('/#/products/publisher/quick/basics/new/100009999');
  await expect(page.getByTestId('product-video-association')).toHaveCount(0);
});
