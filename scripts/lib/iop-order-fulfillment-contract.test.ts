import assert from 'node:assert/strict';
import Ajv from 'ajv';
import { describe, expect, it } from 'vitest';
import snapshot from '../../docs/alibaba-order-fulfillment-docs.json';
import fixtures from '../../mock/data/order-fulfillment/examples.json';
import {
  FULFILLMENT_READ_METHODS as methods,
  ORDER_ATTACHMENT_METHOD
} from '../../packages/core/src/order-fulfillment-methods';
import { buildIopOrderFulfillmentContracts, fulfillmentPaths } from './iop-order-fulfillment-contract';

const contracts = buildIopOrderFulfillmentContracts(snapshot, fixtures.methods);
const ajv = new Ajv({ allErrors: true, strict: true });
function validator(method: string, direction: 'request' | 'response') {
  const definition = contracts.definitions[method] as Record<string, string>;
  const name = definition[direction + 'Schema'];
  assert(name);
  const schema = contracts.schemas[name];
  assert(schema);
  return ajv.compile(schema);
}
describe('offline native IOP fulfillment contracts', () => {
  it('uses six anonymously retrieved free documents and never upgrades account evidence', () => {
    expect(snapshot.source).toBe('anonymous-public-documentation');
    expect(snapshot.catalog).toHaveLength(6);
    expect(Object.keys(contracts)).toEqual(['schemas', 'definitions']);
    expect(Object.keys(contracts.schemas)).toHaveLength(12);
    expect(Object.keys(contracts.definitions)).toEqual(fulfillmentPaths);
    for (const path of fulfillmentPaths) {
      expect(contracts.definitions[path]).toMatchObject({
        source: 'catalog',
        verification: 'documented',
        risk: path === ORDER_ATTACHMENT_METHOD ? 'mutation' : 'read',
        realCallEnabled: path !== ORDER_ATTACHMENT_METHOD
      });
      expect(snapshot.coverage.find((item) => item.iop === path)).toMatchObject({
        accountPermission: 'unknown',
        accepted: false,
        readbackVerified: false
      });
    }
  });
  it.each(fulfillmentPaths)('validates explicitly synthetic offline examples for %s', (method) => {
    const example = fixtures.methods[method as keyof typeof fixtures.methods];
    for (const direction of ['request', 'response'] as const) {
      const validate = validator(method, direction);
      expect(validate(example[direction]), JSON.stringify(validate.errors)).toBe(true);
    }
  });
  it('preserves all documented attachment output fields and never enables generic mutation', () => {
    const doc = snapshot.documents.find((item) => item.path === ORDER_ATTACHMENT_METHOD);
    assert(doc);
    expect(doc.response).toEqual([
      {
        name: 'value',
        type: 'String',
        required: true,
        description: '\u751f\u6210\u7684\u9644\u4ef6\u7684filepath\u503c'
      }
    ]);
    const validate = validator(ORDER_ATTACHMENT_METHOD, 'response');
    expect(validate({ code: '0', value: 'filepath', request_id: 'trace' })).toBe(true);
    for (const value of [
      { code: '0' },
      { code: '0', value: '' },
      { code: '0', value: ' ' },
      { code: '0', result: { value: 'wrong-tree' } }
    ])
      expect(validate(value)).toBe(false);
    expect(contracts.definitions[ORDER_ATTACHMENT_METHOD]).toMatchObject({
      risk: 'mutation',
      realCallEnabled: false,
      verification: 'documented'
    });
  });
  it('keeps Number/String IDs without accepting already-rounded JavaScript numbers', () => {
    const request = validator(methods.warehouses, 'request');
    expect(request({ product_id: '9007199254740993123' })).toBe(true);
    expect(request({ product_id: 9007199254740992 })).toBe(false);
    expect(request({ product_id: '-1' })).toBe(false);
    expect(request({ product_id: '1', access_token: 'forbidden' })).toBe(false);
    expect(request({ product_id: '1', page_size: 10 })).toBe(false);
    const response = validator(methods.warehouses, 'response');
    const data = structuredClone(fixtures.methods[methods.warehouses].response);
    (data.response.records[0] as Record<string, unknown>).warehouse_id = 9007199254740992;
    expect(response(data)).toBe(false);
  });
  it('retains GGS public-example contradiction instead of silently accepting a truthy string', () => {
    const doc = snapshot.documents.find((item) => item.path === methods.ggsWarehouses);
    assert(doc);
    const example = doc.publicExamples[0];
    assert(example);
    expect((example.response as { result: { success: unknown } }).result.success).toBe('success');
    const validate = validator(methods.ggsWarehouses, 'response');
    expect(validate(example.response)).toBe(false);
    expect(validate(fixtures.methods[methods.ggsWarehouses].response)).toBe(true);
  });
  it('requires native advanced freight dependencies and rejects extra nested request keys', () => {
    const validate = validator(methods.advancedFreight, 'request');
    expect(validate({ destination_country: 'US', logistics_product_list: [] })).toBe(false);
    expect(
      validate({
        e_company_id: 'real-company-id-required',
        destination_country: 'US',
        logistics_product_list: [{ product_id: '1', quantity: 1, ignored: 'not documented' }]
      })
    ).toBe(false);
  });
  it('does not invent nested money units and keeps mandatory response fields', () => {
    const validate = validator(methods.advancedFreight, 'response');
    const data = structuredClone(fixtures.methods[methods.advancedFreight].response);
    const first = data.value[0];
    assert(first);
    expect(first.fee.amount).toBe('3.0');
    (first.fee as Record<string, unknown>).amount = 3;
    expect(validate(data)).toBe(false);
    expect(validate({ code: '0' })).toBe(false);
  });
  it('fails closed on missing/chargeable documents and attachment tree drift', () => {
    expect(() =>
      buildIopOrderFulfillmentContracts({ ...snapshot, documents: [] }, fixtures.methods)
    ).toThrow();
    const changed = structuredClone(snapshot);
    const first = changed.documents[0];
    assert(first);
    first.chargeable = true;
    expect(() => buildIopOrderFulfillmentContracts(changed, fixtures.methods)).toThrow();
    const drift = structuredClone(snapshot);
    const doc = drift.documents.find((item) => item.path === ORDER_ATTACHMENT_METHOD);
    assert(doc);
    const output = doc.response[0];
    assert(output);
    output.name = 'attachment_id';
    expect(() => buildIopOrderFulfillmentContracts(drift, fixtures.methods)).toThrow();
  });
});
