import { readFile } from 'node:fs/promises';

import { expect, test } from '@playwright/test';

test('web mock exposes the migrated operations workspace', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '运营总览' })).toBeVisible();
  await expect(page.getByText('OpenAPI Mock')).toBeVisible();

  const productNavigation = page.getByRole('button', { name: '商品' });
  await expect
    .poll(() => productNavigation.evaluate((element) => getComputedStyle(element).cursor))
    .toBe('pointer');
  await productNavigation.click();
  await expect(page.getByRole('heading', { name: '商品管理' })).toBeVisible();
  await expect(page.getByText('Portable solar power station 1000W')).toBeVisible();

  await page.getByRole('tab', { name: '商品发布/编辑' }).click();
  await page.getByRole('button', { name: '开始填写' }).click();
  await expect(page.getByRole('heading', { name: '发布新商品' })).toBeVisible();
  await expect(page.getByText('当前分组：Energy storage / Portable power / Solar generators')).toBeVisible();
  await expect
    .poll(() => page.getByLabel('一级分组').evaluate((element) => getComputedStyle(element).cursor))
    .toBe('pointer');
  await expect
    .poll(() =>
      page.getByText('高级设置', { exact: true }).evaluate((element) => getComputedStyle(element).cursor)
    )
    .toBe('pointer');
  await page.getByLabel('一级分组').selectOption({ label: 'Packaging' });
  await page.getByLabel('二级分组').selectOption({ label: 'Reusable bags' });
  await expect(page.getByText('当前分组：Packaging / Reusable bags')).toBeVisible();
  await expect(page.getByText('group_id')).toHaveCount(0);
  await page.getByLabel('商品标题').fill('Portable solar generator for camping');
  await expect(page.getByText('本地草稿：已保存到本机')).toBeVisible();

  await page.reload();
  await page.getByRole('button', { name: '商品' }).click();
  await page.getByRole('tab', { name: '商品发布/编辑' }).click();
  await expect(page.getByText('发现本地草稿', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '继续本地草稿' }).click();
  await expect(page.getByLabel('商品标题')).toHaveValue('Portable solar generator for camping');
  await page.getByRole('button', { name: /保存平台草稿/ }).click();
  await expect(page.getByText(/草稿已保存/)).toBeVisible();
  await page.getByRole('button', { name: /六步向导/ }).click();
  await page.getByRole('button', { name: /6\. 检查与提交/ }).click();
  await expect(page.getByRole('heading', { name: '检查与提交' })).toBeVisible();

  await page.getByRole('tab', { name: '类目与分组' }).click();
  await expect(page.getByText('Energy storage')).toBeVisible();
  await page.getByLabel('新分组名称').fill('E2E products');
  await page.getByRole('button', { name: '创建' }).click();
  await expect(page.getByText(/分组“New group”已创建/)).toBeVisible();

  await page.getByRole('tab', { name: '质量与上下架' }).click();
  const firstProductQuality = page.getByLabel('商品质量 Portable solar power station 1000W');
  const zeroQualityProduct = page.getByLabel('商品质量 Commercial stainless steel food dehydrator');
  await expect(firstProductQuality.getByText('质量分')).toBeVisible();
  await expect(zeroQualityProduct.getByText('质量分')).toHaveCount(0);
  await firstProductQuality.getByRole('button', { name: '查询产品分' }).click();
  await expect(firstProductQuality.getByText('4.6/5')).toBeVisible();
  await expect(firstProductQuality.getByText(/建议补充更多应用场景图片/)).toBeVisible();
  await page.getByRole('button', { name: '列表' }).click();
  const scoredProductRow = page.getByRole('row', { name: /Portable solar power station 1000W/ });
  await expect(scoredProductRow).toContainText('4.6/5');
  await expect(scoredProductRow).toContainText('92/100');
  await page.getByRole('button', { name: '卡片' }).click();
  await page.getByLabel('选择 Portable solar power station 1000W').check();
  await page.getByRole('button', { name: '批量下架' }).click();
  await expect(page.getByText(/1 个商品已下架/)).toBeVisible();

  await page.getByRole('button', { name: 'API 能力' }).click();
  await expect(page.getByRole('heading', { name: 'API 能力目录' })).toBeVisible();
  await expect(page.locator('tbody tr')).toHaveCount(10);
  await expect(page.getByText('共 86 条，当前 1–10 条')).toBeVisible();
  await page.getByRole('button', { name: '下一页' }).click();
  await expect(page.getByText('第 2 / 9 页')).toBeVisible();
  await page.getByPlaceholder('搜索 API 方法').fill('alibaba.icbu.category.attr.get');
  await expect(page.getByText('第 1 / 1 页')).toBeVisible();
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
  await expect(page.getByRole('dialog', { name: '订单 24668306501026709' })).toBeVisible();
  await expect(page.getByText('fullDetail: jushita-only')).toBeVisible();
  await expect(page.getByText('USD 2450.50').first()).toBeVisible();
  await page.getByRole('tab', { name: 'TT 汇款' }).click();
  await expect(page.getByTestId('tt-account-number')).not.toContainText('1029200038060');
  await page.getByRole('button', { name: '显示完整汇款账号' }).click();
  await expect(page.getByTestId('tt-account-number')).toContainText('1029200038060');
  await page.getByRole('button', { name: '关闭详情' }).click();

  await page.getByRole('button', { name: '资金与履约' }).click();
  await expect(page.getByText('一达通')).toBeVisible();

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

test('web mock completes the qualified international logistics workflow', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '国际物流' }).click();
  await expect(page.getByRole('heading', { name: '国际物流工作台' })).toBeVisible();
  await expect(page.getByText(/OneTouch 国际物流接口需要业务资格/)).toBeVisible();

  await page.getByRole('button', { name: '开始试算' }).click();
  await expect(page.getByText('CNY 109.20')).toBeVisible();
  await page.getByRole('button', { name: '下单草稿' }).click();
  await page.getByRole('button', { name: '提交 Mock 物流订单' }).click();
  await expect(page.getByText('ALS00201756999')).toBeVisible();

  await page.getByRole('button', { name: '物流订单', exact: true }).click();
  await page.getByRole('button', { name: 'ALS00201756002' }).click();
  await expect(page.getByText(/Base64 数据已返回/)).toBeVisible();
  await page.getByRole('button', { name: '关闭详情' }).click();

  await page.getByRole('button', { name: '地址与模板' }).click();
  await expect(page.getByText('浙江省')).toBeVisible();
  await expect(page.getByText('北美包邮模板')).toBeVisible();
});

test('web mock exposes typed data and supplier insights without inferred conclusions', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '数据洞察' }).click();
  await expect(page.getByRole('heading', { name: '数据与供应商洞察' })).toBeVisible();
  await expect(page.getByText('18.6%').first()).toBeVisible();
  await expect(page.getByText(/不生成“提升”“下降”或评级结论/)).toBeVisible();

  await page.getByRole('button', { name: '采购供应商' }).click();
  await page.getByRole('button', { name: /supplier-enc-001/ }).click();
  await expect(page.getByText('Portable solar power station 1000W')).toBeVisible();
  await expect(page.getByText('100003109')).toBeVisible();

  await page.getByRole('button', { name: '合作方能力' }).click();
  await expect(page.getByText(/CGS 小满签约客户数据查询/)).toBeVisible();
  await expect(page.getByText(/不会把密钥放入页面或普通设置/)).toBeVisible();
  await expect(page.locator('input')).toHaveCount(0);
});

test('web mock manages gallery groups and exposes non-blocking asset governance', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '图库' }).click();
  await expect(page.getByRole('heading', { name: '图库' })).toBeVisible();
  await expect(page.getByText('图库 fileId：ph_001')).toBeVisible();
  await expect(page.getByRole('button', { name: /低分辨率 1/ })).toBeVisible();
  await page.getByRole('button', { name: '预览 solar-station-front.jpg' }).click();
  await expect(page.getByRole('dialog', { name: '图片预览' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'solar-station-front.jpg' })).toBeVisible();
  await page.getByRole('button', { name: '放大图片' }).click();
  await expect(page.getByText('125%')).toBeVisible();
  await page.getByRole('button', { name: '关闭图片预览' }).click();
  await page.getByRole('button', { name: /商品主图/ }).click();
  await page.getByLabel('图库分组名称').fill('E2E 主图');
  await page.getByRole('button', { name: '改名' }).click();
  await expect(page.getByText('分组已保存：E2E 主图')).toBeVisible();
  await page.getByRole('button', { name: /低分辨率 1/ }).click();
  await expect(page.getByText('dehydrator-detail.jpg')).toBeVisible();
  await expect(page.getByText('solar-station-front.jpg')).toHaveCount(0);
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
  await page.getByRole('tab', { name: '商品发布/编辑' }).click();
  await page.getByRole('button', { name: '开始填写' }).click();
  await page.getByRole('button', { name: /六步向导/ }).click();
  await page.getByRole('button', { name: /4\. 商品详情/ }).click();

  await expect(page.locator('.ProseMirror')).toBeVisible();
  await page.getByRole('button', { name: '详情模板' }).click();
  let templateDialog = page.getByRole('dialog', { name: '商品详情模板' });
  const companyTemplate = templateDialog.locator('article').filter({ hasText: 'Company profile' });
  await companyTemplate.getByRole('button', { name: '追加末尾' }).click();
  await expect(page.locator('.ProseMirror')).toContainText('About Us');

  await page.getByRole('button', { name: '详情模板' }).click();
  templateDialog = page.getByRole('dialog', { name: '商品详情模板' });
  const shippingTemplate = templateDialog.locator('article').filter({ hasText: 'Shipping and delivery' });
  await shippingTemplate.getByRole('button', { name: '覆盖全文' }).click();
  const replaceDialog = page.getByRole('dialog', { name: '确认覆盖商品详情' });
  await expect(replaceDialog.getByRole('heading', { name: '当前详情' })).toBeVisible();
  await expect(replaceDialog.getByText('覆盖后：Shipping and delivery')).toBeVisible();
  await replaceDialog.getByRole('button', { name: '确认覆盖全文' }).click();
  await expect(page.locator('.ProseMirror')).toContainText('Shipping and Delivery');

  await page.getByRole('button', { name: '详情模板' }).click();
  templateDialog = page.getByRole('dialog', { name: '商品详情模板' });
  await templateDialog.getByRole('button', { name: '新建共享模板' }).click();
  const editorDialog = page.getByRole('dialog', { name: '新建共享详情模板' });
  await editorDialog.getByLabel('模板名称').fill('E2E custom details');
  await editorDialog.getByLabel('安全 HTML').fill('<h2>E2E custom section</h2><p>Shared content</p>');
  await editorDialog.getByRole('button', { name: '保存共享模板' }).click();
  await expect(
    page.getByRole('dialog', { name: '商品详情模板' }).getByText('E2E custom details')
  ).toBeVisible();
  await page.getByRole('button', { name: '关闭商品详情模板' }).click();

  await page.getByRole('button', { name: /6\. 检查与提交/ }).click();
  await expect(page.getByRole('heading', { name: '内容优化建议' })).toBeVisible();
  await expect(page.getByText(/英文正文约 .*少于项目建议的 150 个/)).toBeVisible();
  await expect(page.getByRole('button', { name: /保存平台草稿/ })).toBeEnabled();

  await page.getByRole('button', { name: /4\. 商品详情/ }).click();
  await page.getByRole('button', { name: /插入图库图片/ }).click();
  await expect(page.getByRole('heading', { name: '国际站图库' })).toBeVisible();
  await page
    .getByRole('button', { name: /预览 .*\.jpg/ })
    .first()
    .click();
  await expect(page.getByRole('dialog', { name: '图片预览' })).toBeVisible();
  await page.getByRole('button', { name: '关闭图片预览' }).click();
  await page.getByRole('button', { name: '上传图片' }).click();
  const uploadDialog = page.getByRole('dialog', { name: '上传图片到图库' });
  await expect(uploadDialog).toBeVisible();
  await expect(uploadDialog.getByText('目标分组：全部图片')).toBeVisible();
  await uploadDialog
    .getByRole('textbox', { name: '外部图片 URL' })
    .fill('https://images.example.com/detail.jpg');
  await uploadDialog.getByRole('button', { name: '下载并存入图库' }).click();
  await expect(uploadDialog.getByText(/已转存到图库/)).toBeVisible();
  await expect(uploadDialog.getByRole('textbox', { name: '外部图片 URL' })).toHaveValue('');
  await uploadDialog.getByRole('button', { name: '完成' }).click();
  await page.getByRole('button', { name: '完成选择' }).click();
  await expect(page.locator('.ProseMirror img[src*="mock-transferred-image"]')).toBeVisible();

  await page.getByText('高级设置', { exact: true }).click();
  await page.getByLabel('商品明文 ID').fill('10000002');
  await page.getByRole('button', { name: '重新加载商品表单' }).click();
  await expect(page.getByLabel('商品标题')).toHaveValue(/.+/);
  await page.getByRole('button', { name: /4\. 商品详情/ }).click();
  await expect(page.getByText('智能详情', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '查看转换变化' }).click();
  await expect(page.getByText(/智能详情将降级为 API 可维护的普通详情/)).toBeVisible();
  await page.getByRole('button', { name: '确认转换为普通详情' }).click();
  await expect(page.locator('.ProseMirror')).toBeVisible();
});

test('web mock exposes the final platform contracts with protocol safeguards', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'API 能力' }).click();
  await page.getByPlaceholder('搜索 API 方法').fill('alibaba.icbu.risk.send');
  await page.getByRole('button', { name: 'alibaba.icbu.risk.send' }).click();
  await expect(page.getByText(/WUA、UMID、IMEI、IMSI、MAC/)).toBeVisible();
  await expect(page.getByLabel('只读文档参数示例')).toBeVisible();
  await expect(page.getByRole('button', { name: '调用能力' })).toBeDisabled();

  await page.getByLabel('关闭详情').click();
  await page.getByPlaceholder('搜索 API 方法').fill('alibaba.icbu.file.urlposting.upload');
  await page.getByRole('button', { name: 'alibaba.icbu.file.urlposting.upload' }).click();
  await expect(page.getByText(/不返回图库 fileId/)).toBeVisible();
  await expect(page.getByLabel('调用参数 JSON')).toHaveValue(/ONE_VEGETABLE/);
  await page.getByRole('button', { name: '调用能力' }).click();
  await expect(page.getByText(/"file_url"/)).toBeVisible();
});

test('web mock exports and clears the typed diagnostics snapshot', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '设置' }).click();
  await expect(page.getByRole('heading', { name: '脱敏诊断' })).toBeVisible();
  await expect(page.getByText('1 条', { exact: true })).toBeVisible();

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出诊断' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^one-vegetable-diagnostics-\d{4}-\d{2}-\d{2}\.json$/u);
  const downloadPath = await download.path();
  if (!downloadPath) throw new Error('Diagnostics download has no local path');
  const snapshot = JSON.parse(await readFile(downloadPath, 'utf8')) as {
    entries: unknown[];
    extensionVersion: string;
  };
  expect(snapshot.extensionVersion).toBe('2.0.0-mock');
  expect(snapshot.entries).toHaveLength(1);

  await page.getByRole('button', { name: '清空诊断' }).click();
  await expect(page.getByText('诊断记录已清空。')).toBeVisible();
  await expect(page.getByText('0 条', { exact: true })).toBeVisible();
});

test('web mock groups official product hints and locates their fields from review', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.clear();
  });
  await page.reload();
  await page.getByRole('button', { name: '商品' }).click();
  await page.getByRole('tab', { name: '商品发布/编辑' }).click();
  await page.getByRole('button', { name: '开始填写' }).click();
  await page.getByRole('button', { name: /六步向导/ }).click();
  await page.getByRole('button', { name: /6\. 检查与提交/ }).click();

  const officialHints = page.locator('section[aria-labelledby="official-hints-title"]');
  await expect(officialHints.getByRole('heading', { name: '官方提示' })).toBeVisible();
  await expect(officialHints.getByRole('heading', { name: '商品标题' })).toBeVisible();
  await expect(officialHints.getByRole('heading', { name: '商品详情' })).toBeVisible();
  await expect(officialHints.getByText('面向买家的英文商品标题')).toBeVisible();
  await expect(officialHints.getByText('API 仅支持维护普通详情')).toBeVisible();

  await officialHints.getByRole('button', { name: '定位字段：商品标题' }).click();
  await expect(page.getByLabel('商品标题')).toBeFocused();
});

test('web mock persists the API language preference for product editing', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '设置' }).click();
  await page.getByLabel('偏好语言').selectOption('zh_CN');
  await expect(page.getByText('接口语言偏好已保存为 zh_CN')).toBeVisible();

  await page.getByRole('button', { name: '商品' }).click();
  await page.getByRole('tab', { name: '商品发布/编辑' }).click();
  await page.getByText('高级设置', { exact: true }).click();
  await expect(page.getByLabel('商品表单语言')).toHaveValue('zh_CN');
});
