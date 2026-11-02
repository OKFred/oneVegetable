import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { expect, type Page } from '@playwright/test';
import { GatewayException } from '../../packages/core/src/errors';
import { sanitizeDiagnosticMessage } from '../../packages/core/src/diagnostics';
import {
  classify,
  expectation,
  isRow,
  type AuthorizationMode,
  type Observation
} from './authorization-mode-regression';
import { ReadWireGuard } from './authorization-mode-wire';
import type { OperationId } from '../../packages/core/src/types';

export function modeFailureLine(error: unknown, secrets: readonly string[] = []): string {
  let message = error instanceof Error ? error.message : 'Unknown failure';
  for (const secret of secrets) if (secret) message = message.split(secret).join('[redacted]');
  const first =
    message
      .split(/\r?\n/u)
      .find((line) => line.trim())
      ?.trim() ?? 'Unknown failure';
  if (/^[{[]/u.test(first) || /\bresponse(?:\s+body)?\s*[:=]\s*[{[]/iu.test(first))
    return 'Response body redacted';
  return sanitizeDiagnosticMessage(first)
    .replace(/\bBearer\s+\S+/giu, 'Bearer [redacted]')
    .replace(/\b(?:app[_-]?key|refresh[_-]?token|token|sign(?:ature)?)\s*[:=]\s*\S+/giu, '[secret redacted]')
    .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/gu, '[email]')
    .replace(/\b\d+\b/gu, '[number]')
    .slice(0, 240);
}

/** Watches actual options-page RPCs; refuses any operation outside the independent read allowlist. */
export async function exerciseModeMenus(
  page: Page,
  mode: AuthorizationMode,
  guards: Map<string, ReadWireGuard>,
  results: Observation[],
  inventoryProductId?: string
) {
  if (inventoryProductId !== undefined && !/^[1-9][0-9]*$/u.test(inventoryProductId))
    throw new Error('UI_INVENTORY_TARGET_INVALID');
  const pending = new Map<
    string,
    {
      guard: ReadWireGuard;
      record: Observation;
      supported: boolean;
      kind: string;
      source?: string;
    }
  >();
  const inventoryReads: {
    kind: string;
    source: string;
    record: Observation;
    detail?: Record<string, unknown>;
  }[] = [];
  const exactProductReads = new Set<string>();
  const inventoryChecks: {
    source: string;
    status: Observation['status'];
    requestId: string;
    requests: number;
    expectedProtocol: string | null;
    evidence: Observation['inventoryEvidence'] | null;
    displayChecked: boolean;
  }[] = [];
  const errors: string[] = [];
  const pages: { route: string; heading: boolean; completed: boolean }[] = [];
  const mediaChecks: { feature: string; guidance: boolean; expected: boolean }[] = [];
  page.on('pageerror', (error) => errors.push(error.name));
  await page.exposeBinding('__modeBeforeRead', (_source, input: unknown) => {
    if (!isRow(input) || typeof input.requestId !== 'string' || typeof input.operation !== 'string')
      throw new Error('UI_READ_MESSAGE_INVALID');
    const operation = input.operation as OperationId;
    if (
      inventoryProductId !== undefined &&
      operation === 'listProducts' &&
      isRow(input.payload) &&
      input.payload.productId === inventoryProductId
    )
      exactProductReads.add(input.requestId);
    const source =
      inventoryProductId !== undefined && operation === 'getProductInventory'
        ? isRow(input.payload)
          ? input.payload.source
          : null
        : undefined;
    if (
      source !== undefined &&
      (typeof source !== 'string' ||
        !['product', 'sku', 'absolute'].includes(source) ||
        !isRow(input.payload) ||
        input.payload.productId !== inventoryProductId)
    )
      throw new Error('UI_INVENTORY_TARGET_MISMATCH');
    let expected: ReturnType<typeof expectation>;
    try {
      expected = expectation(mode, operation, input.payload);
    } catch {
      const denied =
        'UI_READ_OPERATION_DENIED:' +
        (/^[A-Za-z][A-Za-z0-9]{0,79}$/u.test(operation) ? operation : 'redacted');
      errors.push(denied);
      throw new Error(denied);
    }
    const guard = new ReadWireGuard();
    guard.arm(input.requestId, expected.rules, expected.protocol);
    const record: Observation = {
      id: (input.kind === 'gallery-transfer-context' ? 'ui-context-' : 'ui-') + operation,
      operation,
      expectedProtocol: expected.protocol,
      requestId: input.requestId,
      status: 'failed',
      requests: 0
    };
    pending.set(input.requestId, {
      guard,
      record,
      supported: expected.supported,
      kind: String(input.kind),
      ...(typeof source === 'string' ? { source } : {})
    });
    if (input.kind === 'gateway-request') guards.set(input.requestId, guard);
  });
  await page.exposeBinding('__modeAfterRead', (_source, input: unknown) => {
    if (!isRow(input) || typeof input.requestId !== 'string') throw new Error('UI_READ_RESULT_INVALID');
    const current = pending.get(input.requestId);
    if (!current) throw new Error('UI_READ_CORRELATION_INVALID');
    const snapshot = current.guard.snapshot();
    const record = current.record;
    record.requests = snapshot.events.length;
    if (input.ok === true) record.status = 'passed';
    else if (isRow(input.error) && typeof input.error.code === 'string')
      Object.assign(
        record,
        classify(
          new GatewayException({
            code: input.error.code,
            message: typeof input.error.message === 'string' ? input.error.message : input.error.code,
            retryable: false,
            ...(typeof input.error.subCode === 'string' ? { subCode: input.error.subCode } : {})
          }),
          current.supported
        )
      );
    let detail: Record<string, unknown> | undefined;
    if (current.source && input.responseRequestId !== input.requestId) {
      record.status = 'failed';
      record.code = 'UI_INVENTORY_CORRELATION_INVALID';
    } else if (
      current.source &&
      current.kind === 'gallery-transfer-context' &&
      input.ok === true &&
      input.contextValid !== true
    ) {
      record.status = 'failed';
      record.code = 'UI_CONTEXT_RESULT_INVALID';
    } else if (
      current.source &&
      current.kind === 'gateway-request' &&
      input.ok === true &&
      !current.supported
    ) {
      record.status = 'failed';
      record.code = 'UNEXPECTED_UNSUPPORTED_OPERATION_SUCCESS';
    } else if (current.source && current.kind === 'gateway-request' && input.ok === true) {
      const value = input.inventory;
      if (
        !isRow(value) ||
        value.productMatched !== true ||
        value.source !== current.source ||
        value.protocol !== record.expectedProtocol ||
        !['ready', 'no-data'].includes(String(value.status)) ||
        value.issueCount !== 0 ||
        ![value.warehouseRows, value.quantityCount, value.availableQuantities].every(
          (count) => typeof count === 'number' && Number.isSafeInteger(count) && count >= 0
        ) ||
        !Array.isArray(value.unavailableReasons) ||
        !value.unavailableReasons.every(
          (reason: unknown) => typeof reason === 'string' && /^[A-Z0-9_]{1,100}$/u.test(reason)
        )
      ) {
        record.status = 'failed';
        record.code =
          isRow(value) && typeof value.reasonCode === 'string' && /^[A-Z0-9_]{1,100}$/u.test(value.reasonCode)
            ? value.reasonCode
            : 'INVENTORY_RESPONSE_INVALID';
      } else {
        detail = {
          status: value.status,
          quantityCount: value.quantityCount,
          availableQuantities: value.availableQuantities,
          warehouseRows: value.warehouseRows
        };
        record.inventoryEvidence = {
          protocol: value.protocol as string,
          source: current.source,
          availableQuantities: value.availableQuantities as number,
          unavailableReasons: value.unavailableReasons as string[],
          warehouseRows: value.warehouseRows as number
        };
        record.count =
          current.source === 'absolute'
            ? record.inventoryEvidence.availableQuantities
            : record.inventoryEvidence.warehouseRows;
        record.status = record.count ? 'passed' : 'empty';
      }
    }
    if (snapshot.blocked) {
      record.status = 'failed';
      record.code = 'READ_GUARD_DENIED';
      record.wireDenials = snapshot.denied;
    }
    current.guard.disarm();
    guards.delete(input.requestId);
    pending.delete(input.requestId);
    results.push(record);
    if (current.source)
      inventoryReads.push({
        kind: current.kind,
        source: current.source,
        record,
        ...(detail ? { detail } : {})
      });
  });
  await page.addInitScript(
    ({ inventoryOnly }) => {
      type Message = Record<string, unknown>;
      const root = globalThis as unknown as {
        chrome?: { runtime: { sendMessage(message: Message): Promise<unknown> } };
        __modeBeforeRead(message: Message): Promise<void>;
        __modeAfterRead(message: Message): Promise<void>;
      };
      const runtime = root.chrome?.runtime;
      if (!runtime) return;
      const original = runtime.sendMessage.bind(runtime);
      runtime.sendMessage = async (message) => {
        if (
          message.kind !== 'gateway-request' &&
          !(
            inventoryOnly &&
            message.kind === 'gallery-transfer-context' &&
            message.operation === 'getProductInventory'
          )
        )
          return original(message);
        // No secret-bearing vault payload is forwarded to the observer.
        await root.__modeBeforeRead({
          kind: message.kind,
          operation: message.operation,
          payload: message.payload,
          requestId: message.requestId
        });
        try {
          const result = await original(message);
          const value = result as { ok?: unknown; error?: unknown; requestId?: unknown; data?: Message };
          const data = value.data;
          const entries = Array.isArray(data?.quantityEvidence) ? (data.quantityEvidence as Message[]) : [];
          await root.__modeAfterRead({
            requestId: message.requestId,
            responseRequestId: value.requestId,
            ok: value.ok,
            error: value.error,
            ...(inventoryOnly &&
            message.operation === 'getProductInventory' &&
            message.kind === 'gallery-transfer-context'
              ? {
                  contextValid:
                    !!data &&
                    Object.keys(data).every((key) => ['identity', 'gateway', 'storage'].includes(key)) &&
                    typeof data.identity === 'string' &&
                    data.identity.length > 0 &&
                    data.identity.length <= 128 &&
                    typeof data.gateway === 'string' &&
                    data.gateway.length > 0 &&
                    data.gateway.length <= 128 &&
                    (data.storage === null ||
                      (typeof data.storage === 'string' &&
                        data.storage.length > 0 &&
                        data.storage.length <= 128))
                }
              : {}),
            ...(inventoryOnly &&
            message.operation === 'getProductInventory' &&
            message.kind === 'gateway-request' &&
            data
              ? {
                  inventory: {
                    source: data.source,
                    protocol: data.protocol,
                    status: data.status,
                    reasonCode: data.reasonCode,
                    productMatched: data.productId === (message.payload as Message).productId,
                    warehouseRows: Array.isArray(data.records) ? data.records.length : -1,
                    issueCount: Array.isArray(data.issues) ? data.issues.length : -1,
                    quantityCount: entries.length,
                    availableQuantities: entries.filter((item) => item.status === 'available').length,
                    unavailableReasons: [
                      ...new Set(
                        entries.flatMap((item) =>
                          typeof item.reasonCode === 'string' ? [item.reasonCode] : []
                        )
                      )
                    ]
                  }
                }
              : {})
          });
          return result;
        } catch {
          await root.__modeAfterRead({
            requestId: message.requestId,
            ok: false,
            error: { code: 'RUNTIME_READ_FAILED', message: 'RUNTIME_READ_FAILED' }
          });
          throw new Error('RUNTIME_READ_FAILED');
        }
      };
    },
    { inventoryOnly: inventoryProductId !== undefined }
  );
  const base = page.url().split('#')[0];
  if (!base) throw new Error('UI_WORKBENCH_URL_REQUIRED');
  for (const route of inventoryProductId !== undefined
    ? ['inventory']
    : [
        'dashboard',
        'products',
        'photos',
        'photos/videos',
        'inventory',
        'orders',
        'rfqs',
        'logistics',
        'insights',
        'capabilities',
        'templates',
        'logs',
        'releases',
        'settings'
      ]) {
    // A document navigation installs the observer before app startup, not after client construction.
    console.log(JSON.stringify({ mode, page: route, phase: 'opening' }));
    try {
      await page.goto(base + '?regression=' + encodeURIComponent(route) + '#/' + route, {
        waitUntil: 'domcontentloaded'
      });
      await page.waitForSelector('h1, h2', { timeout: 30_000 });
    } catch (error) {
      throw new Error(
        'UI_MENU_OPEN_FAILED:' +
          route.replaceAll('/', '_') +
          ':' +
          (error instanceof Error ? error.name : 'unknown'),
        { cause: error }
      );
    }
    if (route === 'insights')
      await page.getByRole('button', { name: /^(采购供应商|Purchasing suppliers)$/u }).click();
    await delay(1200);
    const started = Date.now();
    while (pending.size && Date.now() - started < 90_000) await delay(200);
    if (inventoryProductId !== undefined && pending.size === 0) {
      await page.getByRole('button', { name: /^(筛选|Filters)$/u }).click();
      const filters = page.getByRole('dialog', { name: /^(筛选|Filters)$/u });
      await filters.getByLabel(/^(商品 ID|Product ID)$/u).fill(inventoryProductId);
      await filters.getByRole('button', { name: /^(应用筛选|Apply filters)$/u }).click();
      await expect(filters).toBeHidden();
      await expect
        .poll(
          () => results.some((item) => exactProductReads.has(item.requestId) && item.status === 'passed'),
          { timeout: 90_000 }
        )
        .toBe(true);
      const rows = page.locator('table tbody tr');
      await expect(rows).toHaveCount(1);
      await expect(rows.first().getByText(inventoryProductId, { exact: true })).toBeVisible();
      for (const source of ['product', 'sku', 'absolute'] as const) {
        await page.getByTestId('inventory-source').selectOption(source);
        const before = inventoryReads.length;
        await rows
          .first()
          .getByRole('button', {
            name: new RegExp('(?:：商品 |: product )' + inventoryProductId + '$', 'u')
          })
          .click();
        const drawer = page.getByRole('dialog', { name: /^(库存|Inventory)$/u });
        await expect(drawer).toBeVisible();
        await expect(drawer.getByTestId('inventory-drawer-source')).toHaveValue(source);
        await expect
          .poll(
            () =>
              pending.size === 0 &&
              inventoryReads
                .slice(before)
                .some((item) => item.kind === 'gateway-request' || item.record.status !== 'passed'),
            { timeout: 90_000 }
          )
          .toBe(true);
        const reads = inventoryReads.slice(before);
        const expected = expectation(mode, 'getProductInventory', { productId: inventoryProductId, source });
        const rpc = reads.filter((read) => read.kind === 'gateway-request');
        const read = expected.supported
          ? (rpc[0] ?? reads.find((item) => item.record.status !== 'passed'))
          : reads.find((item) => item.record.status === 'unsupported');
        if (!read) throw new Error('UI_INVENTORY_READ_NOT_OBSERVED');
        expect(reads.every((item) => item.source === source)).toBe(true);
        // DataTable's selection count is a later, separate live region.
        const state = drawer.locator('p[aria-live="polite"]').first();
        if (!expected.supported) {
          expect(reads.reduce((sum, item) => sum + item.record.requests, 0)).toBe(0);
          expect(
            reads.every(
              (item) =>
                item.record.status === 'unsupported' ||
                (item.kind === 'gallery-transfer-context' && item.record.status === 'passed')
            )
          ).toBe(true);
          expect(read.record.status).toBe('unsupported');
          await expect(drawer.getByRole('alert')).toContainText(read.record.code ?? 'MISSING_ERROR_CODE');
          await expect(state).toHaveText(/^(查询失败|Query failed)$/u);
        } else if (['passed', 'empty'].includes(read.record.status)) {
          expect(rpc).toHaveLength(1);
          expect(read.record.requests).toBe(1);
          await expect(drawer).toContainText(String(expected.protocol).toUpperCase());
          if (source === 'absolute') {
            const available = read.record.inventoryEvidence?.availableQuantities ?? 0;
            await expect(state).toHaveText(
              available
                ? /^(已返回数量证据（非可写基线）|Quantity evidence returned \(not a writable baseline\))$/u
                : /^(无可核验数量（不是 0）|No verifiable quantity \(not zero\))$/u
            );
            await expect(drawer.getByTestId('inventory-evidence-count')).toContainText(
              String(available) + '/' + String(read.detail?.quantityCount)
            );
            await expect(
              drawer.getByRole('columnheader', { name: /^(库存编码|Inventory code)$/u })
            ).toHaveCount(0);
          } else {
            await expect(state).toHaveText(
              read.record.status === 'empty'
                ? /^(未返回库存记录|No inventory records returned)$/u
                : /^(已返回库存|Inventory returned)$/u
            );
          }
          if (read.record.status === 'empty')
            await expect(drawer.getByRole('cell', { name: '0', exact: true })).toHaveCount(0);
        } else {
          await expect(state).toHaveText(/^(查询失败|Query failed|数据待核对|Needs verification)$/u);
          await expect(drawer.getByRole('alert')).toBeVisible();
        }
        inventoryChecks.push({
          source,
          status: read.record.status,
          requestId: read.record.requestId,
          requests: reads.reduce((sum, item) => sum + item.record.requests, 0),
          expectedProtocol: expected.protocol,
          evidence: read.record.inventoryEvidence ?? null,
          displayChecked: true
        });
        await drawer.getByRole('button', { name: /^(关闭详情|Close details)$/u, exact: true }).click();
        await expect(drawer).toBeHidden();
      }
    }
    if (route === 'insights' && pending.size === 0) {
      const read = results.findLast((item) => item.operation === 'listInsightsSuppliers');
      if (!read) throw new Error('SUPPLIER_READ_NOT_OBSERVED');
      const count = await page.getByTestId('insights-supplier-count').innerText();
      const unknown = /^(数量未知|Count unknown)$/u.test(count.trim());
      if ((read.status === 'passed') === unknown) throw new Error('SUPPLIER_COUNT_NOT_CORRELATED_WITH_READ');
    }
    if (route === 'photos' && pending.size === 0) {
      // Inspect the real preflight only. No file, confirmation or mutation is submitted.
      await page.getByRole('button', { name: /^(导入|Import)$/u, exact: true }).click();
      const dialog = page.getByRole('dialog').filter({ has: page.getByTestId('gallery-transfer-prepare') });
      await dialog.waitFor({ state: 'visible' });
      const checkingStarted = Date.now();
      while (await dialog.getByRole('status').count()) {
        if (Date.now() - checkingStarted > 15_000) throw new Error('UI_MEDIA_PREFLIGHT_TIMEOUT');
        await delay(100);
      }
      const guidance = await dialog.getByTestId('media-error-guidance').isVisible();
      const expected = mode === 'iop-only';
      if (guidance !== expected) throw new Error('UI_MEDIA_IMPORT_GUIDANCE_MISMATCH');
      if (expected) {
        if (!(await dialog.getByRole('alert').innerText()).includes('GALLERY_READBACK_UNVERIFIED'))
          throw new Error('UI_MEDIA_IMPORT_REASON_INVALID');
        if (!(await dialog.getByTestId('gallery-transfer-prepare').isDisabled()))
          throw new Error('UI_MEDIA_IMPORT_NOT_BLOCKED');
        if ((await dialog.getByTestId('media-authorization-settings').getAttribute('href')) !== '#/settings')
          throw new Error('UI_MEDIA_SETTINGS_ENTRY_INVALID');
      } else if (await dialog.getByRole('alert').count()) {
        throw new Error('UI_MEDIA_IMPORT_PREFLIGHT_UNAVAILABLE');
      }
      mediaChecks.push({ feature: 'photo-import', guidance, expected });
      await dialog.getByRole('button', { name: /^(取消|Cancel)$/u, exact: true }).click();
    }
    if (route === 'photos/videos' && pending.size === 0) {
      const read = results.findLast((item) => item.operation === 'listVideos');
      const expected =
        !!read &&
        [
          'ALIBABA_IOP_BUSINESS_REJECTED',
          'ALIBABA_IOP_METHOD_UNSUPPORTED',
          'ALIBABA_IOP_PARAMETER_UNSUPPORTED'
        ].includes(read.code ?? '');
      const guidance = await page.getByTestId('media-error-guidance').isVisible();
      if (guidance !== expected) throw new Error('UI_MEDIA_VIDEO_GUIDANCE_MISMATCH');
      mediaChecks.push({ feature: 'video-query', guidance, expected });
    }
    pages.push({
      route,
      heading: await page.locator('h1, h2').first().isVisible(),
      completed: pending.size === 0
    });
    console.log(
      JSON.stringify({
        mode,
        page: route,
        pending: pending.size,
        observed: results.length,
        scriptErrors: errors.length
      })
    );
    if (pending.size) break;
  }
  return { pages, mediaChecks, inventoryChecks, scriptErrors: errors, id: randomUUID() };
}
