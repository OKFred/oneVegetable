import { expect, test } from '@playwright/test';

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
