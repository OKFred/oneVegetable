import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { chromium, expect, test, type BrowserContext } from '@playwright/test';

let context: BrowserContext | null = null;

test.setTimeout(90_000);

test.beforeAll(async () => {
  const extensionPath = resolve(import.meta.dirname, '../../apps/extension/.output/chrome-mv3');
  const manifest = JSON.parse(await readFile(resolve(extensionPath, 'manifest.json'), 'utf8')) as {
    background?: { service_worker?: string; type?: string };
    host_permissions?: string[];
    optional_host_permissions?: string[];
    permissions?: string[];
    minimum_chrome_version?: string;
  };
  expect(manifest.background).toEqual({ service_worker: 'background.js', type: 'module' });
  expect(manifest.permissions).toEqual(['storage', 'scripting']);
  expect(manifest.host_permissions).toEqual(['https://eco.taobao.com/*']);
  expect(manifest.optional_host_permissions).toEqual(['http://*/*', 'https://*/*']);
  expect(manifest.permissions).not.toContain('cookies');
  expect(manifest.host_permissions).not.toContain('<all_urls>');
  expect(manifest.minimum_chrome_version).toBe('102');
  const userDataDir = await mkdtemp(resolve(tmpdir(), 'one-vegetable-e2e-'));
  context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
  });
});

test.afterAll(async () => {
  if (context) await context.close();
});

test('MV3 options page persists settings and exposes the audited catalog', async () => {
  const browserContext = context;
  if (!browserContext) throw new Error('extension browser context was not initialized');
  let serviceWorker = browserContext.serviceWorkers()[0];
  serviceWorker ??= await browserContext.waitForEvent('serviceworker');
  const extensionId = new URL(serviceWorker.url()).host;
  await browserContext.route('https://storage-probe.alibaba.com/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>storage probe</title>' })
  );
  const storageProbePage = await browserContext.newPage();
  const storageProbeCdp = await browserContext.newCDPSession(storageProbePage);
  const storageProbeResult = new Promise<unknown>((resolveStorageProbe) => {
    storageProbeCdp.on('Runtime.executionContextCreated', ({ context: executionContext }) => {
      if (executionContext.auxData?.type !== 'isolated') return;
      void storageProbeCdp
        .send('Runtime.evaluate', {
          expression:
            '(() => ({ localAvailable: Boolean(chrome.storage?.local), sessionAvailable: Boolean(chrome.storage?.session) }))()',
          contextId: executionContext.id,
          awaitPromise: true,
          returnByValue: true
        })
        .then((result) => {
          resolveStorageProbe(result);
        })
        .catch(() => undefined);
    });
  });
  await storageProbeCdp.send('Runtime.enable');
  await storageProbePage.goto('https://storage-probe.alibaba.com/probe');
  const storageProbe = (await storageProbeResult) as {
    result?: { value?: { localAvailable?: boolean; sessionAvailable?: boolean } };
  };
  expect(storageProbe.result?.value).toEqual({ localAvailable: false, sessionAvailable: false });
  await storageProbePage.close();
  await browserContext.unroute('https://storage-probe.alibaba.com/**');

  const privacyPage = await browserContext.newPage();
  await privacyPage.goto(`chrome-extension://${extensionId}/privacy.html`);
  await expect(privacyPage.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await expect(privacyPage.getByRole('heading', { name: '一根青菜隐私政策' })).toBeVisible();
  await expect(privacyPage.locator('meta[http-equiv="Content-Security-Policy"]')).toHaveAttribute(
    'content',
    /default-src 'none'/u
  );
  await expect(privacyPage.locator('link[rel="canonical"]')).toHaveAttribute(
    'href',
    'https://github.com/OKFred/oneVegetable/blob/master/docs/privacy-policy.md'
  );
  await expect(privacyPage.locator('script')).toHaveCount(0);
  await privacyPage.getByRole('link', { name: 'English' }).click();
  await expect(privacyPage.locator('html')).toHaveAttribute('lang', 'en');
  await expect(privacyPage.getByRole('heading', { name: 'oneVegetable Privacy Policy' })).toBeVisible();
  await privacyPage.close();

  const page = await browserContext.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);

  await expect(page.getByRole('heading', { name: '先确认数据与调用边界' })).toBeVisible();
  await expect(page.getByRole('button', { name: '稍后，仅浏览' })).toBeDisabled();
  await expect(page.getByRole('button', { name: '前往设置凭证' })).toBeDisabled();
  await expect(page.getByRole('link', { name: '查看隐私说明' })).toHaveAttribute('href', '/privacy.html');
  const diagnosticsBeforeConsent = await page.evaluate(async () => {
    const extension = (
      globalThis as unknown as {
        chrome: { runtime: { sendMessage(value: object): Promise<unknown> } };
      }
    ).chrome;
    return extension.runtime.sendMessage({
      requestId: crypto.randomUUID(),
      kind: 'gateway-request',
      operation: 'getDiagnostics'
    });
  });
  expect(diagnosticsBeforeConsent).toMatchObject({ ok: true, data: { entries: [] } });
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: '稍后，仅浏览' }).click();
  await expect(page.getByRole('heading', { name: '运营总览' })).toBeVisible();
  await page.getByRole('link', { name: '设置', exact: true }).click();
  await expect(page.getByRole('heading', { name: '开放平台凭证保护' })).toBeVisible();
  await expect(page.getByText('未创建', { exact: true })).toBeVisible();
  await page.getByLabel('App Key').fill('e2e-app-key');
  await page.getByLabel('App Secret').fill('e2e-secret');
  await page.getByLabel('Access Token').fill('e2e-token');
  await page.getByLabel('新建保险库口令').fill('e2e-vault-password');
  await page.getByLabel('确认保险库口令').fill('e2e-vault-password');
  await page.getByRole('button', { name: '创建保险库并保存' }).click();
  await expect(page.getByText('凭证已加密保存，并将在当前 Chrome 会话内保持可用。').first()).toBeVisible();
  const encryptedSettings = await page.evaluate(async () => {
    const extension = (
      globalThis as unknown as {
        chrome: { storage: { local: { get(key: string): Promise<Record<string, unknown>> } } };
      }
    ).chrome;
    return extension.storage.local.get('gatewaySettings');
  });
  expect(encryptedSettings).toMatchObject({
    gatewaySettings: {
      version: 2,
      format: 'PBKDF2-HMAC-SHA256/AES-256-GCM',
      kdf: { iterations: 600_000, hash: 'SHA-256' }
    }
  });
  expect(JSON.stringify(encryptedSettings)).not.toContain('e2e-app-key');
  expect(JSON.stringify(encryptedSettings)).not.toContain('e2e-secret');
  expect(JSON.stringify(encryptedSettings)).not.toContain('e2e-token');
  await page.reload();
  await page.getByRole('link', { name: '设置', exact: true }).click();
  await expect(page.getByLabel('App Key')).toHaveValue('e2e-app-key');
  await expect(page.getByLabel('App Secret')).toHaveValue('');
  await expect(page.getByLabel('Access Token')).toHaveValue('');
  await expect(page.getByRole('heading', { name: '主机权限' })).toBeVisible();
  await expect(page.getByText('当前没有额外主机权限。')).toBeVisible();
  await expect(page.getByText('https://*.alibaba.com/*')).toHaveCount(0);

  const qualificationError = await page.evaluate(async () => {
    const extension = (
      globalThis as unknown as {
        chrome: {
          runtime: { sendMessage(value: object): Promise<unknown> };
        };
      }
    ).chrome;
    return extension.runtime.sendMessage({
      requestId: crypto.randomUUID(),
      kind: 'gateway-request',
      operation: 'listLogisticsProducts'
    });
  });
  expect(qualificationError).toMatchObject({
    ok: false,
    error: { code: 'LOGISTICS_QUALIFICATION_REQUIRED' }
  });

  const diagnosticsBeforeRestart = await page.evaluate(async () => {
    const extension = (
      globalThis as unknown as {
        chrome: { runtime: { sendMessage(value: object): Promise<unknown> } };
      }
    ).chrome;
    return extension.runtime.sendMessage({
      requestId: crypto.randomUUID(),
      kind: 'gateway-request',
      operation: 'getDiagnostics'
    });
  });
  expect(diagnosticsBeforeRestart).toMatchObject({ ok: true });
  expect(JSON.stringify(diagnosticsBeforeRestart)).not.toContain('e2e-secret');
  expect(JSON.stringify(diagnosticsBeforeRestart)).not.toContain('e2e-token');
  const entriesBeforeRestart = (diagnosticsBeforeRestart as { data: { entries: unknown[] } }).data.entries;

  const cdp = await browserContext.newCDPSession(page);
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
      requestId: crypto.randomUUID(),
      kind: 'gateway-request',
      operation: 'getDiagnostics'
    });
  });
  expect(diagnosticsAfterRestart).toMatchObject({
    ok: true,
    data: { entries: entriesBeforeRestart }
  });

  await page.reload();
  await page.getByRole('link', { name: '设置', exact: true }).click();
  await expect(page.getByText('已解锁', { exact: true })).toBeVisible();
  await expect(page.getByLabel('App Key')).toHaveValue('e2e-app-key');
  const sessionStorageAfterRestart = await page.evaluate(async () => {
    const extension = (
      globalThis as unknown as {
        chrome: { storage: { session: { get(key: null): Promise<Record<string, unknown>> } } };
      }
    ).chrome;
    return extension.storage.session.get(null);
  });
  expect(JSON.stringify(sessionStorageAfterRestart)).not.toContain('e2e-vault-password');
  expect(JSON.stringify(sessionStorageAfterRestart)).not.toContain('e2e-app-key');
  expect(JSON.stringify(sessionStorageAfterRestart)).not.toContain('e2e-secret');
  expect(JSON.stringify(sessionStorageAfterRestart)).not.toContain('e2e-token');
  await page.getByRole('button', { name: '立即锁定' }).click();
  await expect(page.getByText('已锁定', { exact: true })).toBeVisible();
  await page.getByLabel('保险库口令').fill('wrong-vault-password');
  await page.getByRole('button', { name: '解锁' }).click();
  await expect(page.getByText(/口令不正确或密文已损坏/)).toBeVisible();
  await expect(page.getByText(/requestId:/u)).toBeVisible();
  await expect(page.getByRole('button', { name: '复制 requestId' })).toBeVisible();
  await expect(page.getByRole('button', { name: '导出脱敏诊断' })).toBeVisible();
  await page.getByLabel('保险库口令').fill('e2e-vault-password');
  await page.getByRole('button', { name: '解锁' }).click();
  await expect(page.getByText('已解锁', { exact: true })).toBeVisible();
  await expect(page.getByLabel('App Key')).toHaveValue('e2e-app-key');

  await page.getByLabel('空闲自动锁定时间').selectOption('5');
  await page.getByRole('button', { name: '保存锁定策略' }).click();
  await expect(page.getByText(/连续 5 分钟未使用凭证后自动锁定/)).toBeVisible();
  const encryptedPolicySettings = await page.evaluate(async () => {
    const extension = (
      globalThis as unknown as {
        chrome: { storage: { local: { get(key: string): Promise<Record<string, unknown>> } } };
      }
    ).chrome;
    return extension.storage.local.get('gatewaySettings');
  });
  expect(JSON.stringify(encryptedPolicySettings)).not.toContain('idleTimeoutMinutes');

  await page.getByLabel('新保险库口令', { exact: true }).fill('e2e-rotated-vault-password');
  await page.getByLabel('确认新保险库口令', { exact: true }).fill('e2e-rotated-vault-password');
  await page.getByRole('button', { name: '更换口令' }).click();
  await expect(page.getByText('凭证已使用新 salt 和新口令重新加密。')).toBeVisible();
  await page.getByRole('button', { name: '立即锁定' }).click();
  await expect(page.getByText('已锁定', { exact: true })).toBeVisible();
  await page.getByLabel('保险库口令').fill('e2e-vault-password');
  await page.getByRole('button', { name: '解锁' }).click();
  await expect(page.getByText(/口令不正确或密文已损坏/)).toBeVisible();
  await page.getByLabel('保险库口令').fill('e2e-rotated-vault-password');
  await page.getByRole('button', { name: '解锁' }).click();
  await expect(page.getByText('已解锁', { exact: true })).toBeVisible();
  await expect(page.getByLabel('App Key')).toHaveValue('e2e-app-key');
  await expect(page.getByLabel('空闲自动锁定时间')).toHaveValue('5');

  await page.getByRole('link', { name: 'API 能力' }).click();
  await expect(page.locator('tbody tr')).toHaveCount(10);
  await expect(page.getByText('共 86 条，当前 1–10 条')).toBeVisible();
  await page.getByPlaceholder('搜索 API 方法').fill('alibaba.icbu.product.schema.add');
  await page.getByRole('button', { name: 'alibaba.icbu.product.schema.add', exact: true }).click();
  await expect(page.getByText(/该真实写能力未在当前扩展版本开放/)).toBeVisible();
  await expect(page.getByRole('button', { name: '调用能力' })).toBeDisabled();
  await page.getByLabel('关闭详情').click();

  await page.getByPlaceholder('搜索 API 方法').fill('alibaba.icbu.risk.send');
  await page.getByRole('button', { name: 'alibaba.icbu.risk.send' }).click();
  await expect(page.getByText(/WUA、UMID、IMEI、IMSI、MAC/)).toBeVisible();
  await expect(page.getByLabel('只读文档参数示例')).toBeVisible();
  await expect(page.getByRole('button', { name: '调用能力' })).toBeDisabled();
  await page.getByLabel('关闭详情').click();

  const platformGateErrors = await page.evaluate(async () => {
    const extension = (
      globalThis as unknown as {
        chrome: { runtime: { sendMessage(value: object): Promise<unknown> } };
      }
    ).chrome;
    return Promise.all([
      extension.runtime.sendMessage({
        requestId: crypto.randomUUID(),
        kind: 'gateway-request',
        operation: 'callCapability',
        payload: { method: 'alibaba.icbu.risk.send', parameters: {} }
      }),
      extension.runtime.sendMessage({
        requestId: crypto.randomUUID(),
        kind: 'gateway-request',
        operation: 'callCapability',
        payload: { method: 'alibaba.icbu.task.status.notify', parameters: {} }
      }),
      extension.runtime.sendMessage({
        requestId: crypto.randomUUID(),
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
  expect(JSON.stringify(platformGateErrors[2])).toContain('后台已在出网前拒绝');

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
  await page.getByRole('link', { name: '商品' }).click();
  await page.getByRole('button', { name: '新增', exact: true }).click();
  await expect(page.getByText('发现从旧版本迁移的本地草稿')).toBeVisible();
  await page.getByRole('button', { name: '继续本地草稿' }).click();
  await page.getByRole('button', { name: /6\. 检查与提交/ }).click();
  await expect(page.getByRole('button', { name: /发布商品/ })).toBeDisabled();
  await page.getByRole('button', { name: /4\. 商品详情/ }).click();
  await page.getByRole('button', { name: /更多选填信息/ }).click();
  await page.getByRole('button', { name: '详情模板' }).click();
  const templateDialog = page.getByRole('dialog', { name: '商品详情模板' });
  await expect(templateDialog.getByText('Company profile')).toBeVisible();
  await expect(templateDialog.getByRole('button', { name: '新建共享模板' })).toHaveCount(0);
  await page.getByRole('button', { name: '关闭商品详情模板' }).click();
  await page.getByRole('button', { name: /插入图库图片/ }).click();
  await expect(page.getByRole('heading', { name: '选择图库素材' })).toBeVisible();
  await page.getByRole('button', { name: '上传新素材' }).click();
  const uploadDialog = page.getByRole('dialog', { name: '上传图片到图库' });
  await expect(uploadDialog).toBeVisible();
  await expect(uploadDialog.locator('input[type="file"]')).toBeEnabled();
  await expect(uploadDialog.getByRole('textbox', { name: '外部图片 URL' })).toBeEnabled();
  await expect(uploadDialog.getByText(/单张最大 5 MiB/)).toBeVisible();
  await uploadDialog.getByRole('button', { name: '关闭上传图片到图库' }).click();
  await page.getByRole('button', { name: '完成选择' }).click();

  await page.getByRole('link', { name: '图库', exact: true }).click();
  await expect(page.getByRole('heading', { name: '图库' })).toBeVisible();
  await expect(page.getByRole('button', { name: '分组管理' })).toBeEnabled();
  await page.getByRole('button', { name: '分组管理' }).click();
  const photoGroupDialog = page.getByRole('dialog', { name: '图库分组管理' });
  await expect(photoGroupDialog.getByText(/新增、改名和删除会直接写入当前国际站账号/)).toBeVisible();
  await photoGroupDialog.getByRole('button', { name: '关闭', exact: true }).click();

  await page.getByRole('link', { name: 'RFQ' }).click();
  await expect(page.getByRole('heading', { name: 'RFQ 工作台' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'RFQ 权限检查失败' })).toBeVisible();

  await page.getByRole('link', { name: '订单' }).click();
  await expect(page.getByRole('heading', { name: '交易 / 订单工作台' })).toBeVisible();
  await expect(page.getByText(/完整详情明确标记为不可用/)).toBeVisible();
  await page.getByRole('button', { name: '信保订单草稿' }).click();
  await expect(page.getByText(/当前环境未开放信保订单创建.*REAL_MUTATION_DISABLED/)).toBeVisible();
  await expect(page.getByRole('button', { name: '创建信保订单（未开放）' })).toBeDisabled();

  await page.getByRole('link', { name: '国际物流' }).click();
  await expect(page.getByRole('heading', { name: '国际物流工作台' })).toBeVisible();
  await expect(page.getByText(/LOGISTICS_QUALIFICATION_REQUIRED/)).toBeVisible();
  await expect(page.getByRole('button', { name: '业务资格待验收' })).toBeDisabled();
  await page.getByRole('button', { name: '物流订单', exact: true }).click();
  await expect(page.getByRole('button', { name: '刷新' })).toBeDisabled();
  await page.getByRole('button', { name: '下单草稿' }).click();
  await expect(page.getByRole('button', { name: '真实下单保持禁用' })).toBeDisabled();

  await page.getByRole('link', { name: '数据洞察' }).click();
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
      requestId: crypto.randomUUID(),
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

  await page.getByRole('link', { name: '设置', exact: true }).click();
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
  const snapshot = JSON.parse(exportedDiagnostics) as { entries: { requestId?: unknown }[] };
  expect(snapshot.entries.length).toBeGreaterThan(0);
  expect(snapshot.entries.length).toBeLessThanOrEqual(100);
  expect(snapshot.entries.every((entry) => typeof entry.requestId === 'string')).toBe(true);

  await page.getByRole('button', { name: '清空诊断' }).click();
  const clearDiagnosticsDialog = page.getByRole('dialog', { name: '确认清空诊断' });
  await expect(clearDiagnosticsDialog).toBeVisible();
  await clearDiagnosticsDialog.getByRole('button', { name: '确认继续' }).click();
  await expect(page.getByText('诊断记录已清空。')).toBeVisible();
  await expect(page.getByText('0 条', { exact: true })).toBeVisible();

  await expect(page.getByRole('heading', { name: '本地数据与隐私' })).toBeVisible();
  const inventoryDownloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出数据清单' }).click();
  const inventoryDownload = await inventoryDownloadPromise;
  const inventoryPath = await inventoryDownload.path();
  if (!inventoryPath) throw new Error('Local data inventory download has no local path');
  const inventoryJson = await readFile(inventoryPath, 'utf8');
  expect(inventoryJson).toContain('credentials');
  expect(inventoryJson).not.toContain('e2e-secret');
  expect(inventoryJson).not.toContain('e2e-token');
  expect(inventoryJson).not.toContain('Extension draft detail');

  await expect(page.getByRole('button', { name: '彻底清除' })).toBeDisabled();
  await page.getByLabel('清除确认短语').fill('清除全部数据');
  await page.getByRole('button', { name: '彻底清除' }).click();
  await expect(page.getByText(/扩展本地数据和额外主机权限已清除/)).toBeVisible();
  const clearedState = await page.evaluate(async () => {
    const extension = (
      globalThis as unknown as {
        chrome: {
          storage: {
            local: { get(value: null): Promise<Record<string, unknown>> };
            session: { get(value: null): Promise<Record<string, unknown>> };
          };
        };
      }
    ).chrome;
    return {
      local: await extension.storage.local.get(null),
      session: await extension.storage.session.get(null),
      pageStorageLength: globalThis.localStorage.length
    };
  });
  expect(clearedState).toEqual({ local: {}, session: {}, pageStorageLength: 0 });

  await page.reload();
  await expect(page.getByRole('heading', { name: '先确认数据与调用边界' })).toBeVisible();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: '稍后，仅浏览' }).click();
  await page.evaluate(async () => {
    const extension = (
      globalThis as unknown as {
        chrome: { storage: { local: { set(value: object): Promise<void> } } };
      }
    ).chrome;
    await extension.storage.local.set({
      gatewaySettings: {
        version: 1,
        settings: {
          appKey: 'legacy-e2e-key',
          appSecret: 'legacy-e2e-secret',
          accessToken: 'legacy-e2e-token',
          endpoint: 'https://eco.taobao.com/router/rest',
          signMethod: 'hmac'
        }
      }
    });
  });
  await page.reload();
  await page.getByRole('link', { name: '设置', exact: true }).click();
  await expect(page.getByText('待迁移', { exact: true })).toBeVisible();
  await expect(page.getByText(/真实请求已停止读取该记录/)).toBeVisible();
  await page.getByLabel('新建保险库口令').fill('migrated-vault-password');
  await page.getByLabel('确认保险库口令').fill('migrated-vault-password');
  await page.getByRole('button', { name: '加密并迁移旧凭证' }).click();
  await expect(
    page.getByText('旧版明文凭证已原位加密，并在当前 Chrome 会话内保持可用。').first()
  ).toBeVisible();
  const migratedEncryptedSettings = await page.evaluate(async () => {
    const extension = (
      globalThis as unknown as {
        chrome: { storage: { local: { get(key: string): Promise<Record<string, unknown>> } } };
      }
    ).chrome;
    return extension.storage.local.get('gatewaySettings');
  });
  expect(migratedEncryptedSettings).toMatchObject({ gatewaySettings: { version: 2 } });
  expect(JSON.stringify(migratedEncryptedSettings)).not.toContain('legacy-e2e-secret');
  expect(JSON.stringify(migratedEncryptedSettings)).not.toContain('legacy-e2e-token');
});
