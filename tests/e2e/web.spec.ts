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

test('web mock completes the typed RFQ quotation workflow', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.clear();
  });
  await page.getByRole('button', { name: 'RFQ' }).click();
  await expect(page.getByRole('heading', { name: 'RFQ 工作台' })).toBeVisible();
  await expect(page.getByText('Portable solar power stations for outdoor retail')).toBeVisible();
  await expect(page.getByText('剩余报价权益').locator('..')).toContainText('12');

  await page.getByRole('button', { name: 'Portable solar power stations for outdoor retail' }).click();
  await expect(page.getByText('Hamburg')).toBeVisible();
  await page.getByText('给买家留言').locator('textarea').fill('We can supply this order.');
  await page.getByPlaceholder('599.00').fill('599');
  await page.getByText('装运港').locator('input').fill('Shenzhen');
  await page.getByRole('button', { name: '保存草稿' }).click();
  await expect(page.getByText('已保存')).toBeVisible();
  await page.getByRole('button', { name: '提交报价' }).click();
  await expect(page.getByText(/Mock 报价提交成功/)).toBeVisible();
});

test('web mock combines typed trade order capabilities without a Jushita detail call', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '订单' }).click();
  await expect(page.getByRole('heading', { name: '交易 / 订单工作台' })).toBeVisible();
  await page.getByRole('button', { name: '24668306501026709' }).click();
  await expect(page.getByText('聚合详情 · 24668306501026709')).toBeVisible();
  await expect(page.getByText('fullDetail: jushita-only')).toBeVisible();
  await expect(page.getByText('USD 2450.50').first()).toBeVisible();

  await page.getByRole('button', { name: '资金与履约' }).click();
  await expect(page.getByText('一达通')).toBeVisible();
  await expect(page.getByText('1029200038060')).toBeVisible();

  await page.getByRole('button', { name: '地址 Schema' }).click();
  await expect(page.getByText('contact.fullName')).toBeVisible();
  await page.getByPlaceholder('buyer@example.com').fill('buyer@example.com');
  await expect(page.getByText('Northwind warehouse')).toBeVisible();

  await page.getByRole('button', { name: '信保订单草稿' }).click();
  await page.getByPlaceholder('买家登录名').fill('northwind-buyer');
  await page.getByPlaceholder('商品 ID').fill('10000001');
  await page.getByPlaceholder('商品名称').fill('Portable solar power station');
  await page.getByPlaceholder('数量').fill('10');
  await page.getByPlaceholder('单价').fill('599');
  await page.getByRole('button', { name: '创建 Mock 信保订单' }).click();
  await expect(page.getByText(/Mock 创建成功/)).toBeVisible();
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
  await expect(page.getByRole('heading', { name: '国际站图库' })).toBeVisible();
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
