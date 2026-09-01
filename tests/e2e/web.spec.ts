import { readFile } from 'node:fs/promises';

import { expect, test, type Locator, type Page } from '@playwright/test';
import { unzipSync } from 'fflate';

import rootPackage from '../../package.json' with { type: 'json' };

const APP_PREFERENCES_STORAGE_KEY = 'one-vegetable:preferences:v2';

test('interface language switches in place without changing the Alibaba request language', async ({
  page
}) => {
  const bffRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/v1/')) bffRequests.push(request.url());
  });
  await page.addInitScript(
    ({ storageKey }) => {
      localStorage.setItem(
        storageKey,
        JSON.stringify({ uiLocale: 'zh-CN', alibabaLanguage: 'en_US', theme: 'system' })
      );
    },
    { storageKey: APP_PREFERENCES_STORAGE_KEY }
  );

  await page.goto('/#/products');
  await expect(page.getByRole('heading', { name: '商品管理' })).toBeVisible();
  await page.getByPlaceholder('按标题搜索').fill('solar');
  await page.getByTestId('language-toggle').click();

  await expect(page.locator('html')).toHaveAttribute('lang', 'en-US');
  await expect(page).toHaveTitle('oneVegetable · Alibaba.com Operations Workspace');
  await expect(page.getByRole('heading', { name: 'Product management' })).toBeVisible();
  await expect(page.getByPlaceholder('Search by title')).toHaveValue('solar');
  expect(page.url()).toContain('#/products');

  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(page.getByLabel('Platform request language')).toHaveValue('en_US');
  expect(bffRequests).toEqual([]);
});

test('web mock labels its in-process source and never calls the BFF', async ({ page }) => {
  const bffRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/v1/')) bffRequests.push(request.url());
  });

  await page.goto('/');
  await expect(page.getByTestId('data-source-status')).toHaveText(/本地 Mock/);
  await expect(page.getByRole('heading', { name: '运营总览' })).toBeVisible();
  expect(bffRequests).toEqual([]);
});

test('version updates are bundled and link to the formal GitHub record', async ({ page }) => {
  const githubApiRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().startsWith('https://api.github.com/')) githubApiRequests.push(request.url());
  });

  await page.goto('/#/releases');
  await expect(page.getByRole('heading', { name: '版本更新' })).toBeVisible();
  await expect(page.getByText(`v${rootPackage.version}`, { exact: true }).first()).toBeVisible();
  await expect(page.getByText('开放平台凭据向导')).toBeVisible();
  await expect(page.getByRole('link', { name: /GitHub 发布页/ })).toHaveAttribute(
    'href',
    'https://github.com/OKFred/oneVegetable/releases'
  );
  expect(githubApiRequests).toEqual([]);
});

test('web mock exposes the migrated operations workspace', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '运营总览' })).toBeVisible();
  await expect(page.getByTestId('data-source-status')).toHaveText(/本地 Mock/);

  const productNavigation = page.getByRole('link', { name: '商品' });
  await expect
    .poll(() => productNavigation.evaluate((element) => getComputedStyle(element).cursor))
    .toBe('pointer');
  await productNavigation.click();
  await expect(page.getByRole('heading', { name: '商品管理' })).toBeVisible();
  await expect(page.getByText('Portable solar power station 1000W')).toBeVisible();

  await openNewProductEditor(page);
  await chooseMockProductCategory(page);
  await page.getByRole('button', { name: '开始填写' }).click();
  await expect(page.getByRole('heading', { name: '新增商品' })).toBeVisible();
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

  await page.getByRole('button', { name: /保存平台草稿/ }).click();
  await expect(page.getByText(/草稿已保存/)).toBeVisible();
  await page.getByRole('button', { name: /六步向导/ }).click();
  await page.getByRole('button', { name: /6\. 检查与提交/ }).click();
  await expect(page.getByRole('heading', { name: '检查与提交' })).toBeVisible();

  await page.getByRole('tab', { name: '商品列表' }).click();
  await expect(page.getByRole('tab', { name: '类目与分组' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '新增', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '分组', exact: true }).click();
  const productGroupDialog = page.getByRole('dialog', { name: '商品分组' });
  await expect(productGroupDialog.getByRole('tree', { name: '商品分组树' })).toBeVisible();
  await productGroupDialog.getByRole('button', { name: '删除分组 Energy storage（不可用）' }).hover();
  await expect(page.getByRole('tooltip')).toContainText('暂时无法删除线上分组');
  await productGroupDialog.getByRole('button', { name: '展开Energy storage' }).click();
  await expect(productGroupDialog.getByText('Portable power', { exact: true })).toBeVisible();
  await productGroupDialog.getByRole('button', { name: '在 Energy storage 下新增分组' }).click();
  await productGroupDialog.getByLabel('在 Energy storage 下的新分组名称').fill('E2E products');
  await productGroupDialog.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByText(/商品分组“E2E products”已创建/)).toBeVisible();
  await expect(productGroupDialog.getByText('E2E products', { exact: true })).toBeVisible();
  await productGroupDialog.getByRole('button', { name: '关闭', exact: true }).click();

  const scoredProductRow = page.getByRole('row').filter({ hasText: 'Portable solar power station 1000W' });
  const secondProductRow = page
    .getByRole('row')
    .filter({ hasText: 'Custom recycled cotton canvas tote bag' });
  const zeroQualityProductRow = page
    .getByRole('row')
    .filter({ hasText: 'Commercial stainless steel food dehydrator' });
  await expect(scoredProductRow).toContainText('92/100');
  await expect(zeroQualityProductRow).toContainText('—');
  await expect(
    page.getByRole('button', { name: '预览 Portable solar power station 1000W 主图' })
  ).toBeVisible();
  await page.getByLabel('选择 Portable solar power station 1000W').check();
  await page.getByLabel('选择 Custom recycled cotton canvas tote bag').check();
  const clientWidthBeforeMenu = await page.evaluate(() => document.documentElement.clientWidth);
  await page.getByRole('button', { name: '更多' }).click();
  const productActionsMenu = page.getByRole('menu');
  await expect(productActionsMenu).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.clientWidth))
    .toBe(clientWidthBeforeMenu);
  await expect
    .poll(() => productActionsMenu.evaluate((element) => getComputedStyle(element).backgroundColor))
    .not.toBe('rgba(0, 0, 0, 0)');
  await page.getByRole('menuitem', { name: '批量查询产品分' }).click();
  await expect(page.getByText(/产品分查询完成：成功 2 个/)).toBeVisible();
  await expect(scoredProductRow).toContainText('4.6/6');
  await expect(secondProductRow).toContainText('4.6/6');
  await page.getByLabel('选择 Custom recycled cotton canvas tote bag').uncheck();
  await page.getByRole('button', { name: '更多' }).click();
  await page.getByRole('menuitem', { name: '批量下架' }).click();
  await expect(page.getByText(/1 个商品已下架/)).toBeVisible();

  await page.getByRole('link', { name: 'API 能力' }).click();
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

test('web mock queues multiple products and saves platform drafts sequentially', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.clear();
  });
  await page.reload();
  await page.getByRole('link', { name: '商品' }).click();

  await queueMockProduct(page, 'Batch solar generator A');
  await expect(page.getByRole('heading', { name: '批量发品队列' })).toBeVisible();
  await expect(page.getByText('Batch solar generator A', { exact: true })).toBeVisible();

  await queueMockProduct(page, 'Batch solar generator B');
  await expect(page.getByText('Batch solar generator B', { exact: true })).toBeVisible();

  await page.getByLabel('选择全部待发布商品').check();
  await page.getByRole('button', { name: /开始保存草稿/ }).click();
  await expect(page.getByText('批量任务完成：成功 2，失败 0，阻断 0，停止 0')).toBeVisible();
  await expect(page.getByText('本轮成功')).toHaveCount(2);
});

test('web mock exports a product JSON and imports it into the local review queue', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.clear();
  });
  await page.getByRole('link', { name: '商品' }).click();
  await expect(page.getByText('Portable solar power station 1000W')).toBeVisible();
  const productToolbar = page.getByRole('toolbar', { name: '商品列表操作' });
  const selectedCount = page.getByTestId('product-selection-count');
  const selectCurrentPage = page.getByLabel('选择本页全部 3 个商品');
  await expect(selectedCount).toHaveText('已选 0 个');
  await expect(productToolbar.getByRole('button', { name: '清空', exact: true })).toHaveCount(0);
  await expect(selectCurrentPage).not.toBeChecked();
  await page.getByLabel('选择 Portable solar power station 1000W').check();
  await expect(selectedCount).toHaveText('已选 1 个');
  await expect(selectCurrentPage).toHaveAttribute('aria-checked', 'mixed');
  await expect
    .poll(() => selectCurrentPage.evaluate((element) => (element as HTMLInputElement).indeterminate))
    .toBe(true);
  await selectCurrentPage.check();
  await expect(page.getByLabel('取消选择本页全部 3 个商品')).toBeChecked();
  await expect(selectedCount).toHaveText('已选 3 个');
  await page.getByLabel('取消选择本页全部 3 个商品').uncheck();
  await expect(selectedCount).toHaveText('已选 0 个');
  await page.getByRole('button', { name: '切换到夜间模式' }).click();

  await page.getByRole('button', { name: '导入', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '导入商品' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: '确认关闭' })).toBeVisible();
  await page
    .getByRole('dialog', { name: '确认关闭' })
    .getByRole('button', { name: '返回', exact: true })
    .click();
  await expect(page.getByRole('dialog', { name: '导入商品' })).toBeVisible();
  await page.getByRole('dialog', { name: '导入商品' }).getByRole('button', { name: '取消' }).click();
  await page
    .getByRole('dialog', { name: '确认关闭' })
    .getByRole('button', { name: '确认关闭', exact: true })
    .click();

  await page.getByLabel('选择 Portable solar power station 1000W').check();
  await page.getByRole('button', { name: '导出', exact: true }).click();
  const exportDialog = page.getByRole('dialog', { name: '导出商品' });
  await expect(exportDialog).toContainText('已冻结本次导出范围');
  await exportDialog.locator('summary').click();
  const schemaJsonOption = exportDialog.getByLabel('Schema JSON');
  await expect(schemaJsonOption).toBeChecked();
  await expect(schemaJsonOption).toBeVisible();
  const schemaJsonCard = schemaJsonOption.locator('..');
  await expect
    .poll(() =>
      schemaJsonCard.evaluate((element) => {
        const style = getComputedStyle(element);
        return style.color === style.backgroundColor;
      })
    )
    .toBe(false);
  await exportDialog.getByRole('button', { name: '导出', exact: true }).click();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page
      .getByRole('dialog', { name: '确认导出' })
      .getByRole('button', { name: '确认导出', exact: true })
      .click()
  ]);
  const downloadPath = await download.path();
  if (!downloadPath) throw new Error('Product JSON download path is unavailable');
  const transfer = JSON.parse(await readFile(downloadPath, 'utf8')) as {
    format: string;
    schemaVersion: number;
    products: { source: { productId: string }; schemaJson: unknown; schemaXml?: string }[];
  };
  expect(transfer).toMatchObject({
    format: 'one-vegetable-products',
    schemaVersion: 1,
    products: [{ source: { productId: '10000001' } }]
  });
  expect(transfer.products[0]?.schemaJson).toBeTruthy();
  expect(transfer.products[0]?.schemaXml).toBeUndefined();
  await expect(exportDialog).toBeHidden();

  await page.getByRole('button', { name: '导出', exact: true }).click();
  const xmlExportDialog = page.getByRole('dialog', { name: '导出商品' });
  await expect(xmlExportDialog).toBeVisible();
  await xmlExportDialog.locator('summary').click();
  await xmlExportDialog.getByLabel('Schema XML').check();
  await xmlExportDialog.getByRole('button', { name: '导出', exact: true }).click();
  const [xmlDownload] = await Promise.all([
    page.waitForEvent('download'),
    page
      .getByRole('dialog', { name: '确认导出' })
      .getByRole('button', { name: '确认导出', exact: true })
      .click()
  ]);
  const xmlDownloadPath = await xmlDownload.path();
  if (!xmlDownloadPath) throw new Error('Product Schema XML JSON download path is unavailable');
  const xmlTransfer = JSON.parse(await readFile(xmlDownloadPath, 'utf8')) as {
    products: { schemaJson?: unknown; schemaXml?: string }[];
  };
  expect(xmlTransfer.products[0]?.schemaXml).toBeTruthy();
  expect(xmlTransfer.products[0]?.schemaJson).toBeUndefined();

  await page.getByRole('button', { name: '导入', exact: true }).click();
  const importDialog = page.getByRole('dialog', { name: '导入商品' });
  await importDialog.getByLabel('选择商品 JSON 或 ZIP 文件').setInputFiles(downloadPath);
  await expect(importDialog).toContainText('1 个商品');
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('one-vegetable-product-batch-publish-v1')))
    .toBeNull();
  await importDialog.getByRole('button', { name: '导入', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('one-vegetable-product-batch-publish-v1')))
    .toBeNull();
  await page
    .getByRole('dialog', { name: '确认导入' })
    .getByRole('button', { name: '确认导入', exact: true })
    .click();
  await expect(page.getByText(/商品 JSON 已导入本机队列：新增 1/)).toBeVisible();
  await expect(page.getByRole('heading', { name: '批量发品队列' })).toBeVisible();
  await expect(page.getByText('Portable solar power station 1000W', { exact: true })).toBeVisible();
});

test('web mock exports and imports a product ZIP with gallery assets', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.clear();
  });
  await page.getByRole('link', { name: '商品' }).click();
  await expect(page.getByText('Portable solar power station 1000W')).toBeVisible();
  await page.getByLabel('选择 Portable solar power station 1000W').check();
  await page.getByRole('button', { name: '导出', exact: true }).click();
  const exportDialog = page.getByRole('dialog', { name: '导出商品' });
  await exportDialog.locator('summary').click();
  await exportDialog.getByLabel('ZIP 资源包').check();
  await exportDialog.getByRole('button', { name: '导出', exact: true }).click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page
      .getByRole('dialog', { name: '确认导出' })
      .getByRole('button', { name: '确认导出', exact: true })
      .click()
  ]);
  const downloadPath = await download.path();
  if (!downloadPath) throw new Error('Product ZIP download path is unavailable');
  const archive = unzipSync(new Uint8Array(await readFile(downloadPath)));
  const manifestBytes = archive['products.json'];
  if (!manifestBytes) throw new Error('Product ZIP does not contain products.json');
  const manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as {
    schemaVersion: number;
    products: { schemaJson?: unknown; schemaXml?: string }[];
  };
  expect(manifest.schemaVersion).toBe(2);
  expect(Object.keys(archive).filter((path) => path.startsWith('assets/'))).toHaveLength(1);
  expect(JSON.stringify(manifest.products[0])).toContain('assets/');

  await page.getByRole('button', { name: '导入', exact: true }).click();
  const importDialog = page.getByRole('dialog', { name: '导入商品' });
  await importDialog.getByLabel('选择商品 JSON 或 ZIP 文件').setInputFiles({
    name: download.suggestedFilename(),
    mimeType: 'application/zip',
    buffer: await readFile(downloadPath)
  });
  await expect(importDialog).toContainText('1 张引用图片');
  await expect(importDialog).toContainText('上传到图库分组');
  await importDialog.getByRole('button', { name: '导入', exact: true }).click();
  await page
    .getByRole('dialog', { name: '确认导入' })
    .getByRole('button', { name: '确认导入', exact: true })
    .click();
  await expect(page.getByText(/商品 ZIP 已导入本机队列：新增 1/)).toBeVisible();
  await expect(page.getByRole('heading', { name: '批量发品队列' })).toBeVisible();
});

test('web mock completes the typed RFQ quotation workflow', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.clear();
  });
  await page.getByRole('link', { name: 'RFQ' }).click();
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
  await expect(page.getByText(/演示报价提交成功/)).toBeVisible();
});

test('web mock combines typed trade order capabilities without a Jushita detail call', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: '订单' }).click();
  await expect(page.getByRole('heading', { name: '交易 / 订单工作台' })).toBeVisible();
  await page.getByRole('button', { name: '24668306501026709' }).click();
  await expect(page.getByRole('dialog', { name: '订单 24668306501026709' })).toBeVisible();
  await expect(page.getByText('fullDetail: jushita-only')).toBeVisible();
  await expect(page.getByText('USD 2450.50').first()).toBeVisible();
  await page.getByRole('tab', { name: 'TT 汇款' }).click();
  await expect(page).toHaveURL(/#\/orders\/orders\/24668306501026709\/payment$/u);
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
  await page.getByRole('button', { name: '创建演示信保订单' }).click();
  await expect(page.getByText(/演示订单创建成功/)).toBeVisible();
});

test('web mock restores product workspace and wizard step from the hash route', async ({ page }) => {
  await page.goto('/#/products/publisher/guided/review/new/100009999');
  await expect(page.getByRole('heading', { name: '商品管理' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '检查与提交' })).toBeVisible();
  await expect(page.getByRole('tab', { name: '商品列表' })).toHaveAttribute('aria-selected', 'false');
  await expect(page.getByRole('tab', { name: '批量发品' })).toHaveAttribute('aria-selected', 'false');
  await expect(page.getByRole('button', { name: /6\. 检查与提交/ })).toHaveAttribute('aria-current', 'step');

  await page.getByRole('button', { name: /4\. 商品详情/ }).click();
  await expect(page).toHaveURL(/#\/products\/publisher\/guided\/description\/new\/100009999$/u);
  await page.goBack();
  await expect(page.getByRole('heading', { name: '检查与提交' })).toBeVisible();
  await page.goForward();
  await expect(page.getByRole('heading', { name: '商品详情' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: '商品详情' })).toBeVisible();
});

test('web mock completes the qualified international logistics workflow', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: '国际物流' }).click();
  await expect(page.getByRole('heading', { name: '国际物流工作台' })).toBeVisible();
  await expect(page.getByText(/OneTouch 国际物流接口需要业务资格/)).toBeVisible();

  await page.getByRole('button', { name: '开始试算' }).click();
  await expect(page.getByText('CNY 109.20')).toBeVisible();
  await page.getByRole('button', { name: '下单草稿' }).click();
  await page.getByRole('button', { name: '提交物流订单' }).click();
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
  await page.getByRole('link', { name: '数据洞察' }).click();
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
  await page.getByRole('link', { name: '图库', exact: true }).click();
  await expect(page.getByRole('heading', { name: '图库' })).toBeVisible();
  await expect(page.getByText('图库 fileId：ph_001')).toBeVisible();
  await expect(page.getByRole('button', { name: /低分辨率 1/ })).toBeVisible();
  const galleryImage = page.getByRole('img', { name: 'solar-station-front.jpg' }).first();
  await expect(galleryImage).toBeVisible();
  await expect
    .poll(() =>
      galleryImage.evaluate((element) => ({
        width: (element as HTMLImageElement).naturalWidth,
        height: (element as HTMLImageElement).naturalHeight
      }))
    )
    .toEqual({ width: 1200, height: 1200 });
  await page.getByRole('button', { name: '预览 solar-station-front.jpg' }).click();
  await expect(page.getByRole('dialog', { name: '图片预览' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'solar-station-front.jpg' })).toBeVisible();
  await page.getByRole('button', { name: '放大图片' }).click();
  await expect(page.getByText('125%')).toBeVisible();
  await page.getByRole('button', { name: '关闭图片预览' }).click();
  await page.getByLabel('选择 solar-station-front.jpg').check();
  await expect(page.getByRole('button', { name: '分享 1 张' })).toBeEnabled();
  await page.getByRole('button', { name: '分享 1 张' }).click();
  const shareDialog = page.getByRole('dialog', { name: '分享图库素材' });
  await expect(shareDialog.getByText('发布到：Facebook Page', { exact: true })).toBeVisible();
  await expect(shareDialog.getByText('发布到：Instagram 专业账号', { exact: true })).toBeVisible();
  await expect(shareDialog.getByText('需要配置')).toHaveCount(4);
  const packageButton = shareDialog.getByRole('button', { name: '下载 ZIP 分享包' });
  await expect(packageButton).toBeEnabled();
  const downloadPromise = page.waitForEvent('download');
  await packageButton.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^one-vegetable-social-share-\d{4}-\d{2}-\d{2}\.zip$/u);
  await shareDialog.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '分组管理' }).click();
  const groupManager = page.getByRole('dialog', { name: '图库分组管理' });
  await groupManager.getByRole('button', { name: '修改分组 商品主图' }).click();
  await groupManager.getByLabel('商品主图 的新名称').fill('E2E 主图');
  await groupManager.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByText('图库分组已改名为“E2E 主图”')).toBeVisible();
  await groupManager.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '详情素材', exact: true }).click();
  await expect(page.getByText('dehydrator-detail.jpg')).toBeVisible();
  await expect(page.getByText('solar-station-front.jpg')).toHaveCount(0);
});

test('web mock supports visual detail editing, PhotoBank transfer and non-blocking guidance', async ({
  page
}) => {
  test.setTimeout(60_000);
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.clear();
  });
  await page.reload();
  await page.getByRole('link', { name: '商品' }).click();
  await openNewProductEditor(page);
  await chooseMockProductCategory(page);
  await page.getByRole('button', { name: '开始填写' }).click();
  await page.getByRole('button', { name: /六步向导/ }).click();
  await page.getByRole('button', { name: /4\. 商品详情/ }).click();

  await expect(page.locator('.ProseMirror')).toBeVisible();
  await page.getByRole('button', { name: '详情模板' }).click();
  let templateDialog = page.getByRole('dialog', { name: '商品详情模板' });
  const companyTemplate = templateDialog.locator('article').filter({ hasText: 'Company profile' });
  await companyTemplate.getByRole('button', { name: '追加末尾' }).click();
  await expect(page.locator('.ProseMirror')).toContainText('About Us');
  await expect(templateDialog).toBeHidden();

  await page.getByRole('button', { name: '详情模板' }).click();
  templateDialog = page.getByRole('dialog', { name: '商品详情模板' });
  await expect(templateDialog).toBeVisible();
  const shippingTemplate = templateDialog.locator('article').filter({ hasText: 'Shipping and delivery' });
  await expect(templateDialog.locator('[aria-busy]')).toHaveAttribute('aria-busy', 'false');
  const replaceDescriptionButton = shippingTemplate.getByRole('button', { name: '覆盖全文' });
  await activateReplacingDialogControl(replaceDescriptionButton);
  const replaceDialog = page.getByRole('dialog', { name: '确认覆盖商品详情' });
  await expect(replaceDialog.getByRole('heading', { name: '当前详情' })).toBeVisible();
  await expect(replaceDialog.getByText('覆盖后：Shipping and delivery')).toBeVisible();
  await activateReplacingDialogControl(replaceDialog.getByRole('button', { name: '确认覆盖全文' }));
  await expect(page.locator('.ProseMirror')).toContainText('Shipping and Delivery');
  await expect(replaceDialog).toBeHidden();

  await page.getByRole('button', { name: '详情模板' }).click();
  templateDialog = page.getByRole('dialog', { name: '商品详情模板' });
  await expect(templateDialog).toBeVisible();
  await activateReplacingDialogControl(templateDialog.getByRole('button', { name: '新建共享模板' }));
  const editorDialog = page.getByRole('dialog', { name: '新建共享详情模板' });
  await editorDialog.getByLabel('模板名称').fill('E2E custom details');
  await editorDialog.getByLabel('安全 HTML').fill('<h2>E2E custom section</h2><p>Shared content</p>');
  await activateReplacingDialogControl(editorDialog.getByRole('button', { name: '保存共享模板' }));
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
  await expect(page.getByRole('heading', { name: '选择图库素材' })).toBeVisible();
  await page
    .getByRole('button', { name: /预览 .*\.jpg/ })
    .first()
    .click();
  await expect(page.getByRole('dialog', { name: '图片预览' })).toBeVisible();
  await page.getByRole('button', { name: '关闭图片预览' }).click();
  await page.getByRole('button', { name: '上传新素材' }).click();
  const uploadDialog = page.getByRole('dialog', { name: '上传图片到图库' });
  await expect(uploadDialog).toBeVisible();
  await expect(uploadDialog.getByText(/上传到“全部图片”/)).toBeVisible();
  await uploadDialog
    .getByRole('textbox', { name: '外部图片 URL' })
    .fill('https://images.example.com/detail.jpg');
  await uploadDialog.getByRole('button', { name: '下载并存入图库' }).click();
  await expect(uploadDialog.getByText(/已转存到图库/)).toBeVisible();
  await expect(uploadDialog.getByRole('textbox', { name: '外部图片 URL' })).toHaveValue('');
  await uploadDialog.getByRole('button', { name: '关闭上传图片到图库' }).click();
  await page.getByRole('button', { name: '选择 detail.jpg' }).click();
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
  await page.getByRole('link', { name: 'API 能力' }).click();
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
  await page.getByRole('link', { name: '设置' }).click();
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
  expect(snapshot.extensionVersion).toBe(`${rootPackage.version}-mock`);
  expect(snapshot.entries).toHaveLength(1);

  await page.getByRole('button', { name: '清空诊断' }).click();
  const clearDiagnosticsDialog = page.getByRole('dialog', { name: '确认清空诊断' });
  await expect(clearDiagnosticsDialog).toBeVisible();
  await clearDiagnosticsDialog.getByRole('button', { name: '确认继续' }).click();
  await expect(page.getByText('诊断记录已清空。')).toBeVisible();
  await expect(page.getByText('0 条', { exact: true })).toBeVisible();
});

test('web mock groups official product hints and locates their fields from review', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.clear();
  });
  await page.reload();
  await page.getByRole('link', { name: '商品' }).click();
  await openNewProductEditor(page);
  await chooseMockProductCategory(page);
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
  await page.getByRole('link', { name: '设置' }).click();
  await page.getByLabel('偏好语言').selectOption('zh_CN');
  await expect(page.getByText('接口语言偏好已保存为 zh_CN')).toBeVisible();

  await page.getByRole('link', { name: '商品' }).click();
  await openNewProductEditor(page);
  await page.getByText('高级设置', { exact: true }).click();
  await expect(page.getByLabel('商品表单语言')).toHaveValue('zh_CN');
});

async function chooseMockProductCategory(page: Page): Promise<void> {
  await page.getByRole('combobox').click();
  const dialog = page.getByRole('dialog', { name: '选择商品类目' });
  await dialog.getByRole('button', { name: /Consumer Electronics/ }).click();
  await dialog.getByRole('button', { name: /Portable Power Stations/ }).click();
}

async function queueMockProduct(page: Page, title: string): Promise<void> {
  await openNewProductEditor(page);
  await chooseMockProductCategory(page);
  await page.getByRole('button', { name: '开始填写' }).click();
  await page.getByLabel('商品标题').fill(title);
  await page.getByRole('button', { name: '加入队列' }).click();
}

async function openNewProductEditor(page: Page): Promise<void> {
  const productListTab = page.getByRole('tab', { name: '商品列表' });
  if ((await productListTab.getAttribute('aria-selected')) !== 'true') await productListTab.click();
  await page.getByRole('button', { name: '新增', exact: true }).click();
}

async function activateReplacingDialogControl(control: Locator): Promise<void> {
  await expect(control).toBeVisible();
  await expect(control).toBeEnabled();
  await control.dispatchEvent('click');
}
