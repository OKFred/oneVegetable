import { test, expect } from '@playwright/test';
test('video route, explicit search, playback fallback, related products and columns', async ({ page }) => {
  await page.route('https://cloud.video.taobao.com/**', (route) => route.abort());
  await page.goto('/#/photos/videos');
  const library = page.getByTestId('video-library');
  const toolbar = library.getByTestId('video-toolbar');
  await expect(toolbar.getByRole('button', { name: '刷新', exact: true })).toHaveCount(0);
  await expect(toolbar.locator('form').getByRole('button', { name: '搜索', exact: true })).toBeVisible();
  await expect(
    toolbar.locator('[data-slot="list-toolbar-actions"]').getByRole('button', { name: /^筛选/ })
  ).toBeVisible();
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
  await expect.poll(async () => (await drawer.boundingBox())?.x).toBe(0);
  const bounds = await drawer.boundingBox();
  expect(bounds?.x).toBe(0);
  expect(bounds?.y).toBe(0);
  expect(bounds?.width).toBe(page.viewportSize()?.width);
  expect(bounds?.height).toBe(page.viewportSize()?.height);
  await expect(drawer.locator('video')).toHaveAttribute('preload', 'none');
  await expect(drawer.locator('video')).not.toHaveAttribute('autoplay');
  await expect(drawer.getByRole('button', { name: '关联商品', exact: true })).toHaveCount(0);
  const media = await drawer.locator('video').elementHandle();
  await drawer.locator('video').dispatchEvent('error', { bubbles: false, cancelable: false });
  await expect(
    drawer.getByText('此视频暂时无法播放。可重试，或使用右上角外链按钮核对原视频。')
  ).toBeVisible();
  await expect(drawer.getByRole('link', { name: '在新标签页打开原始素材' })).toHaveAttribute(
    'target',
    '_blank'
  );
  await expect(drawer.getByRole('link', { name: '在新标签页打开原始素材' })).toHaveAttribute(
    'rel',
    'noopener noreferrer'
  );
  await expect(drawer.getByText('官方视频库', { exact: true })).toHaveCount(0);
  await drawer.getByRole('button', { name: '素材信息', exact: true }).click();
  await expect(drawer.getByTestId('media-information')).toBeVisible();
  await drawer.getByRole('button', { name: '关联商品', exact: true }).click();
  await expect(drawer.getByText('Example clothing', { exact: true })).toBeVisible();
  await drawer.getByRole('button', { name: '详情关联', exact: true }).click();
  await expect(drawer.getByText('当前类型未返回关联商品')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  expect(
    await media.evaluate((video) => ({
      paused: (video as HTMLVideoElement).paused,
      src: video.getAttribute('src')
    }))
  ).toEqual({ paused: true, src: null });
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
  const searchGroup = page.getByTestId('video-toolbar').locator('form');
  const searchBounds = await searchGroup.boundingBox();
  expect(searchBounds).not.toBeNull();
  if (!searchBounds) throw new Error('Missing video search group');
  expect(searchBounds.x + searchBounds.width).toBeLessThanOrEqual(390);
  await expect(searchGroup.getByRole('button', { name: 'Search', exact: true })).toBeVisible();
  await expect(page.getByTestId('video-toolbar').getByRole('button', { name: /^Filter/ })).toBeVisible();
  await page.getByRole('button', { name: 'View: Example unlinked video', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Example unlinked video', exact: true });
  await expect(dialog.getByText('No safe playback URL returned')).toBeVisible();
  await expect(dialog.getByRole('link', { name: 'Open original asset in a new tab' })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Asset information', exact: true }).click();
  await expect(dialog.getByTestId('media-information')).toBeVisible();
  const bounds = await dialog.boundingBox();
  expect(bounds?.width).toBe(390);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});

test('video advanced filters use a draft and explicit apply, with list actions in a menu', async ({
  page
}) => {
  await page.goto('/#/photos/videos');
  const library = page.getByTestId('video-library');
  const clothing = library.getByRole('button', { name: '查看: Example clothing video', exact: true });
  await expect(clothing).toBeVisible();
  await library.getByRole('button', { name: /^筛选/ }).click();
  const filter = page.getByRole('dialog', { name: '筛选', exact: true });
  await filter.getByRole('combobox', { name: '关联商品', exact: true }).selectOption('no');
  await filter.getByRole('button', { name: '取消', exact: true }).click();
  await expect(clothing).toBeVisible();
  await library.getByRole('button', { name: /^筛选/ }).click();
  await expect(filter.getByRole('combobox', { name: '关联商品', exact: true })).toHaveValue('all');
  await filter.getByRole('combobox', { name: '关联商品', exact: true }).selectOption('no');
  await filter.getByRole('button', { name: '应用筛选', exact: true }).click();
  await expect(clothing).toHaveCount(0);
  await expect(
    library.getByRole('button', { name: '查看: Example unlinked video', exact: true })
  ).toBeVisible();
  await expect(library.getByRole('button', { name: /^筛选/ })).toContainText('1');
  await library.getByRole('button', { name: '列表', exact: true }).click();
  await expect(library.getByRole('checkbox').first()).toBeVisible();
  await expect(library.getByRole('button', { name: '查看', exact: true })).toHaveCount(0);
  await library
    .getByRole('button', { name: /的操作$/u })
    .first()
    .click();
  await page.getByRole('button', { name: '查看', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Example unlinked video', exact: true })).toBeVisible();
});
