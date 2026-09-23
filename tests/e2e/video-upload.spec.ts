import { test, expect, type Page } from '@playwright/test';
import fixture from '../../mock/data/video/upload.json' with { type: 'json' };
import { createVideoUploadHarness } from './helpers/video-upload-harness';

const PART_BYTES = 5 * 1024 * 1024;

async function openUpload(page: Page) {
  await page.getByTestId('video-library').getByRole('button', { name: '上传', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '上传视频与任务记录', exact: true });
  await expect(dialog.getByRole('button', { name: '刷新任务记录', exact: true })).toBeEnabled();
  return dialog;
}
async function confirm(page: Page) {
  const confirmation = page.getByRole('dialog', { name: '确认视频操作', exact: true });
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole('button', { name: '确认', exact: true }).click();
}
test.beforeEach(async ({ page }) => {
  // A test-only driver handles every upload command. Never contact a platform or object store.
  await page.route(/^https:\/\//u, (route) => route.abort());
});

test('offline URL upload requires two confirmations and never resumes platform submission after reload', async ({
  page
}) => {
  const harness = createVideoUploadHarness();
  await harness.bind(page);
  await page.goto('/#/photos/videos');
  await harness.install(page);
  let dialog = await openUpload(page);
  await dialog.getByRole('textbox', { name: '视频标题', exact: true }).fill('Offline URL fixture');
  await dialog.getByRole('combobox', { name: '视频来源', exact: true }).selectOption('url');
  await dialog.locator('input[type="url"]').fill(fixture.sourceUrl);
  await dialog.getByRole('button', { name: '准备任务', exact: true }).click();
  expect(harness.commands.map((command) => command.action)).toEqual(['list']);
  await confirm(page);
  await expect(dialog.getByText('待开始', { exact: true })).toBeVisible();
  expect(harness.uploaded).toHaveLength(0);
  const task = [...harness.records.values()][0]?.task;
  expect(task).toBeDefined();
  await page.reload();
  await harness.install(page);
  dialog = await openUpload(page);
  await dialog.getByRole('combobox', { name: '已有任务（手动恢复）' }).selectOption(task?.id ?? '');
  await expect(dialog.locator('input[type="url"]')).toHaveValue('');
  await expect(dialog.getByRole('button', { name: '提交至 Alibaba', exact: true })).toBeDisabled();
  expect(harness.uploaded).toHaveLength(0);
  await dialog.locator('input[type="url"]').fill(fixture.sourceUrl);
  await dialog.getByRole('button', { name: '提交至 Alibaba', exact: true }).click();
  await page
    .getByRole('dialog', { name: '确认视频操作', exact: true })
    .getByRole('button', { name: '取消', exact: true })
    .click();
  expect(harness.uploaded).toHaveLength(0);
  await dialog.getByRole('button', { name: '提交至 Alibaba', exact: true }).click();
  await confirm(page);
  await expect(dialog.getByText('平台已受理，待回读', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  expect(harness.uploaded).toHaveLength(1);
  await page.reload();
  await harness.install(page);
  dialog = await openUpload(page);
  await dialog.getByRole('combobox', { name: '已有任务（手动恢复）' }).selectOption(task?.id ?? '');
  expect(harness.commands.filter((command) => command.action === 'submit')).toHaveLength(1);
  expect(harness.commands.filter((command) => command.action === 'verify')).toHaveLength(0);
  await dialog.getByRole('button', { name: '核对平台结果', exact: true }).click();
  await expect(dialog.getByText('平台回读已确认', { exact: true })).toBeVisible();
  expect(harness.uploaded).toHaveLength(1);
  expect(JSON.stringify([...harness.records.values()])).not.toContain(fixture.sourceUrl);
});

test('offline MP4 multipart stops on close, verifies original fingerprint and resumes only missing parts', async ({
  page
}) => {
  test.setTimeout(60_000);
  const harness = createVideoUploadHarness();
  await harness.bind(page);
  await page.goto('/#/photos/videos');
  await harness.install(page);
  let dialog = await openUpload(page);
  const bytes = Buffer.alloc(PART_BYTES + 24);
  Buffer.from(fixture.mp4Base64, 'base64').copy(bytes);
  const file = { name: 'fixture.mp4', mimeType: 'video/mp4', buffer: bytes };
  await dialog.getByRole('textbox', { name: '视频标题', exact: true }).fill('Offline multipart fixture');
  await dialog.locator('input[type="file"]').setInputFiles(file);
  await expect(dialog.getByText(/文件指纹已核对/u)).toBeVisible();
  const hold = harness.holdNextPart();
  await dialog.getByRole('button', { name: '准备任务', exact: true }).click();
  expect(harness.commands.map((command) => command.action)).toEqual(['list']);
  await confirm(page);
  await hold.waiting;
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  hold.release();
  await expect.poll(() => [...harness.records.values()][0]?.task.parts[0]?.status).toBe('confirmed');
  expect(harness.commands.filter((command) => command.action === 'part')).toEqual([
    { action: 'part', partNumber: 1, bytes: PART_BYTES }
  ]);
  const taskId = [...harness.records.keys()][0] ?? '';
  await page.reload();
  await harness.install(page);
  dialog = await openUpload(page);
  await dialog.getByRole('combobox', { name: '已有任务（手动恢复）' }).selectOption(taskId);
  await expect(dialog.getByRole('button', { name: '继续 S3 暂存', exact: true })).toBeDisabled();
  expect(harness.commands.filter((command) => command.action === 'part')).toHaveLength(1);
  await dialog
    .locator('input[type="file"]')
    .setInputFiles({ ...file, buffer: Buffer.from(fixture.mp4Base64, 'base64') });
  await expect(dialog.getByText('文件与原任务指纹不一致。请重新选择原文件，未继续上传。')).toBeVisible();
  await dialog.locator('input[type="file"]').setInputFiles(file);
  await expect(dialog.getByText(/文件指纹已核对/u)).toBeVisible();
  await dialog.getByRole('button', { name: '继续 S3 暂存', exact: true }).click();
  await confirm(page);
  await expect(dialog.getByText('S3 已核对，待确认提交', { exact: true })).toBeVisible();
  expect(harness.commands.filter((command) => command.action === 'part')).toEqual([
    { action: 'part', partNumber: 1, bytes: PART_BYTES },
    { action: 'part', partNumber: 2, bytes: 24 }
  ]);
  expect(harness.commands.filter((command) => command.action === 'reconcile')).toHaveLength(1);
  expect(harness.uploaded).toHaveLength(0);
  expect(JSON.stringify([...harness.records.values()])).not.toContain('contentBase64');
});

test('offline disabled runtime keeps uploads gated and renders English dark task UI', async ({ page }) => {
  const harness = createVideoUploadHarness(false);
  await harness.bind(page);
  await page.goto('/#/photos/videos');
  await harness.install(page);
  await page
    .getByRole('button', { name: /Switch.*English|切换.*英文|English/u })
    .first()
    .click();
  await page.evaluate(() => {
    document.documentElement.classList.add('dark');
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByTestId('video-library').getByRole('button', { name: 'Upload', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Video uploads and tasks', exact: true });
  await expect(dialog.getByText(/S3 uploads and platform submission are disabled/u)).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Prepare task', exact: true })).toBeDisabled();
  expect(harness.commands.map((command) => command.action)).toEqual(['list']);
  const width = await dialog.evaluate((element) => element.getBoundingClientRect().width);
  expect(width).toBeLessThanOrEqual(390);
});
