import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { chromium, expect, test, type BrowserContext } from '@playwright/test';

let context: BrowserContext;

test.beforeAll(async () => {
  const extensionPath = resolve(import.meta.dirname, '../../apps/extension/.output/chrome-mv3');
  const manifest = JSON.parse(await readFile(resolve(extensionPath, 'manifest.json'), 'utf8')) as {
    host_permissions?: string[];
    optional_host_permissions?: string[];
    permissions?: string[];
  };
  expect(manifest.permissions).toEqual(['storage']);
  expect(manifest.host_permissions).toEqual(['https://eco.taobao.com/*']);
  expect(manifest.optional_host_permissions).toEqual(['http://*/*', 'https://*/*']);
  expect(manifest.permissions).not.toContain('cookies');
  expect(manifest.host_permissions).not.toContain('<all_urls>');
  const userDataDir = await mkdtemp(resolve(tmpdir(), 'one-vegetable-e2e-'));
  context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
  });
});

test.afterAll(async () => {
  await context.close();
});

test('MV3 options page persists settings and exposes the audited catalog', async () => {
  let serviceWorker = context.serviceWorkers()[0];
  serviceWorker ??= await context.waitForEvent('serviceworker');
  const extensionId = new URL(serviceWorker.url()).host;
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);

  await expect(page.getByRole('heading', { name: '运营总览' })).toBeVisible();
  await page.getByRole('button', { name: '设置' }).click();
  await page.getByLabel('App Key').fill('e2e-app-key');
  await page.getByRole('button', { name: '保存设置' }).click();
  await expect(page.getByText('设置已安全写入 chrome.storage.local。')).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: '设置' }).click();
  await expect(page.getByLabel('App Key')).toHaveValue('e2e-app-key');
  await expect(page.getByRole('heading', { name: '主机权限' })).toBeVisible();
  await expect(page.getByText('当前没有额外主机权限。')).toBeVisible();
  await expect(page.getByText('https://*.alibaba.com/*')).toHaveCount(0);

  const qualificationError = await page.evaluate(async () => {
    const extension = (
      globalThis as unknown as {
        chrome: {
          storage: { local: { set(value: object): Promise<void> } };
          runtime: { sendMessage(value: object): Promise<unknown> };
        };
      }
    ).chrome;
    await extension.storage.local.set({
      gatewaySettings: {
        appKey: 'e2e-app-key',
        appSecret: 'e2e-secret',
        accessToken: 'e2e-token',
        endpoint: 'https://eco.taobao.com/router/rest',
        signMethod: 'hmac'
      }
    });
    return extension.runtime.sendMessage({
      id: 'logistics-qualification-e2e',
      kind: 'gateway-request',
      operation: 'listLogisticsProducts'
    });
  });
  expect(qualificationError).toMatchObject({
    ok: false,
    error: { code: 'LOGISTICS_QUALIFICATION_REQUIRED' }
  });
  const migratedSettings = await page.evaluate(async () => {
    const extension = (
      globalThis as unknown as {
        chrome: { storage: { local: { get(key: string): Promise<Record<string, unknown>> } } };
      }
    ).chrome;
    return extension.storage.local.get('gatewaySettings');
  });
  expect(migratedSettings).toMatchObject({
    gatewaySettings: {
      version: 1,
      settings: { appKey: 'e2e-app-key', appSecret: 'e2e-secret', accessToken: 'e2e-token' }
    }
  });

  const diagnosticsBeforeRestart = await page.evaluate(async () => {
    const extension = (
      globalThis as unknown as {
        chrome: { runtime: { sendMessage(value: object): Promise<unknown> } };
      }
    ).chrome;
    return extension.runtime.sendMessage({
      id: 'diagnostics-before-restart-e2e',
      kind: 'gateway-request',
      operation: 'getDiagnostics'
    });
  });
  expect(diagnosticsBeforeRestart).toMatchObject({ ok: true });
  expect(JSON.stringify(diagnosticsBeforeRestart)).not.toContain('e2e-secret');
  expect(JSON.stringify(diagnosticsBeforeRestart)).not.toContain('e2e-token');
  const entriesBeforeRestart = (diagnosticsBeforeRestart as { data: { entries: unknown[] } }).data.entries;

  const cdp = await context.newCDPSession(page);
  const { targetInfos } = await cdp.send('Target.getTargets');
  const serviceWorkerTarget = targetInfos.find(
    (target) => target.type === 'service_worker' && target.url === serviceWorker.url()
  );
  if (!serviceWorkerTarget) throw new Error('MV3 service worker target was not found');
  await cdp.send('Target.closeTarget', { targetId: serviceWorkerTarget.targetId });
  const diagnosticsAfterRestart = await page.evaluate(async () => {
    const extension = (
      globalThis as unknown as {
        chrome: { runtime: { sendMessage(value: object): Promise<unknown> } };
      }
    ).chrome;
    return extension.runtime.sendMessage({
      id: 'diagnostics-after-restart-e2e',
      kind: 'gateway-request',
      operation: 'getDiagnostics'
    });
  });
  expect(diagnosticsAfterRestart).toMatchObject({
    ok: true,
    data: { entries: entriesBeforeRestart }
  });

  await page.getByRole('button', { name: 'API 能力' }).click();
  await expect(page.locator('tbody tr')).toHaveCount(86);
  await page.getByPlaceholder('搜索 API 方法').fill('alibaba.icbu.product.schema.add');
  await page.getByRole('button', { name: 'alibaba.icbu.product.schema.add', exact: true }).click();
  await expect(page.getByText(/真实写能力尚未通过账号 smoke test/)).toBeVisible();
  await expect(page.getByRole('button', { name: '调用能力' })).toBeDisabled();

  await page.getByPlaceholder('搜索 API 方法').fill('alibaba.icbu.risk.send');
  await page.getByRole('button', { name: 'alibaba.icbu.risk.send' }).click();
  await expect(page.getByText(/WUA、UMID、IMEI、IMSI、MAC/)).toBeVisible();
  await expect(page.getByLabel('只读文档参数示例')).toBeVisible();
  await expect(page.getByRole('button', { name: '调用能力' })).toBeDisabled();

  const platformGateErrors = await page.evaluate(async () => {
    const extension = (
      globalThis as unknown as {
        chrome: { runtime: { sendMessage(value: object): Promise<unknown> } };
      }
    ).chrome;
    return Promise.all([
      extension.runtime.sendMessage({
        id: 'risk-protocol-gate-e2e',
        kind: 'gateway-request',
        operation: 'callCapability',
        payload: { method: 'alibaba.icbu.risk.send', parameters: {} }
      }),
      extension.runtime.sendMessage({
        id: 'task-callback-gate-e2e',
        kind: 'gateway-request',
        operation: 'callCapability',
        payload: { method: 'alibaba.icbu.task.status.notify', parameters: {} }
      }),
      extension.runtime.sendMessage({
        id: 'file-transfer-gate-e2e',
        kind: 'gateway-request',
        operation: 'callCapability',
        payload: { method: 'alibaba.icbu.file.urlposting.upload', parameters: {} }
      })
    ]);
  });
  expect(platformGateErrors).toHaveLength(3);
  expect(platformGateErrors.every((response) => JSON.stringify(response).includes('ok":false'))).toBe(true);
  expect(JSON.stringify(platformGateErrors[0])).toContain('天鹿风控协议');
  expect(JSON.stringify(platformGateErrors[1])).toContain('URL 爬取供应商');
  expect(JSON.stringify(platformGateErrors[2])).toContain('真实账号 smoke test');

  await page.evaluate(() => {
    localStorage.setItem(
      'one-vegetable-product-schema-draft',
      JSON.stringify({
        categoryId: '100009999',
        language: 'en_US',
        market: 'wholesale',
        xml: '<itemSchema><field id="productDescType" name="详情类型" type="label"><value>2</value></field><field id="superText" name="商品详情" type="input"><rules><rule name="valueTypeRule" value="html"/></rules><value>&lt;p&gt;Extension draft detail&lt;/p&gt;</value></field></itemSchema>'
      })
    );
  });
  await page.getByRole('button', { name: '商品' }).click();
  await page.getByRole('tab', { name: 'Schema 发品/编辑' }).click();
  await expect(page.getByText('已恢复浏览器中的未提交表单草稿。')).toBeVisible();
  await expect(page.getByRole('button', { name: /发布商品/ })).toBeDisabled();
  await page.getByRole('button', { name: /插入图库图片/ }).click();
  await expect(page.getByRole('heading', { name: '国际站图库' })).toBeVisible();
  await expect(page.locator('input[type="file"]')).toBeDisabled();
  await expect(page.getByRole('textbox', { name: '外部图片 URL' })).toBeDisabled();
  await expect(page.getByText(/真实上传尚未完成账号 smoke test/)).toBeVisible();
  await page.getByRole('button', { name: '完成选择' }).click();

  await page.getByRole('button', { name: '图库', exact: true }).click();
  await expect(page.getByRole('heading', { name: '图库' })).toBeVisible();
  await page.getByLabel('图库分组名称').fill('真实分组');
  await expect(page.getByRole('button', { name: '新增' })).toBeDisabled();
  await expect(page.getByText(/真实分组写操作尚未完成账号 smoke test/)).toBeVisible();

  const photoMutationError = await page.evaluate(async () => {
    const extension = (
      globalThis as unknown as {
        chrome: { runtime: { sendMessage(value: object): Promise<unknown> } };
      }
    ).chrome;
    return extension.runtime.sendMessage({
      id: 'photo-mutation-gate-e2e',
      kind: 'gateway-request',
      operation: 'operatePhotoGroup',
      payload: { operation: 'add', groupId: null, groupName: '真实分组' }
    });
  });
  expect(photoMutationError).toMatchObject({
    ok: false,
    error: { code: 'REAL_MUTATION_DISABLED' }
  });

  await page.getByRole('button', { name: 'RFQ' }).click();
  await expect(page.getByRole('heading', { name: 'RFQ 工作台' })).toBeVisible();
  await expect(page.getByText(/真实附件上传和提交报价尚未通过账号 smoke test/)).toBeVisible();

  await page.getByRole('button', { name: '订单' }).click();
  await expect(page.getByRole('heading', { name: '交易 / 订单工作台' })).toBeVisible();
  await expect(page.getByText(/完整详情明确标记为不可用/)).toBeVisible();
  await page.getByRole('button', { name: '信保订单草稿' }).click();
  await expect(page.getByText('扩展真实写入已禁用')).toBeVisible();
  await expect(page.getByRole('button', { name: '创建 Mock 信保订单' })).toBeDisabled();

  await page.getByRole('button', { name: '国际物流' }).click();
  await expect(page.getByRole('heading', { name: '国际物流工作台' })).toBeVisible();
  await expect(page.getByText(/扩展内不会发出这些请求/)).toBeVisible();
  await expect(page.getByRole('button', { name: '业务资格待验收' })).toBeDisabled();
  await page.getByRole('button', { name: '物流订单', exact: true }).click();
  await expect(page.getByRole('button', { name: '刷新' })).toBeDisabled();
  await page.getByRole('button', { name: '下单草稿' }).click();
  await expect(page.getByRole('button', { name: '真实下单保持禁用' })).toBeDisabled();

  await page.getByRole('button', { name: '数据洞察' }).click();
  await expect(page.getByRole('heading', { name: '数据与供应商洞察' })).toBeVisible();
  await page.getByRole('button', { name: '合作方能力' }).click();
  await expect(page.getByText(/CGS 小满签约客户数据查询/)).toBeVisible();
  await expect(page.getByText(/service worker 会在通用调试入口阻止该方法/)).toBeVisible();
  await expect(page.locator('input')).toHaveCount(0);

  const partnerCapabilityError = await page.evaluate(async () => {
    const extension = (
      globalThis as unknown as {
        chrome: { runtime: { sendMessage(value: object): Promise<unknown> } };
      }
    ).chrome;
    return extension.runtime.sendMessage({
      id: 'insights-partner-gate-e2e',
      kind: 'gateway-request',
      operation: 'callCapability',
      payload: {
        method: 'alibaba.mydata.self.query.cgsokk',
        parameters: {
          data_source: 'okkData',
          social_credit_code: 'documented-placeholder',
          app_secret: 'must-not-be-sent',
          app_info: 'alidataservice'
        }
      }
    });
  });
  expect(partnerCapabilityError).toMatchObject({ ok: false });
  expect(JSON.stringify(partnerCapabilityError)).toContain('CGS 小满签约客户');

  await page.getByRole('button', { name: '设置' }).click();
  await expect(page.getByRole('heading', { name: '脱敏诊断' })).toBeVisible();
  await expect(page.getByLabel('诊断记录数量')).toContainText(/\d+ 条/u);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出诊断' }).click();
  const download = await downloadPromise;
  const downloadPath = await download.path();
  if (!downloadPath) throw new Error('Diagnostics download has no local path');
  const exportedDiagnostics = await readFile(downloadPath, 'utf8');
  expect(exportedDiagnostics).not.toContain('e2e-secret');
  expect(exportedDiagnostics).not.toContain('e2e-token');
  const snapshot = JSON.parse(exportedDiagnostics) as { entries: unknown[] };
  expect(snapshot.entries.length).toBeGreaterThan(0);
  expect(snapshot.entries.length).toBeLessThanOrEqual(100);

  await page.getByRole('button', { name: '清空诊断' }).click();
  await expect(page.getByText('诊断记录已清空。')).toBeVisible();
  await expect(page.getByText('0 条', { exact: true })).toBeVisible();
});
