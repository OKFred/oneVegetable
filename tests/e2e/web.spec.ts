import { expect, test } from '@playwright/test';

test('web mock exposes the migrated operations workspace', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '运营总览' })).toBeVisible();
  await expect(page.getByText('OpenAPI Mock')).toBeVisible();

  await page.getByRole('button', { name: '商品' }).click();
  await expect(page.getByRole('heading', { name: '商品管理' })).toBeVisible();
  await expect(page.getByText('Portable solar power station 1000W')).toBeVisible();

  await page.getByRole('tab', { name: 'Schema 发品/编辑' }).click();
  await page.getByRole('button', { name: '获取 Schema' }).click();
  await expect(page.getByRole('heading', { name: '可视化商品 Schema' })).toBeVisible();
  await page.getByLabel('商品标题').fill('Portable solar generator for camping');
  await page.getByRole('button', { name: '保存草稿' }).click();
  await expect(page.getByText(/草稿已保存/)).toBeVisible();

  await page.reload();
  await page.getByRole('button', { name: '商品' }).click();
  await page.getByRole('tab', { name: 'Schema 发品/编辑' }).click();
  await expect(page.getByText('已恢复浏览器中的未提交表单草稿。')).toBeVisible();
  await expect(page.getByLabel('商品标题')).toHaveValue('Portable solar generator for camping');

  await page.getByRole('tab', { name: '类目与分组' }).click();
  await expect(page.getByText('Energy storage')).toBeVisible();
  await page.getByLabel('新分组名称').fill('E2E products');
  await page.getByRole('button', { name: '创建' }).click();
  await expect(page.getByText(/分组“New group”已创建/)).toBeVisible();

  await page.getByRole('tab', { name: '质量与上下架' }).click();
  await page.getByRole('button', { name: '重新评分' }).first().click();
  await expect(page.getByText(/建议补充更多应用场景图片/)).toBeVisible();
  await page.getByLabel('选择 Portable solar power station 1000W').check();
  await page.getByRole('button', { name: '批量下架' }).click();
  await expect(page.getByText(/1 个商品已下架/)).toBeVisible();

  await page.getByRole('button', { name: 'API 能力' }).click();
  await expect(page.getByRole('heading', { name: 'API 能力目录' })).toBeVisible();
  await expect(page.locator('tbody tr')).toHaveCount(86);
  await page.getByPlaceholder('搜索 API 方法').fill('alibaba.icbu.category.attr.get');
  await page.getByRole('button', { name: 'alibaba.icbu.category.attr.get' }).click();
  await expect(page.getByText(/已 deprecated/)).toBeVisible();
  await page.getByRole('button', { name: '调用能力' }).click();
  await expect(page.getByText(/响应契约漂移/)).toBeVisible();
});

test('web mock supports visual detail editing, PhotoBank transfer and non-blocking guidance', async ({
  page
}) => {
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.clear();
  });
  await page.reload();
  await page.getByRole('button', { name: '商品' }).click();
  await page.getByRole('tab', { name: 'Schema 发品/编辑' }).click();
  await page.getByRole('button', { name: '获取 Schema' }).click();

  await expect(page.locator('.ProseMirror')).toBeVisible();
  await expect(page.getByRole('heading', { name: '详情整改建议' })).toBeVisible();
  await expect(page.getByText(/英文正文约 .*少于项目建议的 150 个/)).toBeVisible();
  await expect(page.getByRole('button', { name: /保存草稿/ })).toBeEnabled();

  await page.getByRole('button', { name: /插入图库图片/ }).click();
  await expect(page.getByRole('heading', { name: '国际站图片银行' })).toBeVisible();
  await page.getByRole('textbox', { name: '外部图片 URL' }).fill('https://images.example.com/detail.jpg');
  await page.getByRole('button', { name: '下载并存入图库' }).click();
  await expect(page.getByRole('textbox', { name: '外部图片 URL' })).toHaveValue('');
  await page.getByRole('button', { name: '完成选择' }).click();
  await expect(page.locator('.ProseMirror img[src*="mock-transferred-image"]')).toBeVisible();

  await page.getByLabel('商品/草稿 ID（编辑时）').fill('mock-smart');
  await page.getByRole('button', { name: '获取 Schema' }).click();
  await expect(page.getByText('智能详情', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '查看转换变化' }).click();
  await expect(page.getByText(/智能详情将降级为 API 可维护的普通详情/)).toBeVisible();
  await page.getByRole('button', { name: '确认转换为普通详情' }).click();
  await expect(page.locator('.ProseMirror')).toBeVisible();
});
