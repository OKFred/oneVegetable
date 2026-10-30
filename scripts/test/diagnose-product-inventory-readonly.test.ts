import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fixture from '../../mock/data/product-inventory-readback-diagnostic.json';
import { IOP_BUSINESS_ENDPOINT } from '../../packages/core/src/alibaba-iop';
import type { GatewayCredentials } from '../../packages/core/src/types';
import type { NetworkTransport } from '../../packages/core/src/network';
import { installNodeXmlDomGlobals } from '../node-xml-dom';
import {
  freezeInventoryProductIds,
  INVENTORY_DIAGNOSTIC_PATHS,
  InventoryReadonlyTransport,
  inventoryFieldEvidence,
  inventoryListEvidence,
  inventorySchemaEvidence,
  productInventoryEvidence,
  parseInventoryDiagnosticOptions,
  assertInventoryDiagnosticPaths,
  createInventoryDiagnosticReader,
  runInventoryReadonlyDiagnostic,
  runInventoryDiagnosticCli,
  type InventoryDiagnosticReport
} from '../diagnose-product-inventory-readonly';

let restore: () => void;
beforeEach(() => {
  restore = installNodeXmlDomGlobals();
});
afterEach(() => {
  restore();
  vi.restoreAllMocks();
});
const credentials: GatewayCredentials = {
  ...fixture.credentials,
  protocol: 'iop',
  endpoint: IOP_BUSINESS_ENDPOINT,
  signMethod: 'hmac-sha256'
};
const productIds = [fixture.productIds[0] ?? '', fixture.productIds[1] ?? ''] as const;
function product(productId: string = productIds[0]) {
  const data = structuredClone(fixture.product);
  data.product_info.basic_info.product_id = productId;
  return data;
}
async function harness(
  options: {
    reject?: boolean;
    missingCategory?: boolean;
    changeAfterRead?: boolean;
    redirect?: boolean;
    nullInventory?: boolean;
    pending?: boolean;
    productIds?: readonly string[];
  } = {}
) {
  let changed = false;
  const check = vi.fn(() =>
    changed ? Promise.reject(new Error('INVENTORY_DIAG_CONTEXT_CHANGED')) : Promise.resolve()
  );
  const send = vi.fn<NetworkTransport['send']>((input, init) => {
    if (options.reject) return Promise.reject(new Error(fixture.privateText));
    const url = new URL(input instanceof URL ? input.href : typeof input === 'string' ? input : input.url);
    if (options.redirect)
      return Promise.resolve(
        new Response(null, { status: 302, headers: { Location: 'https://example.invalid' } })
      );
    const body = init.body;
    if (!(body instanceof URLSearchParams)) throw new Error('Expected form');
    const productId = body.get('product_id') ?? productIds[0];
    let data: unknown;
    if (url.pathname === '/rest' + INVENTORY_DIAGNOSTIC_PATHS.product) {
      const value = product(productId);
      if (options.pending) value.product_info.basic_info.audit_status = 'pending';
      Reflect.set(value.product_info.basic_info, 'product_id', Number(productId));
      if (options.nullInventory) Reflect.set(value.product_info.trade_info, 'inventory', null);
      if (options.missingCategory) Reflect.deleteProperty(value.product_info, 'category_info');
      data = value;
    } else if (url.pathname === '/rest' + INVENTORY_DIAGNOSTIC_PATHS.inventory) data = fixture.inventory;
    else if (url.pathname === '/rest' + INVENTORY_DIAGNOSTIC_PATHS.schema)
      data = {
        ...fixture.schemaResponse,
        result: { ...fixture.schemaResponse.result, data: fixture.schema }
      };
    else throw new Error('Unexpected path');
    if (options.changeAfterRead) changed = true;
    return Promise.resolve(
      new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } })
    );
  });
  const reader = await createInventoryDiagnosticReader({
    credentials,
    productIds: options.productIds ?? productIds,
    transport: { send },
    assertContext: check
  });
  const saved: InventoryDiagnosticReport[] = [];
  const io = {
    ...reader,
    now: () => 0,
    persist: vi.fn((report: InventoryDiagnosticReport) => {
      saved.push(structuredClone(report));
      return Promise.resolve();
    })
  };
  return { send, check, io, saved };
}
describe('fixed-product inventory diagnostic, offline only', () => {
  it.each(fixture.invalidProductIds)('rejects $name target input before any request', ({ ids }) => {
    expect(() => freezeInventoryProductIds(ids)).toThrow('PRODUCT_IDS_INVALID');
  });
  it('requires canonical decimal string IDs, preserves the exact boundary and rejects sparse arrays', () => {
    expect(freezeInventoryProductIds([fixture.maximumExactId])).toEqual([fixture.maximumExactId]);
    expect(() => freezeInventoryProductIds(new Array(1))).toThrow('PRODUCT_IDS_INVALID');
  });
  it('freezes a copy of the explicit input list before an async reader can dispatch', async () => {
    const input = [...productIds];
    const { io, send } = await harness({ productIds: input });
    input[0] = fixture.otherProductId;
    input.push(fixture.otherProductId);
    expect(Object.isFrozen(io.productIds)).toBe(true);
    expect(io.productIds).toEqual(productIds);
    await expect(io.read('product', fixture.otherProductId, randomUUID())).rejects.toThrow('TARGET_DENIED');
    expect(send).not.toHaveBeenCalled();
  });
  it('runs only the three reads for one explicitly supplied synthetic product', async () => {
    const { io, send } = await harness({ productIds: [productIds[0]] });
    const report = await runInventoryReadonlyDiagnostic(io);
    expect(report.productIds).toEqual([productIds[0]]);
    expect(report.rows).toHaveLength(3);
    expect(send).toHaveBeenCalledTimes(3);
    expect(Object.isFrozen(report.productIds)).toBe(true);
  });
  it('keeps the IO target snapshot when the caller replaces its list after the initial checkpoint', async () => {
    const { io, send, saved } = await harness();
    io.persist.mockImplementationOnce((report) => {
      Reflect.set(io, 'productIds', [fixture.otherProductId]);
      saved.push(structuredClone(report));
      return Promise.resolve();
    });
    const report = await runInventoryReadonlyDiagnostic(io);
    expect(report.productIds).toEqual(productIds);
    expect(report.rows.every((row) => productIds.some((id) => id === row.productId))).toBe(true);
    expect(send).toHaveBeenCalledTimes(6);
  });
  it.each(fixture.numericCases)('preserves field evidence for $name without inventing zero', (row) => {
    const owner =
      'missing' in row && row.missing ? {} : { inventory: 'value' in row ? row.value : undefined };
    const value = inventoryFieldEvidence(owner, 'inventory', true);
    expect(value).toEqual(row.expected);
  });
  it('preserves the observed negative SKU sentinel only as evidence, not a product SKU or quantity', () => {
    expect(inventoryFieldEvidence({ sku_id: -1 }, 'sku_id', true, true)).toMatchObject({
      integerString: '-1'
    });
    expect(inventoryFieldEvidence({ inventory: -1 }, 'inventory', true)).not.toHaveProperty('integerString');
  });
  it('keeps missing and empty SKU lists distinct and checks the exact response ID', () => {
    const data = product();
    Reflect.deleteProperty(data.product_info.trade_info, 'sku_info');
    expect(productInventoryEvidence(data, productIds[0]).evidence.skuInfo).toEqual({
      present: false,
      type: 'missing'
    });
    expect(productInventoryEvidence(product(), productIds[0]).evidence.skuInfo).toEqual({
      present: true,
      type: 'array',
      count: 0
    });
    expect(() => productInventoryEvidence(product(), productIds[1])).toThrow('RESPONSE_TARGET_MISMATCH');
  });
  it('does not aggregate warehouses or discard the literal zero in a returned inventory row', () => {
    expect(inventoryListEvidence(fixture.inventory)).toMatchObject({
      rows: [
        {
          skuId: { integerString: '-1' },
          warehouse: { code: 'SYNTHETIC_WAREHOUSE_NOT_REAL' },
          inventory: { integerString: '0' }
        }
      ]
    });
  });
  it('extracts inventory attributes from actual XML values without persisting templates or unrelated fields', () => {
    const encoded = JSON.stringify(inventorySchemaEvidence(fixture.schema));
    expect(encoded).toContain('SYNTHETIC_WAREHOUSE_NOT_REAL');
    expect(encoded).toContain('"integerString":"7"');
    expect(encoded).not.toContain('UNINSTANTIATED_MUST_NOT_BE_SAVED');
    expect(encoded).not.toContain(fixture.privateText);
    expect(encoded).not.toContain('<itemSchema>');
  });
  it.each(['<!DOCTYPE x><itemSchema/>', '<!ENTITY x "a"><itemSchema/>'])('refuses unsafe XML %s', (xml) => {
    expect(() => inventorySchemaEvidence(xml)).toThrow('SCHEMA_INVALID');
  });
  it('requires explicit IOP and read-only confirmation and cannot accept extra product IDs', () => {
    const args = [
      '--credential=fixture.json',
      '--output=report.json',
      '--protocol=iop',
      '--product-ids=' + productIds.join(','),
      '--confirm-readonly'
    ];
    const parsed = parseInventoryDiagnosticOptions(args);
    expect(parsed).toMatchObject({ protocol: 'iop', confirmReadonly: true, productIds });
    expect(Object.isFrozen(parsed.productIds)).toBe(true);
    for (const rejected of [
      args.filter((x) => x !== '--confirm-readonly'),
      args.filter((x) => !x.startsWith('--product-ids=')),
      args.map((x) => (x === '--protocol=iop' ? '--protocol=top' : x)),
      [...args, '--product-id=1'],
      [...args, '--confirm-readonly'],
      [...args, '--protocol=iop']
    ])
      expect(() => parseInventoryDiagnosticOptions(rejected)).toThrow('INVENTORY_DIAG_');
  });
  it('runs exactly six read attempts for the fixed pair through the real Gateway/NetworkManager with a fake transport', async () => {
    const { io, send, saved } = await harness();
    expect(send).not.toHaveBeenCalled();
    const report = await runInventoryReadonlyDiagnostic(io);
    expect(report.complete).toBe(true);
    expect(report.networkRequests).toBe(6);
    expect(report.rows).toHaveLength(6);
    expect(report.rows.every((row) => row.status === 'accepted' && row.networkAttempts === 1)).toBe(true);
    expect(report.productIds).toEqual(productIds);
    expect(send).toHaveBeenCalledTimes(6);
    expect(saved.at(-1)).toEqual(report);
    const encoded = JSON.stringify(report);
    for (const text of [
      fixture.privateText,
      fixture.credentials.appKey,
      fixture.credentials.appSecret,
      fixture.credentials.accessToken,
      '<itemSchema>',
      'UNINSTANTIATED_MUST_NOT_BE_SAVED'
    ])
      expect(encoded).not.toContain(text);
    expect(encoded).toContain('SYNTHETIC_WAREHOUSE_NOT_REAL');
    expect(report.mutationAttempted).toBe(false);
  });
  it('records explicit null as contract drift but can read Schema using the exact ID and independently valid category', async () => {
    const { io, send } = await harness({ nullInventory: true });
    const report = await runInventoryReadonlyDiagnostic(io);
    expect(send).toHaveBeenCalledTimes(6);
    for (const row of report.rows.filter((row) => row.route === 'product')) {
      expect(row.status).toBe('contract-drift');
      expect(row.evidence.inventory).toEqual({ present: true, type: 'null' });
    }
    expect(
      report.rows.filter((row) => row.route === 'schema').every((row) => row.status === 'accepted')
    ).toBe(true);
  });
  it('does not retry failed network reads or guess a category to render Schema', async () => {
    const { io, send } = await harness({ reject: true });
    const report = await runInventoryReadonlyDiagnostic(io);
    expect(send).toHaveBeenCalledTimes(4);
    expect(report.networkRequests).toBe(4);
    expect(report.rows.filter((row) => row.status === 'missing-prerequisite')).toHaveLength(2);
    expect(report.rows.every((row) => row.networkAttempts <= 1)).toBe(true);
    expect(JSON.stringify(report)).not.toContain(fixture.privateText);
  });
  it('does not infer a schema category from the source or the other product', async () => {
    const { io, send } = await harness({ missingCategory: true });
    const report = await runInventoryReadonlyDiagnostic(io);
    expect(send).toHaveBeenCalledTimes(4);
    expect(
      report.rows
        .filter((row) => row.route === 'schema')
        .every((row) => row.status === 'missing-prerequisite')
    ).toBe(true);
  });
  it('stops after an authorization-context change without reading another product or route', async () => {
    const { io, send, saved } = await harness({ changeAfterRead: true });
    await expect(runInventoryReadonlyDiagnostic(io)).rejects.toThrow('CONTEXT_CHANGED');
    expect(send).toHaveBeenCalledOnce();
    expect(saved.at(-1)).toMatchObject({
      complete: false,
      networkRequests: 1,
      stopCode: 'INVENTORY_DIAG_CONTEXT_CHANGED'
    });
  });
  it('records Pending as a skipped Schema read while keeping the two native inventory reads single-shot', async () => {
    const { io, send } = await harness({ pending: true });
    const report = await runInventoryReadonlyDiagnostic(io);
    expect(send).toHaveBeenCalledTimes(4);
    expect(report.networkRequests).toBe(4);
    for (const row of report.rows.filter((row) => row.route === 'schema')) {
      expect(row.status).toBe('missing-prerequisite');
      expect(row.networkAttempts).toBe(0);
      expect(row.evidence).toEqual({ reason: 'platform-review-pending' });
    }
    expect(report.complete).toBe(true);
  });
  it('also rejects direct Schema-reader calls for a Pending product without any network attempt', async () => {
    const { io, send } = await harness({ pending: true });
    await io.read('product', productIds[0], randomUUID());
    await expect(io.read('schema', productIds[0], randomUUID(), fixture.categoryId)).rejects.toThrow(
      'PLATFORM_REVIEW_PENDING'
    );
    expect(send).toHaveBeenCalledOnce();
  });
  it('refuses a TOP credential snapshot before networking', async () => {
    const send = vi.fn<NetworkTransport['send']>();
    await expect(
      createInventoryDiagnosticReader({
        credentials: { ...credentials, protocol: 'top' },
        productIds,
        transport: { send }
      })
    ).rejects.toThrow('IOP_CREDENTIAL_REQUIRED');
    expect(send).not.toHaveBeenCalled();
  });
  it('rejects redirects without following them', async () => {
    const { io, send } = await harness({ redirect: true });
    const report = await runInventoryReadonlyDiagnostic(io);
    expect(send).toHaveBeenCalledTimes(4);
    expect(
      report.rows.filter((row) => row.networkAttempts === 1).every((row) => row.status === 'failed')
    ).toBe(true);
  });
  it('cannot call a third product through the reader', async () => {
    const { io, send } = await harness();
    await expect(io.read('product', fixture.otherProductId, randomUUID())).rejects.toThrow('TARGET_DENIED');
    expect(send).not.toHaveBeenCalled();
  });
});
describe('inventory diagnostic transport and ignored-path boundary', () => {
  const form = () => new URLSearchParams({ product_id: productIds[0], language: 'en_US' });
  it.each([
    '/icbu/product/edit-inventory',
    '/icbu/product/edit-price',
    '/icbu/product/schema/add',
    '/alibaba/icbu/draft/delete',
    '/alibaba/icbu/product/search/v2'
  ])('never dispatches %s', async (path) => {
    const send = vi.fn<NetworkTransport['send']>();
    const guard = new InventoryReadonlyTransport({ send }, () => Promise.resolve(), productIds);
    await expect(
      guard.send(IOP_BUSINESS_ENDPOINT + path, { method: 'POST', redirect: 'manual', body: form() })
    ).rejects.toThrow('TRANSPORT_DENIED');
    expect(send).not.toHaveBeenCalled();
  });
  it('does not allow a second attempt of the same fixed read', async () => {
    const send = vi.fn<NetworkTransport['send']>(() => Promise.resolve(new Response('{}')));
    const guard = new InventoryReadonlyTransport({ send }, () => Promise.resolve(), productIds);
    const init: RequestInit = { method: 'POST', redirect: 'manual', body: form() };
    await guard.send(IOP_BUSINESS_ENDPOINT + INVENTORY_DIAGNOSTIC_PATHS.product, init);
    await expect(
      guard.send(IOP_BUSINESS_ENDPOINT + INVENTORY_DIAGNOSTIC_PATHS.product, init)
    ).rejects.toThrow('RETRY_DENIED');
    expect(send).toHaveBeenCalledOnce();
  });
  it('requires a product-confirmed category for Schema', async () => {
    const send = vi.fn<NetworkTransport['send']>();
    const guard = new InventoryReadonlyTransport({ send }, () => Promise.resolve(), productIds);
    const body = new URLSearchParams({
      render_request: JSON.stringify({
        product_id: productIds[0],
        language: 'en_US',
        cat_id: fixture.categoryId
      })
    });
    await expect(
      guard.send(IOP_BUSINESS_ENDPOINT + INVENTORY_DIAGNOSTIC_PATHS.schema, {
        method: 'POST',
        redirect: 'manual',
        body
      })
    ).rejects.toThrow('CATEGORY_UNCONFIRMED');
    expect(send).not.toHaveBeenCalled();
  });
  it('uses both allowed remote roots and checks every input/output through the existing guard', async () => {
    const root = resolve('fixture-workspace', 'oneVegetable-score-recovery'),
      primary = resolve(root, '..', 'oneVegetable');
    const guard = vi.fn(() => Promise.resolve());
    const options = {
      credential: join(primary, 'artifacts', 'synthetic.json'),
      output: join(root, 'artifacts', 'diagnostic.json')
    };
    expect(await assertInventoryDiagnosticPaths(options, root, guard)).toBe(root);
    expect(guard).toHaveBeenCalledWith(primary, options.credential);
    expect(guard).toHaveBeenCalledWith(root, options.output);
    await expect(
      assertInventoryDiagnosticPaths({ ...options, output: join(root, 'scripts', 'bad.json') }, root, guard)
    ).rejects.toThrow('IGNORED_OUTPUT_REQUIRED');
    await expect(
      assertInventoryDiagnosticPaths(
        { ...options, credential: resolve(root, '..', 'foreign', 'x.json') },
        root,
        guard
      )
    ).rejects.toThrow('IGNORED_PATHS_REQUIRED');
  });
  it('rejects a tracked credential before reading its contents or creating any report', async () => {
    const root = resolve(import.meta.dirname, '..', '..');
    const output = join(root, 'artifacts', 'inventory-diagnostic-' + randomUUID() + '.json');
    await expect(
      runInventoryDiagnosticCli([
        '--credential=' + join(root, 'package.json'),
        '--output=' + output,
        '--protocol=iop',
        '--product-ids=' + productIds.join(','),
        '--confirm-readonly'
      ])
    ).rejects.toThrow('IGNORED_PATHS_REQUIRED');
    expect(existsSync(output)).toBe(false);
  });
});
