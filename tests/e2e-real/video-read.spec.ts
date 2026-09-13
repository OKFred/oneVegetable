import { expect, test } from '@playwright/test';
import { atomicWriteJson } from '../../scripts/openapi-auth/storage';
import auth from '../../mock/data/video/local-auth.json' with { type: 'json' };
test('real Node BFF video list, relations and native playback', async ({ page }) => {
  const reports: Record<string, unknown>[] = [];
  await page.goto('/#/photos/videos');
  await expect(page.getByRole('heading', { name: '登录运营工作台' })).toBeVisible();
  await page.getByRole('button', { name: '初始化管理员' }).click();
  await page.getByLabel('管理员引导令牌').fill(auth.bootstrapToken);
  await page.getByLabel('工作台用户名').fill(auth.username);
  await page.getByLabel('工作台密码').fill(auth.password);
  await page.getByRole('button', { name: '创建管理员' }).click();
  const guide = page.getByRole('dialog', { name: '四步连接 Alibaba 开放平台' });
  await guide.getByRole('checkbox').check();
  await guide.getByRole('button', { name: '稍后，仅浏览' }).click();
  await page.goto('/#/photos/videos');
  const library = page.getByTestId('video-library');
  await expect(library.getByRole('button', { name: /查看:/ }).first()).toBeVisible({ timeout: 30000 });
  await library.getByRole('button', { name: /查看:/ }).nth(1).click();
  const dialog = page.getByRole('dialog');
  const media = dialog.locator('video');
  await expect(media).toHaveAttribute('preload', 'none');
  const playback = await media.evaluate(async (element) => {
    const video = element as HTMLVideoElement;
    try {
      await Promise.race([
        video.play(),
        new Promise<never>((_, reject) =>
          globalThis.setTimeout(() => {
            reject(new Error('timeout'));
          }, 15000)
        )
      ]);
    } catch {
      /* Persist playback failure independently of API success. */
    }
    return {
      readyState: video.readyState,
      duration: Number.isFinite(video.duration) ? video.duration : null,
      error: video.error?.code ?? null,
      paused: video.paused,
      origin: video.currentSrc ? new URL(video.currentSrc).origin : null
    };
  });
  reports.push({ stage: 'web-native-playback', ...playback });
  await page.keyboard.press('Escape');
  await library.getByRole('button', { name: /查看:/ }).first().click();
  await dialog.getByRole('button', { name: '关联商品', exact: true }).click();
  await expect(dialog.getByText('当前类型未返回关联商品')).toBeVisible();
  await dialog.getByRole('button', { name: '详情关联', exact: true }).click();
  await expect(dialog.getByRole('link', { name: '商品链接', exact: true })).toBeVisible({ timeout: 30000 });
  reports.push({ stage: 'web-related-product', linked: true });
  await page.screenshot({ path: 'artifacts/video-read-validation/web-related.png' });
  await page.keyboard.press('Escape');
  await expect(page.locator('video')).toHaveCount(0);
  await atomicWriteJson('artifacts/video-read-validation/web-report.json', {
    capturedAtUtc: new Date().toISOString(),
    readOnly: true,
    reports
  });
});
