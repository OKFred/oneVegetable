import { describe, expect, it, vi } from 'vitest';
import type { GatewayClient } from '../src/types';
import {
  ProductLookupClient,
  IOP_PRODUCT_LOOKUP_METHOD,
  type ProductLookupQuery
} from '../src/product-lookup';
import fixture from '../../../mock/data/product-lookup.json';

function setup(data: unknown = fixture.response) {
  const request = vi.fn(() =>
    Promise.resolve({
      method: IOP_PRODUCT_LOOKUP_METHOD,
      traceId: 'lookup-fixture',
      contractValid: true,
      contractIssues: [],
      data
    })
  );
  return {
    request,
    client: new ProductLookupClient({ request } as Pick<GatewayClient, 'request'>)
  };
}
function productResponse() {
  return structuredClone(fixture.response);
}

describe('read-only product lookup facade', () => {
  it('uses only the native IOP method and trimmed model number with bounded defaults', async () => {
    const { client, request } = setup();
    await client.search({ modelNumber: '  ' + fixture.queries.modelNumber + '  ' });
    expect(request).toHaveBeenCalledExactlyOnceWith('callCapability', {
      method: fixture.method,
      parameters: { model_number: fixture.queries.modelNumber, page_index: 1, page_size: 20 }
    });
  });
  it('sends seller SKU code, never numeric SKU ID or interface language', async () => {
    const { client, request } = setup();
    await client.search({ skuCode: ' ' + fixture.queries.skuCode + ' ' });
    expect(request.mock.calls[0]).toEqual([
      'callCapability',
      {
        method: fixture.method,
        parameters: { sku_code: fixture.queries.skuCode, page_index: 1, page_size: 20 }
      }
    ]);
  });
  it('ignores a blank unused alternative but requires one meaningful value', async () => {
    const { client, request } = setup();
    await client.search({ modelNumber: fixture.queries.modelNumber, skuCode: '  ' });
    expect(request).toHaveBeenCalledTimes(1);
  });
  it.each([
    {},
    { modelNumber: '' },
    { modelNumber: '  ', skuCode: '\n\t' },
    { modelNumber: fixture.queries.modelNumber, skuCode: fixture.queries.skuCode }
  ])('blocks blank scans and ambiguous input %# before dispatch', async (input) => {
    const { client, request } = setup();
    await expect(client.search(input)).rejects.toThrow('REQUEST_CONTRACT_INVALID');
    expect(request).not.toHaveBeenCalled();
  });
  it.each([null, [], undefined, { modelNumber: 1 }, { skuCode: false }, { modelNumber: null }])(
    'rejects malformed runtime query %# before dispatch',
    async (input) => {
      const { client, request } = setup();
      await expect(client.search(input as unknown as ProductLookupQuery)).rejects.toThrow(
        'REQUEST_CONTRACT_INVALID'
      );
      expect(request).not.toHaveBeenCalled();
    }
  );
  it.each([
    ['pageIndex', 0],
    ['pageIndex', -1],
    ['pageIndex', 1.5],
    ['pageIndex', '1'],
    ['pageIndex', Number.MAX_SAFE_INTEGER + 1],
    ['pageIndex', null],
    ['pageSize', 0],
    ['pageSize', 21],
    ['pageSize', 2.5],
    ['pageSize', '20'],
    ['pageSize', Infinity],
    ['pageSize', null]
  ])('rejects invalid %s=%s before dispatch', async (key, value) => {
    const { client, request } = setup();
    await expect(client.search({ modelNumber: fixture.queries.modelNumber, [key]: value })).rejects.toThrow(
      'REQUEST_CONTRACT_INVALID'
    );
    expect(request).not.toHaveBeenCalled();
  });
  it('maps exact product_info/basic_info, top-level sku_info and page fields', async () => {
    const { client } = setup();
    const page = await client.search({ modelNumber: fixture.queries.modelNumber });
    expect(page).toMatchObject({
      pageIndex: 1,
      pageSize: 20,
      totalItems: 21,
      totalPages: 2,
      hasNextPage: true
    });
    expect(page.items[0]).toEqual({
      productId: '880101',
      title: 'Unbranded lookup glass cup',
      modelNumber: fixture.queries.modelNumber,
      status: 'online',
      skus: [
        { id: '990101', code: fixture.queries.skuCode },
        { id: '9007199254740993', code: null }
      ]
    });
    expect(page.items[1]).toEqual({
      productId: '9007199254740993',
      title: 'Second lookup product',
      modelNumber: null,
      status: 'FUTURE_NATIVE_STATE',
      skus: null
    });
    expect(JSON.stringify(page)).not.toContain(fixture.privateMarker);
  });
  it('keeps unknown fields null without echoing the query into results', async () => {
    const { client } = setup(fixture.minimalResponse);
    const page = await client.search({ skuCode: fixture.queries.skuCode });
    expect(page.items).toEqual([
      { productId: null, title: null, modelNumber: null, status: null, skus: null }
    ]);
    expect(page.totalItems).toBeNull();
    expect(page.totalPages).toBeNull();
    expect(page.hasNextPage).toBe(false);
  });
  it('does not read SKU values from undocumented trade_info nesting', async () => {
    const data = productResponse();
    const first = data.product_info[0];
    if (!first) throw new Error('Missing fixture row');
    Reflect.set(first, 'trade_info', { sku_info: first.sku_info });
    Reflect.deleteProperty(first, 'sku_info');
    const { client } = setup(data);
    expect((await client.search({ modelNumber: fixture.queries.modelNumber })).items[0]?.skus).toBeNull();
  });
  it.each([Number.MAX_SAFE_INTEGER + 1, 0, -1, '1e3', '001'])(
    'rejects unsafe or malformed nonempty product/SKU IDs: %s',
    async (badId) => {
      for (const target of ['product', 'sku']) {
        const data = productResponse();
        const first = data.product_info[0];
        if (!first?.basic_info || !first.sku_info?.[0]) throw new Error('Missing fixture row');
        if (target === 'product') Reflect.set(first.basic_info, 'product_id', badId);
        else Reflect.set(first.sku_info[0], 'sku_id', badId);
        await expect(setup(data).client.search({ modelNumber: fixture.queries.modelNumber })).rejects.toThrow(
          'ALIBABA_IOP_RESPONSE_INVALID'
        );
      }
    }
  );
  it('treats absent/empty optional identifiers as unknown', async () => {
    const data = productResponse();
    const first = data.product_info[0];
    if (!first?.basic_info || !first.sku_info?.[0]) throw new Error('Missing fixture row');
    Reflect.set(first.basic_info, 'product_id', '');
    Reflect.set(first.sku_info[0], 'sku_id', null);
    const page = await setup(data).client.search({ modelNumber: fixture.queries.modelNumber });
    expect(page.items[0]?.productId).toBeNull();
    expect(page.items[0]?.skus?.[0]?.id).toBeNull();
  });
  it.each([undefined, 'true', 1])('never infers success from code alone: %s', async (success) => {
    const data = productResponse();
    Reflect.set(data, 'success', success);
    Reflect.set(data, 'code', '0');
    await expect(setup(data).client.search({ modelNumber: fixture.queries.modelNumber })).rejects.toThrow(
      'ALIBABA_IOP_RESPONSE_INVALID'
    );
  });
  it('honors business rejection and never retries/falls back', async () => {
    const { client, request } = setup(fixture.businessRejectedResponse);
    await expect(client.search({ modelNumber: fixture.queries.modelNumber })).rejects.toThrow(
      'ALIBABA_IOP_BUSINESS_REJECTED'
    );
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('rejects invalid gateway envelopes', async () => {
    const { client, request } = setup();
    request.mockResolvedValueOnce({
      method: fixture.method,
      traceId: '',
      contractValid: false,
      contractIssues: [],
      data: fixture.response
    });
    await expect(client.search({ modelNumber: fixture.queries.modelNumber })).rejects.toThrow(
      'ALIBABA_IOP_RESPONSE_INVALID'
    );
    request.mockResolvedValueOnce({
      method: '',
      traceId: '',
      contractValid: true,
      contractIssues: [],
      data: fixture.response
    });
    await expect(client.search({ modelNumber: fixture.queries.modelNumber })).rejects.toThrow(
      'ALIBABA_IOP_RESPONSE_INVALID'
    );
  });
  it('propagates transport failures without a retry or mutation', async () => {
    const { client, request } = setup();
    request.mockRejectedValueOnce(new Error('synthetic transport failure'));
    await expect(client.search({ skuCode: fixture.queries.skuCode })).rejects.toThrow(
      'synthetic transport failure'
    );
    expect(request).toHaveBeenCalledTimes(1);
  });
  it.each([null, {}, { success: true }, { success: true, product_info: {} }])(
    'rejects incomplete or malformed response %#',
    async (data) => {
      await expect(setup(data).client.search({ modelNumber: fixture.queries.modelNumber })).rejects.toThrow(
        'ALIBABA_IOP_RESPONSE_INVALID'
      );
    }
  );
  it('supports zero results and explicit second-page requests', async () => {
    const empty = await setup(fixture.emptyResponse).client.search({
      modelNumber: fixture.queries.modelNumber
    });
    expect(empty).toMatchObject({ items: [], totalItems: 0, totalPages: 0, hasNextPage: false });
    const { client, request } = setup(fixture.secondPageResponse);
    const next = await client.search({ skuCode: fixture.queries.skuCode, pageIndex: 2 });
    expect(next.pageIndex).toBe(2);
    expect(next.hasNextPage).toBe(false);
    expect(request.mock.calls[0]).toEqual([
      'callCapability',
      {
        method: fixture.method,
        parameters: { sku_code: fixture.queries.skuCode, page_index: 2, page_size: 20 }
      }
    ]);
  });
  it('allows unknown totals and conservatively enables next only on a full page', async () => {
    const data = structuredClone(fixture.unknownTotalsResponse);
    const full = await setup(data).client.search({ modelNumber: fixture.queries.modelNumber, pageSize: 2 });
    expect(full).toMatchObject({ totalItems: null, totalPages: null, hasNextPage: true });
    data.product_info.pop();
    expect(
      (await setup(data).client.search({ modelNumber: fixture.queries.modelNumber, pageSize: 2 })).hasNextPage
    ).toBe(false);
  });
  it('uses only total_item when total_page is absent', async () => {
    const data = productResponse();
    Reflect.deleteProperty(data.page, 'total_page');
    const page = await setup(data).client.search({ modelNumber: fixture.queries.modelNumber });
    expect(page.totalItems).toBe(21);
    expect(page.totalPages).toBeNull();
    expect(page.hasNextPage).toBe(true);
  });
  it.each([
    ['page_index', 0],
    ['page_index', 2],
    ['page_size', 21],
    ['page_size', 1],
    ['total_item', -1],
    ['total_item', Number.MAX_SAFE_INTEGER + 1],
    ['total_page', '1e3'],
    ['total_page', false]
  ])('rejects malformed or mismatched native page field %s=%s', async (key, value) => {
    const data = productResponse();
    Reflect.set(data.page, key, value);
    await expect(setup(data).client.search({ modelNumber: fixture.queries.modelNumber })).rejects.toThrow(
      'ALIBABA_IOP_RESPONSE_INVALID'
    );
  });
  it('accepts exact decimal-string counts without inventing missing totals', async () => {
    const data = productResponse();
    for (const key of Object.keys(data.page))
      Reflect.set(data.page, key, String(Reflect.get(data.page, key)));
    expect((await setup(data).client.search({ modelNumber: fixture.queries.modelNumber })).totalItems).toBe(
      21
    );
  });
  it('rejects a provider page exceeding the requested size', async () => {
    const data = structuredClone(fixture.unknownTotalsResponse);
    data.product_info.push(...structuredClone(data.product_info));
    await expect(
      setup(data).client.search({ modelNumber: fixture.queries.modelNumber, pageSize: 2 })
    ).rejects.toThrow('ALIBABA_IOP_RESPONSE_INVALID');
  });
});
