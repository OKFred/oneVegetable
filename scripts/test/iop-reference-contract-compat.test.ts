import Ajv from 'ajv/dist/2020';
import { describe, expect, it, vi } from 'vitest';
import iopDocs from '../../docs/alibaba-iop-api-docs.json';
import workbenchDocs from '../../docs/alibaba-product-workbench-docs.json';
import examples from '../../mock/data/product-reference/examples.json';
import workbenchExamples from '../../mock/data/product-workbench/examples.json';
import fixture from '../../mock/data/product-search-numeric-fields.json';
import { buildIopReferenceContracts } from '../lib/iop-reference-contract';
import { ProductLookupClient } from '../../packages/core/src/product-lookup';
import type { GatewayClient } from '../../packages/core/src/types';

// Compile fresh source schemas only; never run a generator or depend on stale generated validators.
const contracts = buildIopReferenceContracts(
  { ...iopDocs, documents: [...iopDocs.documents, ...workbenchDocs.documents] },
  { ...examples, ...workbenchExamples }
);
const ajv = new Ajv({ strict: false, allowUnionTypes: true, allErrors: true, coerceTypes: false });
const searchSchema = contracts.schemas.AlibabaProductIopReference5Response;
const getSchema = contracts.schemas.AlibabaProductIopReference3Response;
if (!searchSchema || !getSchema) throw new Error('MISSING_SOURCE_SCHEMA');
const search = ajv.compile(searchSchema);
const get = ajv.compile(getSchema);
function head<T>(values: readonly T[]): T {
  const value = values[0];
  if (value === undefined) throw new Error('MISSING_SYNTHETIC_ROW');
  return value;
}
function response() {
  return structuredClone(fixture.response);
}
function first(data: ReturnType<typeof response>) {
  const product = data.product_info[0];
  if (!product) throw new Error('MISSING_SYNTHETIC_PRODUCT');
  return product;
}
function observed(data: ReturnType<typeof response>, field: 'lead_time' | 'price', value: unknown) {
  const product = first(data);
  const tier =
    field === 'lead_time'
      ? product.logistics_info.tiered_lead_time[0]
      : product.trade_info.price.tiered_price[0];
  if (!tier) throw new Error('MISSING_SYNTHETIC_TIER');
  Reflect.set(tier, field, value);
}
describe('source IOP response compatibility: only observed search numeric scalars', () => {
  it.each([
    ['number', 'number'],
    ['number', 'string'],
    ['string', 'number'],
    ['string', 'string']
  ] as const)('accepts lead_time=%s / price=%s without coercing or rounding', (leadType, priceType) => {
    const data = response(),
      product = first(data);
    const lead = product.logistics_info.tiered_lead_time[0]?.lead_time;
    const price = product.trade_info.price.tiered_price[0]?.price;
    observed(data, 'lead_time', leadType === 'string' ? String(lead) : lead);
    observed(data, 'price', priceType === 'string' ? String(price) : price);
    const before = structuredClone(data);
    expect(search(data), JSON.stringify(search.errors)).toBe(true);
    expect(data).toEqual(before);
  });
  it.each(['lead_time', 'price'] as const)('still rejects null/boolean/object/array for %s', (field) => {
    for (const bad of [null, true, false, {}, []]) {
      const data = response();
      observed(data, field, bad);
      expect(search(data)).toBe(false);
      expect(
        search.errors?.some((error) => error.keyword === 'type' && error.instancePath.endsWith('/' + field))
      ).toBe(true);
    }
  });
  it.each([
    'weight',
    'length',
    'lead_quantity',
    'price_quantity',
    'currency',
    'sku_price',
    'title',
    'language',
    'page_index',
    'page_size',
    'success'
  ] as const)('does not widen unrelated field %s', (field) => {
    const data = response(),
      product = first(data);
    switch (field) {
      case 'weight':
        Reflect.set(product.logistics_info, 'weight', Number(product.logistics_info.weight));
        break;
      case 'length':
        Reflect.set(
          product.logistics_info.dimension,
          'length',
          Number(product.logistics_info.dimension.length)
        );
        break;
      case 'lead_quantity':
        Reflect.set(
          head(product.logistics_info.tiered_lead_time),
          'quantity',
          String(product.logistics_info.tiered_lead_time[0]?.quantity)
        );
        break;
      case 'price_quantity':
        Reflect.set(
          head(product.trade_info.price.tiered_price),
          'quantity',
          String(product.trade_info.price.tiered_price[0]?.quantity)
        );
        break;
      case 'currency':
        Reflect.set(product.trade_info.price, 'currency', false);
        break;
      case 'sku_price':
        Reflect.set(head(product.sku_info).sku_price, 'price', Number(product.sku_info[0]?.sku_price.price));
        break;
      case 'title':
        Reflect.set(product.basic_info, 'title', false);
        break;
      case 'language':
        Reflect.set(product.basic_info, 'language', null);
        break;
      case 'page_index':
        Reflect.set(data.page, 'page_index', String(data.page.page_index));
        break;
      case 'page_size':
        Reflect.set(data.page, 'page_size', String(data.page.page_size));
        break;
      case 'success':
        Reflect.set(data, 'success', 'true');
        break;
    }
    expect(search(data)).toBe(false);
  });
  it.each(['success', 'page', 'product_info'])('retains mandatory root %s', (field) => {
    const data = response();
    Reflect.deleteProperty(data, field);
    expect(search(data)).toBe(false);
    expect(search.errors?.some((error) => error.keyword === 'required')).toBe(true);
  });
  it.each(['string', 'number'] as const)('retains existing get/v2 tier price %s compatibility', (type) => {
    const product = first(response());
    const price = structuredClone(product.trade_info.price);
    if (type === 'string')
      Reflect.set(head(price.tiered_price), 'price', String(price.tiered_price[0]?.price));
    const data = { success: true, product_info: { trade_info: { price } } };
    const before = structuredClone(data);
    expect(get(data), JSON.stringify(get.errors)).toBe(true);
    expect(data).toEqual(before);
  });
  it('does not widen get/v2 lead_time, which is already documented as Number', () => {
    const logistics = structuredClone(first(response()).logistics_info);
    Reflect.set(
      head(logistics.tiered_lead_time),
      'lead_time',
      String(logistics.tiered_lead_time[0]?.lead_time)
    );
    expect(get({ success: true, product_info: { logistics_info: logistics } })).toBe(false);
  });
  it.each(['modelNumber', 'skuCode'] as const)(
    'passes the fresh contract through lookup for explicit %s only',
    async (key) => {
      const data = response(),
        before = structuredClone(data);
      const request = vi.fn(() => {
        const valid = search(data);
        return Promise.resolve({
          method: fixture.method,
          traceId: 'synthetic-numeric-lookup',
          contractValid: valid,
          contractIssues: [],
          data
        });
      });
      const client = new ProductLookupClient({ request } as Pick<GatewayClient, 'request'>);
      expect(request).not.toHaveBeenCalled();
      const page = await client.search({ [key]: fixture.query[key] });
      expect(request).toHaveBeenCalledExactlyOnceWith('callCapability', {
        method: fixture.method,
        parameters: {
          [key === 'modelNumber' ? 'model_number' : 'sku_code']: fixture.query[key],
          page_index: 1,
          page_size: 20
        }
      });
      expect(page.items[0]).toMatchObject({
        productId: first(data).basic_info.product_id,
        modelNumber: fixture.query.modelNumber,
        skus: [{ id: first(data).sku_info[0]?.sku_id, code: fixture.query.skuCode }]
      });
      expect(data).toEqual(before);
    }
  );
});
