import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { ProductReferenceClient, IOP_REFERENCE_METHODS } from '../src/product-reference';
import { MockGatewayClient } from '../src/mock-client';
import {
  validateCapabilityRequest,
  validateCapabilityResponse,
  getCapabilityDefinition,
  listCapabilities
} from '../src/capability-registry';
import { selectAlibabaOperationProtocol } from '../src/alibaba-protocol-routing';
import { createIopBusinessRequest, normalizeIopBusinessResponse } from '../src/alibaba-iop-business';
import type { GatewayClient, GatewayCredentials } from '../src/types';

const fixture = JSON.parse(
  await readFile(new URL('../../../mock/data/product-reference/examples.json', import.meta.url), 'utf8')
) as Record<string, { request: Record<string, unknown>; response: Record<string, unknown> }>;
const credentials: GatewayCredentials = {
  protocol: 'iop',
  appKey: 'fixture-key',
  appSecret: 'fixture-secret',
  accessToken: 'fixture-token',
  endpoint: 'https://openapi-api.alibaba.com/rest',
  signMethod: 'hmac-sha256'
};
function example(method: string) {
  const value = fixture[method];
  if (!value) throw new Error('Missing reference fixture');
  return value;
}

describe('product reference facade', () => {
  const make = () => new ProductReferenceClient(new MockGatewayClient(0));
  it('preserves exact product, SKU, money, stock and separate audit state', async () => {
    const product = await make().getProduct('880001');
    expect(product.productId).toBe('880001');
    expect(product.status).toBe('online');
    expect(product.auditStatus).toBe('approved');
    expect(product.price.tiers[0]?.price).toBe('1.50');
    expect(product.inventory).toBe('50');
    expect(product.skus[0]?.id).toBe('990001');
    expect(product.createdTimestamp).toBe('1767225600000');
    expect(product).not.toHaveProperty('owner_ali_id');
    await expect(make().getProduct('880002')).rejects.toThrow('ALIBABA_IOP_RESPONSE_INVALID');
  });
  it('keeps category flags and general/sale attributes separate', async () => {
    const client = make();
    const categories = await client.listCategories();
    expect(categories.map((entry) => entry.leaf)).toEqual([false, true]);
    const attributes = await client.getAttributes('220001');
    expect(attributes.attributes[0]?.name).toBe('Material');
    expect(attributes.saleAttributes[0]?.name).toBe('Color');
    expect(attributes.attributes[0]?.custom).toBe(false);
    expect(attributes.saleAttributes[0]?.multiple).toBe(true);
    expect((await client.predictCategory({ title: 'Glass cup' })).categoryId).toBe('220001');
    expect((await client.listShippingTemplates())[0]?.id).toBe('550001');
  });
  it('rejects invalid IDs, blank titles and external images without dispatch', async () => {
    let calls = 0;
    const gateway = {
      request: () => {
        calls++;
        return Promise.reject(new Error('Unexpected request'));
      }
    } as Pick<GatewayClient, 'request'>;
    const client = new ProductReferenceClient(gateway);
    for (const value of ['', '1e3', '-1', '0001']) await expect(client.getProduct(value)).rejects.toThrow();
    await expect(client.predictCategory({ title: '  ' })).rejects.toThrow();
    await expect(
      client.predictCategory({ title: 'Cup', imageUrl: 'https://example.com/image.jpg' })
    ).rejects.toThrow();
    expect(calls).toBe(0);
  });
});

describe('native IOP product reference', () => {
  it('registers five read-only methods and validates every synthetic example', async () => {
    for (const method of Object.values(IOP_REFERENCE_METHODS)) {
      expect(listCapabilities().filter((entry) => entry.method === method)).toHaveLength(1);
      expect(getCapabilityDefinition(method)?.risk).toBe('read');
      expect(getCapabilityDefinition(method)?.docUrl).toContain('openapi.alibaba.com');
      await expect(validateCapabilityRequest(method, example(method).request)).resolves.toEqual([]);
      await expect(validateCapabilityResponse(method, example(method).response)).resolves.toEqual([]);
    }
    expect(getCapabilityDefinition('/alibaba/icbu/product/status/get/v2')).toBeNull();
  });
  it.each(['top', 'iop'] as const)('uses IOP with both authorizations and default %s', (defaultProtocol) => {
    for (const method of Object.values(IOP_REFERENCE_METHODS)) {
      const payload = { method, parameters: example(method).request };
      for (const top of [true, false])
        expect(
          selectAlibabaOperationProtocol('callCapability', payload, {
            top,
            iop: true,
            defaultProtocol,
            bindingConfirmed: false
          })
        ).toBe('iop');
      expect(() =>
        selectAlibabaOperationProtocol('callCapability', payload, {
          top: true,
          iop: false,
          defaultProtocol,
          bindingConfirmed: false
        })
      ).toThrow('ALIBABA_IOP_AUTHORIZATION_REQUIRED');
    }
  });
  it('signs the public path with lossless IDs and no TOP fields', async () => {
    const result = await createIopBusinessRequest(
      credentials,
      IOP_REFERENCE_METHODS.getProduct,
      { product_id: '9007199254740993' },
      1767225600000
    );
    expect(result.url).toBe(credentials.endpoint + IOP_REFERENCE_METHODS.getProduct);
    expect(result.parameters.product_id).toBe('9007199254740993');
    expect(result.parameters.access_token).toBe('fixture-token');
    expect(result.parameters.sign).toMatch(/^[A-F0-9]{64}$/u);
    expect(result.parameters).not.toHaveProperty('method');
    expect(result.parameters).not.toHaveProperty('session');
    await expect(
      createIopBusinessRequest(credentials, IOP_REFERENCE_METHODS.getProduct, {
        product_id: Number.MAX_SAFE_INTEGER + 1
      })
    ).rejects.toThrow('REQUEST_CONTRACT_INVALID');
    await expect(
      createIopBusinessRequest(credentials, IOP_REFERENCE_METHODS.listCategories, { language: 'en_US' })
    ).rejects.toThrow('ALIBABA_IOP_PARAMETER_UNSUPPORTED');
  });
  it('does not fabricate success from absent fields or business refusal', () => {
    expect(() =>
      normalizeIopBusinessResponse({ code: '0' }, IOP_REFERENCE_METHODS.getProduct, credentials)
    ).toThrow();
    expect(() =>
      normalizeIopBusinessResponse(
        { code: '0', success: false, message: 'Denied' },
        IOP_REFERENCE_METHODS.getProduct,
        credentials
      )
    ).toThrow('Denied');
    expect(
      normalizeIopBusinessResponse(
        example(IOP_REFERENCE_METHODS.getProduct).response,
        IOP_REFERENCE_METHODS.getProduct,
        credentials
      )
    ).toEqual(example(IOP_REFERENCE_METHODS.getProduct).response);
  });
});
