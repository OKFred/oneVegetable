import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Page } from '@playwright/test';
import { exerciseModeMenus, modeFailureLine } from '../lib/authorization-mode-ui';
import type { AuthorizationMode, Observation } from '../lib/authorization-mode-regression';
import type { ReadWireGuard } from '../lib/authorization-mode-wire';

type Binding = (source: unknown, input: Record<string, unknown>) => unknown;
async function observe(mode: AuthorizationMode, inventoryOnly = true) {
  const bindings = new Map<string, Binding>();
  let initialize: ((arg: { inventoryOnly: boolean }) => void) | undefined;
  let argument = { inventoryOnly: false };
  const page = {
    on: vi.fn(),
    exposeBinding: vi.fn((name: string, callback: Binding) => {
      bindings.set(name, callback);
    }),
    addInitScript: vi.fn((callback: typeof initialize, arg: typeof argument) => {
      initialize = callback;
      argument = arg;
    }),
    url: () => 'chrome-extension://fixture/options.html#/releases',
    goto: vi.fn().mockRejectedValue(new Error('STOP_BEFORE_BROWSER'))
  };
  const results: Observation[] = [];
  const guards = new Map<string, ReadWireGuard>();
  await expect(
    exerciseModeMenus(page as unknown as Page, mode, guards, results, inventoryOnly ? '10000001' : undefined)
  ).rejects.toThrow('UI_MENU_OPEN_FAILED');
  const before = bindings.get('__modeBeforeRead');
  const after = bindings.get('__modeAfterRead');
  if (!before || !after || !initialize) throw new Error('Observer missing');
  return { page, results, guards, before, after, initialize, argument };
}

const request = (source = 'absolute', kind = 'gateway-request') => ({
  requestId: 'inventory-read',
  kind,
  operation: 'getProductInventory',
  payload: { productId: '10000001', source, language: 'en_US' }
});
const summary = {
  source: 'absolute',
  protocol: 'iop',
  status: 'ready',
  productMatched: true,
  issueCount: 0,
  warehouseRows: 0,
  quantityCount: 3,
  availableQuantities: 2,
  unavailableReasons: ['QUANTITY_MISSING']
};

describe('inventory-only MV3 observer', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('allows valid context resolution before an unsupported SKU RPC with zero provider requests', async () => {
    const observer = await observe('iop-only');
    await observer.before(null, { ...request('sku', 'gallery-transfer-context'), requestId: 'context-read' });
    await observer.after(null, {
      requestId: 'context-read',
      responseRequestId: 'context-read',
      ok: true,
      contextValid: true
    });
    await observer.before(null, request('sku'));
    await observer.after(null, {
      requestId: 'inventory-read',
      responseRequestId: 'inventory-read',
      ok: false,
      error: { code: 'ALIBABA_IOP_METHOD_UNSUPPORTED', message: 'ALIBABA_IOP_METHOD_UNSUPPORTED' }
    });
    expect(observer.results.map((item) => ({ status: item.status, requests: item.requests }))).toEqual([
      { status: 'passed', requests: 0 },
      { status: 'unsupported', requests: 0 }
    ]);
    expect(observer.guards.size).toBe(0);
  });
  it.each([
    { kind: 'gallery-transfer-context', ok: false },
    { kind: 'gateway-request', ok: false },
    { kind: 'gallery-transfer-context', ok: true }
  ])('does not accept swallowed context errors as a valid unsupported result (%j)', async ({ kind, ok }) => {
    const observer = await observe('top-only');
    await observer.before(null, request('absolute', kind));
    await observer.after(null, {
      requestId: 'inventory-read',
      responseRequestId: 'inventory-read',
      ok,
      ...(ok
        ? {}
        : { error: { code: 'GALLERY_CONTEXT_UNAVAILABLE', message: 'GALLERY_CONTEXT_UNAVAILABLE' } })
    });
    expect(observer.results[0]).toMatchObject({ status: 'failed', requests: 0 });
    expect(observer.results[0]?.status).not.toBe('unsupported');
    expect(observer.guards.size).toBe(0);
  });
  it('redacts numbers, emails, tokens and explicit secrets from one diagnostic line', () => {
    const line = modeFailureLine(
      new Error(
        'Read 10000051287621 user@example.com access_token=token-value app_key=key-value known-private-value\n{"business":"raw-response"}'
      ),
      ['known-private-value']
    );
    for (const secret of [
      '10000051287621',
      'user@example.com',
      'token-value',
      'key-value',
      'known-private-value',
      'raw-response'
    ])
      expect(line).not.toContain(secret);
    expect(line).toContain('Read');
    expect(modeFailureLine(new Error('{"business":"do-not-print"}'))).toBe('Response body redacted');
  });
  it('reports a denied initialization operation without arming any provider guard', async () => {
    const observer = await observe('top-only');
    expect(() => observer.before(null, { ...request(), operation: 'saveSettings' })).toThrow(
      'UI_READ_OPERATION_DENIED:saveSettings'
    );
    expect(observer.guards.size).toBe(0);
  });
  it('records an unsupported RPC refusal as unsupported with zero provider outnetwork', async () => {
    const observer = await observe('iop-only');
    await observer.before(null, request('sku'));
    await observer.after(null, {
      requestId: 'inventory-read',
      responseRequestId: 'inventory-read',
      ok: false,
      error: { code: 'ALIBABA_IOP_METHOD_UNSUPPORTED', message: 'ALIBABA_IOP_METHOD_UNSUPPORTED' }
    });
    expect(observer.results[0]).toMatchObject({ status: 'unsupported', requests: 0 });
    expect(observer.guards.size).toBe(0);
  });
  it('opens only inventory when requested and leaves the default menu entry unchanged', async () => {
    const inventory = await observe('dual-top');
    expect(inventory.page.goto).toHaveBeenCalledWith(
      'chrome-extension://fixture/options.html?regression=inventory#/inventory',
      { waitUntil: 'domcontentloaded' }
    );
    expect(inventory.argument.inventoryOnly).toBe(true);
    const normal = await observe('dual-top', false);
    expect(normal.page.goto.mock.calls[0]?.[0]).toContain('#/dashboard');
    expect(normal.argument.inventoryOnly).toBe(false);
  });
  it.each([
    ['top-only', 'absolute', 'ALIBABA_IOP_AUTHORIZATION_REQUIRED'],
    ['iop-only', 'sku', 'ALIBABA_IOP_METHOD_UNSUPPORTED']
  ] as const)(
    'records %s/%s context refusal as unsupported, with no provider requests',
    async (mode, source, code) => {
      const observer = await observe(mode);
      await observer.before(null, request(source, 'gallery-transfer-context'));
      await observer.after(null, {
        requestId: 'inventory-read',
        responseRequestId: 'inventory-read',
        ok: false,
        error: { code, message: code }
      });
      expect(observer.guards.size).toBe(0);
      expect(observer.results).toHaveLength(1);
      expect(observer.results[0]).toMatchObject({ status: 'unsupported', requests: 0, code });
    }
  );
  it('rejects a different product before arming any provider request', async () => {
    const observer = await observe('iop-only');
    expect(() =>
      observer.before(null, {
        ...request(),
        payload: { productId: '99999999', source: 'absolute' }
      })
    ).toThrow('UI_INVENTORY_TARGET_MISMATCH');
    expect(observer.guards.size).toBe(0);
  });
  it('correlates an actual allowlisted wire read and retains only quantity metadata', async () => {
    const observer = await observe('dual-top');
    await observer.before(null, request());
    const guard = observer.guards.get('inventory-read');
    if (!guard) throw new Error('Guard missing');
    await guard.send(
      new Request('https://openapi-api.alibaba.com/rest/alibaba/icbu/product/get/v2', {
        method: 'POST',
        headers: { 'X-Request-ID': 'inventory-read' },
        body: new URLSearchParams({ product_id: '10000001', access_token: 'fixture-secret-token' })
      }),
      () => Promise.resolve(Response.json({ success: true }))
    );
    await observer.after(null, {
      requestId: 'inventory-read',
      responseRequestId: 'inventory-read',
      ok: true,
      inventory: { ...summary, rawResponse: 'fixture-business-body' }
    });
    expect(observer.results[0]).toMatchObject({
      status: 'passed',
      requests: 1,
      count: 2,
      inventoryEvidence: { source: 'absolute', protocol: 'iop', availableQuantities: 2, warehouseRows: 0 }
    });
    const receipt = JSON.stringify(observer.results);
    expect(receipt).not.toContain('fixture-secret-token');
    expect(receipt).not.toContain('fixture-business-body');
    expect(observer.guards.size).toBe(0);
  });
  it('keeps legal empty quantity evidence distinct from a failed read', async () => {
    const observer = await observe('iop-only');
    await observer.before(null, request());
    await observer.after(null, {
      requestId: 'inventory-read',
      responseRequestId: 'inventory-read',
      ok: true,
      inventory: { ...summary, status: 'no-data', quantityCount: 1, availableQuantities: 0 }
    });
    expect(observer.results[0]).toMatchObject({ status: 'empty', count: 0 });
  });
  it.each([
    { responseRequestId: 'another-request' },
    { inventory: { ...summary, protocol: 'top' } },
    { inventory: { ...summary, productMatched: false } },
    { inventory: { ...summary, availableQuantities: -1 } }
  ])('does not accept uncorrelated or malformed evidence %j', async (change) => {
    const observer = await observe('iop-only');
    await observer.before(null, request());
    await observer.after(null, {
      requestId: 'inventory-read',
      responseRequestId: 'inventory-read',
      ok: true,
      inventory: summary,
      ...change
    });
    expect(observer.results[0]?.status).toBe('failed');
  });
  it('projects browser results without forwarding quantity rows or unrelated response fields', async () => {
    const observer = await observe('iop-only');
    const runtime = {
      sendMessage: vi.fn(() =>
        Promise.resolve({
          requestId: 'inventory-read',
          ok: true,
          data: {
            productId: '10000001',
            source: 'absolute',
            protocol: 'iop',
            status: 'ready',
            records: [],
            issues: [],
            quantityEvidence: [
              { scope: 'spu', skuId: null, status: 'available', quantity: '0', reasonCode: null },
              {
                scope: 'sku',
                skuId: '9223372036854775807',
                status: 'available',
                quantity: '9223372036854775807',
                reasonCode: null
              },
              {
                scope: 'sku',
                skuId: '2',
                status: 'unavailable',
                quantity: null,
                reasonCode: 'QUANTITY_MISSING'
              }
            ],
            unrelated: 'fixture-private-body'
          }
        })
      )
    };
    const after = vi.fn((_input: unknown) => Promise.resolve());
    vi.stubGlobal('chrome', { runtime });
    vi.stubGlobal(
      '__modeBeforeRead',
      vi.fn(() => Promise.resolve())
    );
    vi.stubGlobal('__modeAfterRead', after);
    observer.initialize(observer.argument);
    await (runtime.sendMessage as unknown as (input: unknown) => Promise<unknown>)(request());
    expect(after.mock.calls[0]?.[0]).toMatchObject({
      responseRequestId: 'inventory-read',
      inventory: { availableQuantities: 2, quantityCount: 3, warehouseRows: 0 }
    });
    const metadata = JSON.stringify(after.mock.calls);
    expect(metadata).not.toContain('fixture-private-body');
    expect(metadata).not.toContain('9223372036854775807');
    expect(metadata).not.toContain('quantityEvidence');
  });
});
