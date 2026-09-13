import { test, expect } from '@playwright/test';
test('video route, explicit search, playback fallback, related products and columns', async ({ page }) => {
  await page.route('https://cloud.video.taobao.com/**', (route) => route.abort());
  await page.goto('/#/photos/videos');
  const library = page.getByTestId('video-library');
  await expect(
    library.getByRole('button', { name: '查看: Example clothing video', exact: true })
  ).toBeVisible();
  await library.getByRole('textbox', { name: '视频标题', exact: true }).fill('unlinked');
  await expect(
    library.getByRole('button', { name: '查看: Example clothing video', exact: true })
  ).toBeVisible();
  await library.getByRole('button', { name: '搜索', exact: true }).click();
  await expect(
    library.getByRole('button', { name: '查看: Example clothing video', exact: true })
  ).toHaveCount(0);
  await library.getByRole('textbox', { name: '视频标题', exact: true }).fill('');
  await library.getByRole('textbox', { name: '视频标题', exact: true }).press('Enter');
  await library.getByRole('button', { name: '查看: Example clothing video', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: 'Example clothing video', exact: true });
  await expect(drawer.locator('video')).toHaveAttribute('preload', 'none');
  await drawer.locator('video').evaluate(async (video) => {
    try {
      await (video as HTMLVideoElement).play();
    } catch {
      /* expected unavailable fixture */
    }
  });
  await expect(drawer.getByText('此视频暂时无法播放。可重试，或前往官方页面核对。')).toBeVisible();
  await drawer.getByRole('button', { name: '关联商品', exact: true }).click();
  await expect(drawer.getByText('Example clothing', { exact: true })).toBeVisible();
  await drawer.getByRole('button', { name: '详情关联', exact: true }).click();
  await expect(drawer.getByText('当前类型未返回关联商品')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await library.getByRole('button', { name: '列表', exact: true }).click();
  await library.getByRole('button', { name: '显示列', exact: true }).click();
  await page.getByRole('checkbox', { name: '加密视频 ID', exact: true }).check();
  await page.keyboard.press('Escape');
  await expect(library.getByRole('columnheader', { name: '加密视频 ID', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('video-library')).toBeVisible();
  await page.getByRole('link', { name: '图片', exact: true }).click();
  await expect(page).toHaveURL(/#\/photos$/);
  await page.goBack();
  await expect(page.getByTestId('video-library')).toBeVisible();
});
test('English dark mobile videos', async ({ page }) => {
  await page.goto('/#/photos/videos');
  await page
    .getByRole('button', { name: /Switch.*English|切换.*英文|English/ })
    .first()
    .click();
  await page.evaluate(() => {
    document.documentElement.classList.add('dark');
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'View: Example unlinked video', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Example unlinked video', exact: true });
  await expect(dialog.getByText('No safe playback URL returned')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});
