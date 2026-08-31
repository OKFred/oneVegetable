import { mkdir, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { expect, test, type BrowserContext, type Page, type Request, type Response } from '@playwright/test';

interface OperationResult {
  operation: string;
  requestId: string | null;
  statusCode: number;
  outcome: 'passed' | 'permission-denied' | 'provider-error' | 'denied';
  errorCode: string | null;
  mockSentinelDetected: boolean;
}

interface RealWebSmokeReport {
  schemaVersion: 1;
  capturedAtUtc: string;
  gatewaySource: 'credential-bundle';
  results: OperationResult[];
  targetProductSchema: TargetProductSchemaResult | null;
}

interface TargetProductSchemaResult {
  productId: string;
  categoryId: number;
  language: 'zh_CN';
  requestId: string;
  sourceByteLength: number;
  fieldCount: number;
  blockingIssueCount: number;
  blockingIssues: TargetProductSchemaIssue[];
  noOp: boolean;
  safe: boolean;
}

interface TargetProductSchemaIssue {
  fieldKey: string;
  fieldId: string | null;
  fieldName: string | null;
  fieldType: string | null;
  rule: string;
  ruleValue: string | null;
  ruleAttributes: Record<string, string>;
  message: string;
  valueCount: number;
  nonEmptyValueCount: number;
}

interface BrowserSchemaField {
  key: string;
  id: string;
  name: string;
  type: string;
  values: { text: string }[];
  rules: { name: string; value: string; attributes: Record<string, string> }[];
  children: BrowserSchemaField[];
  instances: { fields: BrowserSchemaField[] }[];
}

interface BrowserSchemaModel {
  fields: BrowserSchemaField[];
}

interface BrowserSchemaInspection {
  xml: string;
  noOp: boolean;
  safe: boolean;
}

interface BrowserSchemaModule {
  parseProductSchemaXml(xml: string): BrowserSchemaModel;
  inspectProductSchemaSerialization(model: BrowserSchemaModel): BrowserSchemaInspection;
  validateProductSchemaModel(model: BrowserSchemaModel): {
    fieldKey: string;
    severity: string;
    rule: string;
    message: string;
  }[];
}

interface ProductSchemaPrerequisites {
  productId: string | null;
  categoryId: number | null;
}

const apiOrigin = 'http://127.0.0.1:8797';
const webOrigin = 'http://127.0.0.1:4175';
const reportPath = resolve('artifacts/real-web-smoke/report.json');
const mockSentinels = ['mock-solar-station', 'RFQ-20260812-001', 'Northwind Trading', 'supplier-enc-001'];

test('authenticated Web renders real read results without Mock fallback', async ({ page, context }) => {
  const results: OperationResult[] = [];
  const operationOrigins = new Set<string>();
  const productSchemaPrerequisites: ProductSchemaPrerequisites = {
    productId: null,
    categoryId: null
  };
  const captureTasks = new Set<Promise<void>>();
  const captureErrors: string[] = [];
  let targetProductSchema: TargetProductSchemaResult | null = null;
  page.on('response', (response) => {
    if (!response.url().endsWith('/api/v1/operations/call')) return;
    operationOrigins.add(new URL(response.url()).origin);
    const operation = readString(readRecord(response.request().postDataJSON()), 'operation');
    if (operation === 'renderProductSchema') return;
    const task = captureOperation(response, results, productSchemaPrerequisites)
      .catch((cause: unknown) => {
        captureErrors.push(cause instanceof Error ? cause.message : '无法读取 operation 响应');
      })
      .finally(() => captureTasks.delete(task));
    captureTasks.add(task);
  });
  page.on('requestfinished', (request) => {
    if (!request.url().endsWith('/api/v1/operations/call')) return;
    const operation = readString(readRecord(request.postDataJSON()), 'operation');
    if (operation !== 'renderProductSchema') return;
    const task = captureFinishedOperation(request, results, productSchemaPrerequisites)
      .catch((cause: unknown) => {
        captureErrors.push(cause instanceof Error ? cause.message : '无法读取 operation 响应');
      })
      .finally(() => captureTasks.delete(task));
    captureTasks.add(task);
  });

  try {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: '登录运营工作台' })).toBeVisible();
    await page.getByRole('button', { name: '初始化管理员' }).click();
    await page.getByLabel('管理员引导令牌').fill('real-web-smoke-bootstrap');
    await page.getByLabel('工作台用户名').fill('real-read-admin');
    await page.getByLabel('工作台密码').fill('Real-read-admin-2026!');
    await page.getByRole('button', { name: '创建管理员' }).click();

    await expect(page.getByRole('heading', { name: '运营总览' })).toBeVisible();
    await expect(page.getByTestId('data-source-status')).toHaveText(/Alibaba 实时数据/);
    await expectOperation(results, 'getDashboard', 'passed');
    targetProductSchema = await inspectTargetProductSchema(page, context, results);

    await openDomain(page, '商品', '商品管理');
    await expectOperation(results, 'listProducts', 'passed');
    await expectNoMockSentinel(results, 'listProducts');
    await expect
      .poll(
        () => productSchemaPrerequisites.productId !== null && productSchemaPrerequisites.categoryId !== null,
        { message: '真实商品列表应提供可用于 Schema 编辑的商品及类目 ID' }
      )
      .toBe(true);

    const productRows = page.getByRole('row').filter({ has: page.getByRole('button', { name: '编辑商品' }) });
    const editableProductIndexes: number[] = [];
    for (let index = 0; index < (await productRows.count()); index += 1) {
      if (!/auditing|draft|rejected/iu.test(await productRows.nth(index).innerText())) {
        editableProductIndexes.push(index);
      }
    }
    let renderSucceeded = false;
    let scoreSucceeded = false;
    for (const [attemptIndex, productIndex] of editableProductIndexes.slice(0, 5).entries()) {
      if (attemptIndex > 0) await page.getByRole('tab', { name: '商品列表' }).click();
      const previousAttemptCount = results.filter(
        (result) => result.operation === 'renderProductSchema'
      ).length;
      const previousScoreAttemptCount = results.filter(
        (result) => result.operation === 'getProductScore'
      ).length;
      await productRows.nth(productIndex).getByRole('button', { name: '编辑商品' }).click();
      await expect
        .poll(
          async () =>
            (await page.getByText('已渲染现有商品 Schema').isVisible()) ||
            results.filter((result) => result.operation === 'renderProductSchema').length >
              previousAttemptCount,
          { message: `第 ${attemptIndex + 1} 个真实商品应返回 schema.render 结果`, timeout: 15_000 }
        )
        .toBe(true);
      const attempt = results.filter((result) => result.operation === 'renderProductSchema').at(-1);
      if (attempt?.outcome === 'passed') {
        renderSucceeded = true;
        await expect
          .poll(
            () =>
              results.filter((result) => result.operation === 'getProductScore').length >
              previousScoreAttemptCount,
            { message: `第 ${attemptIndex + 1} 个真实商品应返回产品分结果`, timeout: 15_000 }
          )
          .toBe(true);
        const scoreAttempt = results.filter((result) => result.operation === 'getProductScore').at(-1);
        if (scoreAttempt?.outcome === 'passed') {
          scoreSucceeded = true;
          break;
        }
        expect(scoreAttempt?.outcome).toBe('provider-error');
        continue;
      }
      expect(attempt?.outcome).toBe('provider-error');
    }
    expect(renderSucceeded).toBe(true);
    expect(scoreSucceeded).toBe(true);
    await expect(page.getByLabel('商品明文 ID')).toHaveValue(/^[1-9][0-9]*$/);
    await expectOperation(results, 'renderProductSchema', 'passed');
    await expectNoMockSentinel(results, 'renderProductSchema');
    await expect(page.getByText('已渲染现有商品 Schema')).toBeVisible();
    await expect(page.getByRole('heading', { name: '编辑商品', exact: true })).toBeVisible();
    await expect(page.getByRole('navigation', { name: '商品编辑步骤' }).getByRole('button')).toHaveCount(6);
    await expect
      .poll(
        () =>
          page.locator('input:not([disabled]), textarea:not([disabled]), select:not([disabled])').evaluateAll(
            (elements) =>
              elements.filter((element) => {
                if (element instanceof HTMLInputElement && ['checkbox', 'radio'].includes(element.type)) {
                  return element.checked;
                }
                return 'value' in element && typeof element.value === 'string' && element.value.trim() !== '';
              }).length
          ),
        { message: '真实 schema.render 应回填至少一个可编辑字段' }
      )
      .toBeGreaterThan(0);
    await page.getByRole('button', { name: '高级模式' }).click();
    const xmlPreviewSummary = page.locator('details summary').filter({ hasText: 'Schema XML 预览' });
    await xmlPreviewSummary.click();
    await expect(page.locator('details pre')).toContainText('<itemSchema');
    await expect(xmlPreviewSummary.getByText('原样', { exact: true })).toBeVisible();
    expect(
      await page.evaluate(() => globalThis.localStorage.getItem('one-vegetable-product-editor-drafts-v2'))
    ).toBeNull();
    await expect(page.getByRole('button', { name: /更新商品/ })).toBeDisabled();
    await expectOperation(results, 'getProductScore', 'passed');

    await openDomain(page, '图库', '图库');
    await expectOperation(results, 'listPhotoGroups', 'passed');
    await expectOperation(results, 'listPhotos', 'passed');
    await expectNoMockSentinel(results, 'listPhotos');

    await openDomain(page, '订单', '交易 / 订单工作台');
    await expectOperation(results, 'listTradeOrders', 'passed');
    await expectNoMockSentinel(results, 'listTradeOrders');
    const orderButtons = page.getByRole('button', { name: '查看' });
    if ((await orderButtons.count()) > 0) {
      await orderButtons.first().click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await expectOperation(results, 'getTradeOrderAggregate', 'observed');
      await page.getByRole('button', { name: '关闭详情' }).click();
    }

    await openDomain(page, 'RFQ', 'RFQ 工作台');
    await expectOperation(results, 'getRfqEquity', 'observed');
    const equityResult = results.find((result) => result.operation === 'getRfqEquity');
    if (equityResult?.outcome === 'passed') {
      await expectOperation(results, 'listRfqs', 'observed');
    }
    const rfqResult = results.find((result) => result.operation === 'listRfqs') ?? equityResult;
    if (rfqResult?.outcome !== 'passed') {
      await expectNoMockContent(page);
      if (rfqResult?.outcome === 'permission-denied') {
        await expect(page.getByText('当前应用未获得 RFQ API 包权限')).toBeVisible();
      }
    }

    await openDomain(page, '数据洞察', '数据与供应商洞察');
    await expectOperation(results, 'getInsightsSupplierRank', 'observed');

    await openDomain(page, '管理后台', '管理后台');
    await expect(page.getByText('node / local-node', { exact: true })).toBeVisible();
    await expect(page.getByText(/^sqlite \/ v[1-9][0-9]*$/u)).toBeVisible();
    await expect(page.getByText('real', { exact: true })).toBeVisible();
    await expect(page.getByText(/凭据 完整 · 只读真实调用 已启用/)).toBeVisible();

    const csrfCookie = (await context.cookies(`${apiOrigin}/api/v1/operations/call`)).find(
      (cookie) => cookie.name === 'ov_csrf'
    );
    if (!csrfCookie) throw new Error('真实 Web 会话缺少 CSRF Cookie');
    const mutationRequestId = crypto.randomUUID();
    const mutationResponse = await page.request.post(`${apiOrigin}/api/v1/operations/call`, {
      headers: { Origin: webOrigin, 'X-CSRF-Token': csrfCookie.value },
      data: {
        requestId: mutationRequestId,
        operation: 'createProductGroup',
        payload: { name: 'must-not-be-created', parentId: -1 }
      }
    });
    const mutationBody: unknown = await mutationResponse.json();
    expect(mutationResponse.status()).toBe(403);
    expect(mutationResponse.headers()['x-request-id']).toBe(mutationRequestId);
    expect(readErrorCode(mutationBody)).toBe('MUTATION_FLAG_DISABLED');
    results.push({
      operation: 'createProductGroup',
      requestId: mutationRequestId,
      statusCode: mutationResponse.status(),
      outcome: 'denied',
      errorCode: readErrorCode(mutationBody),
      mockSentinelDetected: false
    });
  } finally {
    await Promise.all(captureTasks);
    await writeReport(results, targetProductSchema);
  }

  expect(captureErrors).toEqual([]);
  expect(results.every((result) => !result.mockSentinelDetected)).toBe(true);
  expect([...operationOrigins]).toEqual([apiOrigin]);
});

async function inspectTargetProductSchema(
  page: Page,
  context: BrowserContext,
  results: OperationResult[]
): Promise<TargetProductSchemaResult | null> {
  const productId = '1601928079741';
  const categoryId = 201712702;
  const requestId = crypto.randomUUID();
  const csrfCookie = (await context.cookies(`${apiOrigin}/api/v1/operations/call`)).find(
    (cookie) => cookie.name === 'ov_csrf'
  );
  if (!csrfCookie) throw new Error('真实 Web 会话缺少 CSRF Cookie');
  const response = await page.request.post(`${apiOrigin}/api/v1/operations/call`, {
    headers: { Origin: webOrigin, 'X-CSRF-Token': csrfCookie.value },
    data: {
      requestId,
      operation: 'renderProductSchema',
      payload: { productId, categoryId, language: 'zh_CN' }
    }
  });
  const body: unknown = await response.json();
  results.push({
    operation: 'renderProductSchema:target',
    requestId,
    statusCode: response.status(),
    outcome: response.ok() ? 'passed' : 'provider-error',
    errorCode: readErrorCode(body),
    mockSentinelDetected: mockSentinels.some((sentinel) => JSON.stringify(body).includes(sentinel))
  });
  if (!response.ok()) return null;
  const xml = readString(readRecord(readRecord(body).data), 'xml');
  if (!xml) throw new Error('目标商品 schema.render 未返回 XML');
  const schemaResult = await inspectXmlWithBrowserDom(page, xml);
  expect(schemaResult.safe).toBe(true);
  expect(schemaResult.noOp).toBe(true);
  return {
    productId,
    categoryId,
    language: 'zh_CN',
    requestId,
    sourceByteLength: new TextEncoder().encode(xml).byteLength,
    fieldCount: schemaResult.fieldCount,
    blockingIssueCount: schemaResult.blockingIssueCount,
    blockingIssues: schemaResult.blockingIssues,
    noOp: schemaResult.noOp,
    safe: schemaResult.safe
  };
}

async function inspectXmlWithBrowserDom(
  page: Page,
  xml: string
): Promise<{
  fieldCount: number;
  blockingIssueCount: number;
  blockingIssues: TargetProductSchemaIssue[];
  noOp: boolean;
  safe: boolean;
}> {
  const modulePath = resolve('packages/core/src/product-schema.ts').replaceAll('\\', '/');
  const moduleUrl = `${webOrigin}/@fs/${modulePath}`;
  return page.evaluate(
    async ({ sourceXml, sourceModuleUrl }) => {
      const moduleValue: unknown = await import(sourceModuleUrl);
      if (typeof moduleValue !== 'object' || moduleValue === null) {
        throw new Error('无法加载商品 Schema 浏览器模块');
      }
      const candidate = moduleValue as Partial<BrowserSchemaModule>;
      if (
        typeof candidate.parseProductSchemaXml !== 'function' ||
        typeof candidate.inspectProductSchemaSerialization !== 'function' ||
        typeof candidate.validateProductSchemaModel !== 'function'
      ) {
        throw new Error('商品 Schema 浏览器模块接口不完整');
      }
      const schemaModule = candidate as BrowserSchemaModule;
      const model = schemaModule.parseProductSchemaXml(sourceXml);
      const inspection = schemaModule.inspectProductSchemaSerialization(model);
      const findField = (fields: BrowserSchemaField[], key: string): BrowserSchemaField | null => {
        for (const field of fields) {
          if (field.key === key) return field;
          const child = findField(field.children, key);
          if (child) return child;
          for (const instance of field.instances) {
            const instanceField = findField(instance.fields, key);
            if (instanceField) return instanceField;
          }
        }
        return null;
      };
      const blockingIssues = schemaModule
        .validateProductSchemaModel(model)
        .filter((issue) => issue.severity === 'error')
        .map(({ fieldKey, rule, message }) => {
          const field = findField(model.fields, fieldKey);
          const fieldRule = field?.rules.find((candidate) => candidate.name === rule);
          return {
            fieldKey,
            fieldId: field?.id ?? null,
            fieldName: field?.name ?? null,
            fieldType: field?.type ?? null,
            rule,
            ruleValue: fieldRule?.value ?? null,
            ruleAttributes: fieldRule?.attributes ?? {},
            message,
            valueCount: field?.values.length ?? 0,
            nonEmptyValueCount: field?.values.filter((value) => value.text.trim() !== '').length ?? 0
          };
        });
      if (inspection.xml !== sourceXml) throw new Error('无编辑序列化未原样返回源 XML');
      return {
        fieldCount: model.fields.length,
        blockingIssueCount: blockingIssues.length,
        blockingIssues,
        noOp: inspection.noOp,
        safe: inspection.safe
      };
    },
    { sourceXml: xml, sourceModuleUrl: moduleUrl }
  );
}

async function openDomain(page: Page, navigation: string, heading: string): Promise<void> {
  await page.getByRole('link', { name: navigation, exact: true }).click();
  await expect(page.getByRole('heading', { name: heading })).toBeVisible();
}

async function captureFinishedOperation(
  request: Request,
  results: OperationResult[],
  productSchemaPrerequisites: ProductSchemaPrerequisites
): Promise<void> {
  const response = await request.response();
  if (response) await captureOperation(response, results, productSchemaPrerequisites);
}

async function expectOperation(
  results: readonly OperationResult[],
  operation: string,
  expected: 'passed' | 'observed'
): Promise<void> {
  await expect
    .poll(
      () =>
        results.some(
          (result) =>
            result.operation === operation && (expected === 'observed' || result.outcome === expected)
        ),
      { message: `${operation} should be ${expected}` }
    )
    .toBe(true);
}

async function captureOperation(
  response: Response,
  results: OperationResult[],
  productSchemaPrerequisites: ProductSchemaPrerequisites
): Promise<void> {
  const requestBody = readRecord(response.request().postDataJSON());
  const operation = readString(requestBody, 'operation') ?? 'unknown';
  const responseBody: unknown = await response.json();
  const body = readRecord(responseBody);
  const serialized = JSON.stringify(responseBody);
  const errorCode = readErrorCode(responseBody);
  if (response.ok() && operation === 'listProducts') {
    collectProductSchemaPrerequisites(body.data, productSchemaPrerequisites);
  }
  results.push({
    operation,
    requestId: readString(body, 'requestId'),
    statusCode: response.status(),
    outcome: response.ok() ? 'passed' : errorCode === '11' ? 'permission-denied' : 'provider-error',
    errorCode,
    mockSentinelDetected: mockSentinels.some((sentinel) => serialized.includes(sentinel))
  });
}

function collectProductSchemaPrerequisites(value: unknown, prerequisites: ProductSchemaPrerequisites): void {
  const items = readRecord(value).items;
  if (!Array.isArray(items)) return;
  for (const item of items) {
    const product = readRecord(item);
    const productId = readString(product, 'id');
    const categoryId = readNumber(product, 'categoryId');
    if (productId && categoryId !== null) {
      prerequisites.productId = productId;
      prerequisites.categoryId = categoryId;
      return;
    }
  }
}

async function expectNoMockSentinel(results: readonly OperationResult[], operation: string): Promise<void> {
  await expect
    .poll(() => results.find((result) => result.operation === operation)?.mockSentinelDetected, {
      message: `${operation} should not contain a Mock sentinel`
    })
    .toBe(false);
}

async function expectNoMockContent(page: Page): Promise<void> {
  for (const sentinel of mockSentinels) {
    await expect(page.locator('body')).not.toContainText(sentinel);
  }
}

function readErrorCode(value: unknown): string | null {
  const error = readRecord(readRecord(value).error);
  return readString(error, 'code');
}

function readRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(record: Record<string, unknown>, key: string): string | null {
  return typeof record[key] === 'string' ? record[key] : null;
}

function readNumber(record: Record<string, unknown>, key: string): number | null {
  return typeof record[key] === 'number' && Number.isFinite(record[key]) ? record[key] : null;
}

async function writeReport(
  results: readonly OperationResult[],
  targetProductSchema: TargetProductSchemaResult | null
): Promise<void> {
  const report: RealWebSmokeReport = {
    schemaVersion: 1,
    capturedAtUtc: new Date().toISOString(),
    gatewaySource: 'credential-bundle',
    results: [...results],
    targetProductSchema
  };
  const temporaryPath = `${reportPath}.tmp`;
  await mkdir(resolve(reportPath, '..'), { recursive: true });
  await writeFile(temporaryPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await rename(temporaryPath, reportPath);
}
