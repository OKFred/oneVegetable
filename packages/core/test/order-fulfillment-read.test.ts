import assert from 'node:assert/strict';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import fixtures from '../../../mock/data/order-fulfillment/examples.json';
import failures from '../../../mock/data/order-fulfillment/failures.json';
import {
  FULFILLMENT_READ_METHODS as methods,
  ORDER_ATTACHMENT_METHOD,
  isFulfillmentMethod,
  isFulfillmentReadMethod,
  type FulfillmentReadMethod
} from '../src/order-fulfillment-methods';
import {
  OrderFulfillmentReadClient,
  validateFulfillmentReadParameters,
  parseFulfillmentReadResponse
} from '../src/order-fulfillment-read';
import type { GatewayClient } from '../src/types';

// Isolate the pending main-generator integration; this suite does not grant account permissions.
const policy = vi.hoisted(() => vi.fn(() => ({ allowed: true, reasonCode: 'CAPABILITY_ALLOWED' })));
vi.mock('../src/capability-policy', () => ({ authorizeCapabilityCall: policy }));
const examples = fixtures.methods;
const all = Object.values(methods);
const error = (code: string) => ({ gatewayError: expect.objectContaining({ code }) as unknown });
function setup(method: FulfillmentReadMethod = methods.warehouses) {
  const context = vi.fn(() => Promise.resolve({ identity: 'account-1', gateway: 'iop-1' }));
  const request = vi.fn((_operation: string, _payload: Record<string, unknown>, _options?: unknown) =>
    Promise.resolve({
      method,
      traceId: 'envelope-trace',
      contractValid: true,
      data: structuredClone(examples[method].response),
      contractIssues: []
    })
  );
  let identity = 'scope-1';
  const gateway = { request, galleryTransferContext: context } as unknown as GatewayClient;
  return {
    client: new OrderFulfillmentReadClient(gateway, () => identity),
    request,
    context,
    gateway,
    changeIdentity: () => {
      identity = 'scope-2';
    }
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
beforeEach(() => policy.mockReset().mockReturnValue({ allowed: true, reasonCode: 'CAPABILITY_ALLOWED' }));
describe('native order fulfillment requests and responses', () => {
  it('only admits the exact five reads and separately identifies the attachment mutation', () => {
    expect(all).toHaveLength(5);
    for (const method of all) expect(isFulfillmentReadMethod(method)).toBe(true);
    expect(isFulfillmentReadMethod(ORDER_ATTACHMENT_METHOD)).toBe(false);
    expect(isFulfillmentMethod(ORDER_ATTACHMENT_METHOD)).toBe(true);
    for (const method of [null, 'warehouses', 'alibaba.seller.order.fund.get', '/warehouse/list/'])
      expect(isFulfillmentMethod(method)).toBe(false);
  });
  it.each(all)('keeps exact parameters and native response data for %s', (method) => {
    const request = validateFulfillmentReadParameters(method, examples[method].request);
    expect(request).toEqual(examples[method].request);
    expect(request).not.toBe(examples[method].request);
    const data = structuredClone(examples[method].response);
    expect(parseFulfillmentReadResponse(method, data, 'fallback')).toEqual({
      method,
      traceId: data.request_id,
      data
    });
  });
  it('preserves decimal IDs above MAX_SAFE_INTEGER, while rejecting unsafe Number values', () => {
    for (const method of [methods.warehouses, methods.tracking]) {
      const key = method === methods.tracking ? 'trade_id' : 'product_id';
      expect(validateFulfillmentReadParameters(method, { [key]: '9007199254740993123' })).toEqual({
        [key]: '9007199254740993123'
      });
      expect(() => validateFulfillmentReadParameters(method, { [key]: 9007199254740992 })).toThrow();
      expect(() => validateFulfillmentReadParameters(method, { [key]: 'encrypted-order-id' })).toThrow();
    }
    const data = structuredClone(examples[methods.warehouses].response);
    const first = data.response.records[0];
    assert(first);
    first.warehouse_id = '9007199254740993123';
    expect(parseFulfillmentReadResponse(methods.warehouses, data).data).toEqual(data);
  });
  it.each([
    [methods.warehouses, { product_id: '1', page_size: 20 }],
    [methods.warehouses, { product_id: '1', current_page: 0 }],
    [methods.warehouses, { product_id: '01' }],
    [methods.warehouses, { product_id: '1', country_code: undefined }],
    [methods.ggsWarehouses, { product_id: '1', page_size: 10 }],
    [methods.basicFreight, { product_id: '1', destination_country: 'US', quantity: 1.5 }],
    [
      methods.basicFreight,
      { product_id: '1', destination_country: 'US', quantity: 1, enable_distribution_waybill: 'false' }
    ],
    [methods.basicFreight, { product_id: '1', destination_country: ' ', quantity: 1 }],
    [
      methods.advancedFreight,
      { e_company_id: 'company', destination_country: 'US', logistics_product_list: [] }
    ],
    [
      methods.advancedFreight,
      {
        e_company_id: 'company',
        destination_country: 'US',
        logistics_product_list: [{ product_id: '1', quantity: 2, sku_id: 9007199254740992 }]
      }
    ],
    [
      methods.advancedFreight,
      {
        e_company_id: 'company',
        destination_country: 'US',
        logistics_product_list: [{ product_id: '1', quantity: 2 }],
        address: { country: { code: 'US', ignored: 'no' } }
      }
    ],
    [methods.tracking, { trade_id: '1', access_token: 'forbidden' }]
  ] as const)('rejects malformed/unsupported native input: %s %j', (method, input) => {
    expect(() => validateFulfillmentReadParameters(method, input)).toThrow();
  });
  it('keeps optional false flags, nested address and conditional SKU unchanged', () => {
    const input = {
      e_company_id: 'company',
      destination_country: 'US',
      enable_distribution_waybill: false,
      address: { address: 'Street 1', country: { code: 'US', name: 'United States' }, zip: '90001' },
      logistics_product_list: [{ product_id: '9007199254740993', quantity: 2, sku_id: '9007199254740995' }]
    };
    expect(validateFulfillmentReadParameters(methods.advancedFreight, input)).toEqual(input);
  });
  it.each(all)('allows a documented empty list, not missing/null payloads: %s', (method) => {
    const data: Record<string, unknown> = structuredClone(examples[method].response);
    if (method === methods.warehouses) (data.response as Record<string, unknown>).records = [];
    else if (method === methods.ggsWarehouses) (data.result as Record<string, unknown>).data = [];
    else data[method === methods.tracking ? 'tracking_list' : 'value'] = [];
    expect(parseFulfillmentReadResponse(method, data).data).toEqual(data);
    expect(() => parseFulfillmentReadResponse(method, { code: '0' })).toThrow();
  });
  it('never turns outer or nested business errors into empty lists', () => {
    expect(() => parseFulfillmentReadResponse(methods.tracking, { code: 403 }, 'numeric-error')).toThrow(
      expect.objectContaining(error('403'))
    );
    expect(() => parseFulfillmentReadResponse(methods.tracking, failures.outer)).toThrow(
      expect.objectContaining(error('isv.permission-api-package-limit'))
    );
    expect(() => parseFulfillmentReadResponse(methods.ggsWarehouses, failures.ggs)).toThrow(
      expect.objectContaining({
        gatewayError: { code: '403', message: '403', retryable: false, traceId: 'ggs-denied' }
      })
    );
    expect(() =>
      parseFulfillmentReadResponse(methods.ggsWarehouses, failures.malformedGgsPublicExample)
    ).toThrow(expect.objectContaining(error('FULFILLMENT_READ_RESPONSE_INVALID')));
  });
  it('strictly checks required response leaves and keeps provider trace on invalid data', () => {
    const warehouse = structuredClone(examples[methods.warehouses].response) as Record<string, unknown>;
    const warehouseRow = (
      (warehouse.response as Record<string, unknown>).records as Record<string, unknown>[]
    )[0];
    assert(warehouseRow);
    warehouseRow.warehouse_id = 9007199254740992;
    expect(() => parseFulfillmentReadResponse(methods.warehouses, warehouse)).toThrow();
    const freight = structuredClone(examples[methods.advancedFreight].response);
    const freightRow = freight.value[0];
    assert(freightRow);
    (freightRow.fee as Record<string, unknown>).amount = 1.25;
    expect(() => parseFulfillmentReadResponse(methods.advancedFreight, freight)).toThrow(
      expect.objectContaining({
        gatewayError: {
          code: 'FULFILLMENT_READ_RESPONSE_INVALID',
          message: 'FULFILLMENT_READ_RESPONSE_INVALID',
          retryable: false,
          traceId: freight.request_id
        }
      })
    );
    const tracking = structuredClone(examples[methods.tracking].response) as Record<string, unknown>;
    const trackingRow = (tracking.tracking_list as Record<string, unknown>[])[0];
    assert(trackingRow);
    trackingRow.event_list = [{}];
    expect(() => parseFulfillmentReadResponse(methods.tracking, tracking)).toThrow();
    expect(() => parseFulfillmentReadResponse(methods.basicFreight, { code: '0', value: null })).toThrow();
    expect(() => parseFulfillmentReadResponse(methods.basicFreight, { value: [] })).toThrow();
  });
});
describe('fulfillment read lifetime and actual gateway context', () => {
  it.each(all)(
    'does not auto-read and dispatches exactly once using actual %s parameters',
    async (method) => {
      const { client, request, context } = setup(method);
      expect(request).not.toHaveBeenCalled();
      expect(context).not.toHaveBeenCalled();
      const parameters = examples[method].request;
      const payload = { method, parameters };
      await client.query(method, parameters);
      expect(context).toHaveBeenNthCalledWith(1, 'callCapability', payload);
      expect(context).toHaveBeenNthCalledWith(2, 'callCapability', payload);
      expect(request).toHaveBeenCalledExactlyOnceWith('callCapability', payload, {
        galleryContext: { identity: 'account-1', gateway: 'iop-1' }
      });
    }
  );
  it('blocks malformed input, unknown/mutation methods and denied policies before network', async () => {
    const { client, request, context } = setup();
    await expect(client.query(methods.warehouses, {})).rejects.toMatchObject(
      error('REQUEST_CONTRACT_INVALID')
    );
    await expect(
      client.query(ORDER_ATTACHMENT_METHOD as FulfillmentReadMethod, { data: [1], file_name: 'x.jpg' })
    ).rejects.toMatchObject(error('ALIBABA_IOP_METHOD_UNSUPPORTED'));
    policy.mockReturnValueOnce({ allowed: false, reasonCode: 'CAPABILITY_NOT_ACTIVE' });
    await expect(client.query(methods.warehouses, { product_id: '1' })).rejects.toMatchObject(
      error('CAPABILITY_NOT_ACTIVE')
    );
    expect(request).not.toHaveBeenCalled();
    expect(context).not.toHaveBeenCalled();
  });
  it('never retries a failed request using TOP, mock or another context', async () => {
    const { client, request, context } = setup();
    request.mockRejectedValueOnce(new Error('network failed'));
    await expect(client.query(methods.warehouses, { product_id: '1' })).rejects.toThrow('network failed');
    expect(request).toHaveBeenCalledTimes(1);
    expect(context).toHaveBeenCalledTimes(1);
  });
  it.each(['identity', 'gateway'] as const)('rejects changed %s after dispatch', async (field) => {
    const { client, context } = setup();
    context
      .mockResolvedValueOnce({ identity: 'account-1', gateway: 'iop-1' })
      .mockResolvedValueOnce({ identity: 'account-1', gateway: 'iop-1', [field]: 'changed' });
    await expect(client.query(methods.warehouses, { product_id: '1' })).rejects.toMatchObject(
      error('FULFILLMENT_CONTEXT_CHANGED')
    );
  });
  it.each(['invalidate', 'dispose', 'boundary'] as const)(
    'discards a late response on %s',
    async (action) => {
      const { client, request, context, changeIdentity } = setup();
      const late = deferred<Awaited<ReturnType<typeof request>>>();
      request.mockReturnValueOnce(late.promise);
      const pending = client.query(methods.warehouses, { product_id: '1' });
      const assertion = expect(pending).rejects.toMatchObject(error('FULFILLMENT_CONTEXT_CHANGED'));
      await vi.waitFor(() => {
        expect(request).toHaveBeenCalledTimes(1);
      });
      if (action === 'boundary') changeIdentity();
      else client[action]();
      late.resolve({
        method: methods.warehouses,
        traceId: 'late',
        contractValid: true,
        data: examples[methods.warehouses].response,
        contractIssues: []
      });
      await assertion;
      expect(context).toHaveBeenCalledTimes(1);
    }
  );
  it('stops before dispatch when invalidated during context lookup', async () => {
    const { client, request, context } = setup();
    const late = deferred<Awaited<ReturnType<typeof context>>>();
    context.mockReturnValueOnce(late.promise);
    const pending = client.query(methods.warehouses, { product_id: '1' });
    const assertion = expect(pending).rejects.toMatchObject(error('FULFILLMENT_CONTEXT_CHANGED'));
    client.invalidate();
    late.resolve({ identity: 'account-1', gateway: 'iop-1' });
    await assertion;
    expect(request).not.toHaveBeenCalled();
  });
  it('permanently stops disposed clients without network work', async () => {
    const { client, request, context } = setup();
    client.dispose();
    await expect(client.query(methods.warehouses, { product_id: '1' })).rejects.toMatchObject(
      error('FULFILLMENT_CONTEXT_CHANGED')
    );
    expect(request).not.toHaveBeenCalled();
    expect(context).not.toHaveBeenCalled();
  });
  it('discards a result invalidated during the final identity check', async () => {
    const { client, context } = setup();
    const late = deferred<Awaited<ReturnType<typeof context>>>();
    context
      .mockResolvedValueOnce({ identity: 'account-1', gateway: 'iop-1' })
      .mockReturnValueOnce(late.promise);
    const pending = client.query(methods.warehouses, { product_id: '1' });
    const assertion = expect(pending).rejects.toMatchObject(error('FULFILLMENT_CONTEXT_CHANGED'));
    await vi.waitFor(() => {
      expect(context).toHaveBeenCalledTimes(2);
    });
    client.invalidate();
    late.resolve({ identity: 'account-1', gateway: 'iop-1' });
    await assertion;
  });
  it('does not let a shared mutable context conceal an identity change', async () => {
    const { client, context, request } = setup();
    const shared = { identity: 'account-1', gateway: 'iop-1' };
    context.mockResolvedValue(shared);
    const response = {
      method: methods.warehouses,
      traceId: 'trace',
      contractValid: true,
      contractIssues: [],
      data: structuredClone(examples[methods.warehouses].response)
    };
    request.mockImplementationOnce(() => {
      shared.identity = 'account-2';
      return Promise.resolve(response);
    });
    await expect(client.query(methods.warehouses, { product_id: '1' })).rejects.toMatchObject(
      error('FULFILLMENT_CONTEXT_CHANGED')
    );
  });
  it('requires the actual-context API instead of falling back to a protocol', async () => {
    const request = vi.fn();
    const client = new OrderFulfillmentReadClient({ request });
    await expect(client.query(methods.warehouses, { product_id: '1' })).rejects.toMatchObject(
      error('ALIBABA_IOP_AUTHORIZATION_REQUIRED')
    );
    expect(request).not.toHaveBeenCalled();
  });
  it('preserves the envelope trace even when the native payload is not an object', () => {
    expect(() => parseFulfillmentReadResponse(methods.tracking, null, 'envelope-only')).toThrow(
      expect.objectContaining({
        gatewayError: {
          code: 'FULFILLMENT_READ_RESPONSE_INVALID',
          message: 'FULFILLMENT_READ_RESPONSE_INVALID',
          retryable: false,
          traceId: 'envelope-only'
        }
      })
    );
  });
  it('rejects malformed envelopes even if upstream reports contractValid', async () => {
    const { client, request } = setup();
    request.mockResolvedValueOnce({
      method: methods.tracking,
      data: examples[methods.warehouses].response,
      contractValid: true,
      traceId: 'mismatch',
      contractIssues: []
    });
    await expect(client.query(methods.warehouses, { product_id: '1' })).rejects.toMatchObject(
      error('FULFILLMENT_READ_RESPONSE_INVALID')
    );
  });
  it('snapshots caller parameters before awaiting the context', async () => {
    const { client, request } = setup();
    const parameters = { product_id: '1' };
    const pending = client.query(methods.warehouses, parameters);
    parameters.product_id = '2';
    await pending;
    expect(request.mock.calls[0]?.[1]).toEqual({
      method: methods.warehouses,
      parameters: { product_id: '1' }
    });
  });
});
