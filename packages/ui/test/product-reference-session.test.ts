import { describe, expect, it, vi } from 'vitest';
import type { GatewayClient, RequestOf } from '@one-vegetable/core';
import { GatewayException } from '@one-vegetable/core/errors';
import { IOP_REFERENCE_METHODS, ProductReferenceClient } from '@one-vegetable/core/product-reference';
import examples from '../../../mock/data/product-reference/examples.json';
import { createProductReferenceSession, PRODUCT_REFERENCE_TTL } from '../src/lib/product-reference-session';

const fixtures: Record<string, { response: unknown }> = examples;
function harness() {
  let context = { identity: 'account-a', gateway: 'iop-config-a', storage: null };
  const contextRead = vi.fn((_operation: unknown, _payload: unknown) => Promise.resolve({ ...context }));
  const request = vi.fn((_operation: unknown, payload: RequestOf<'callCapability'>) =>
    Promise.resolve({
      method: payload.method,
      traceId: 'fixture',
      contractValid: true,
      contractIssues: [],
      data: structuredClone(fixtures[payload.method]?.response)
    })
  );
  const gateway: GatewayClient = { request, galleryTransferContext: contextRead };
  return {
    gateway,
    request,
    contextRead,
    setContext: (next: typeof context) => {
      context = next;
    }
  };
}
describe('product reference exact-payload read boundary', () => {
  it('is lazy and pins the native method and real parameters, never a photo context', async () => {
    const h = harness();
    const session = createProductReferenceSession(h.gateway, () => 'runtime-a');
    expect(h.request).not.toHaveBeenCalled();
    expect(h.contextRead).not.toHaveBeenCalled();
    const client = new ProductReferenceClient(session.gateway);
    await client.getProduct('880001');
    const payload = { method: IOP_REFERENCE_METHODS.getProduct, parameters: { product_id: '880001' } };
    expect(h.request).toHaveBeenCalledWith('callCapability', payload, {
      galleryContext: { identity: 'account-a', gateway: 'iop-config-a', storage: null }
    });
    for (const args of h.contextRead.mock.calls) expect(args).toEqual(['callCapability', payload]);
  });
  it('shares pending and fresh reads for five minutes, then expires', async () => {
    const h = harness();
    let now = 100;
    const session = createProductReferenceSession(
      h.gateway,
      () => 'runtime-a',
      () => now
    );
    const client = new ProductReferenceClient(session.gateway);
    await Promise.all([client.getProduct('880001'), client.getProduct('880001')]);
    await client.getProduct('880001');
    expect(h.request).toHaveBeenCalledTimes(1);
    now += PRODUCT_REFERENCE_TTL;
    await client.getProduct('880001');
    expect(h.request).toHaveBeenCalledTimes(2);
  });
  it('isolates methods, payloads, runtime identities and selected credential configurations', async () => {
    const h = harness();
    let runtime = 'runtime-a';
    const session = createProductReferenceSession(h.gateway, () => runtime);
    const client = new ProductReferenceClient(session.gateway);
    await client.listCategories();
    await client.listCategories('220000');
    await client.getAttributes('220001');
    expect(h.request).toHaveBeenCalledTimes(3);
    runtime = 'runtime-b';
    await client.listCategories();
    h.setContext({ identity: 'account-b', gateway: 'iop-config-b', storage: null });
    await client.listCategories();
    expect(h.request).toHaveBeenCalledTimes(5);
  });
  it('does not cache provider business failures or invalid contracts', async () => {
    const h = harness();
    h.request.mockResolvedValueOnce({
      method: IOP_REFERENCE_METHODS.listCategories,
      traceId: 'bad',
      contractValid: true,
      contractIssues: [],
      data: { success: false }
    });
    const client = new ProductReferenceClient(createProductReferenceSession(h.gateway, () => 'a').gateway);
    await expect(client.listCategories()).rejects.toThrow();
    h.request.mockResolvedValueOnce({
      method: IOP_REFERENCE_METHODS.listCategories,
      traceId: 'invalid',
      contractValid: false,
      contractIssues: [],
      data: { success: true, data: [] }
    });
    await expect(client.listCategories()).rejects.toThrow();
    await client.listCategories();
    expect(h.request).toHaveBeenCalledTimes(3);
  });
  it('rejects TOP-only authorization before dispatch without cross-protocol retry', async () => {
    const h = harness();
    h.contextRead.mockRejectedValue(
      new GatewayException({
        code: 'ALIBABA_IOP_AUTHORIZATION_REQUIRED',
        message: 'IOP required',
        retryable: false
      })
    );
    const client = new ProductReferenceClient(createProductReferenceSession(h.gateway, () => 'a').gateway);
    await expect(client.listShippingTemplates()).rejects.toMatchObject({
      gatewayError: { code: 'ALIBABA_IOP_AUTHORIZATION_REQUIRED' }
    });
    expect(h.request).not.toHaveBeenCalled();
    expect(h.contextRead).toHaveBeenCalledTimes(1);
    expect(h.contextRead).toHaveBeenCalledWith('callCapability', {
      method: IOP_REFERENCE_METHODS.listShippingTemplates,
      parameters: {}
    });
  });
  it('fails closed when no exact context selector is available', async () => {
    const h = harness();
    delete h.gateway.galleryTransferContext;
    const client = new ProductReferenceClient(createProductReferenceSession(h.gateway, () => 'a').gateway);
    await expect(client.listCategories()).rejects.toMatchObject({
      gatewayError: { code: 'ALIBABA_IOP_AUTHORIZATION_REQUIRED' }
    });
    expect(h.request).not.toHaveBeenCalled();
  });
  it('drops a late response and never seeds the new identity cache', async () => {
    const h = harness();
    let runtime = 'a';
    let finish: (() => void) | undefined;
    const pause = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const response = h.request.getMockImplementation();
    if (!response) throw new Error('Missing fixture response');
    h.request.mockImplementationOnce(async (...args) => {
      await pause;
      return response(...args);
    });
    const session = createProductReferenceSession(h.gateway, () => runtime);
    const client = new ProductReferenceClient(session.gateway);
    const pending = client.getProduct('880001');
    await vi.waitFor(() => {
      expect(h.request).toHaveBeenCalledTimes(1);
    });
    runtime = 'b';
    session.invalidate();
    const rejected = expect(pending).rejects.toMatchObject({
      gatewayError: { code: 'PRODUCT_CONTEXT_CHANGED' }
    });
    finish?.();
    await rejected;
    await client.getProduct('880001');
    expect(h.request).toHaveBeenCalledTimes(2);
  });
  it('rechecks the selected configuration before returning a cached value', async () => {
    const h = harness();
    const client = new ProductReferenceClient(createProductReferenceSession(h.gateway, () => 'a').gateway);
    await client.listCategories();
    h.contextRead.mockResolvedValueOnce({ identity: 'account-a', gateway: 'iop-config-a', storage: null });
    h.contextRead.mockResolvedValueOnce({ identity: 'account-a', gateway: 'iop-config-b', storage: null });
    await expect(client.listCategories()).rejects.toMatchObject({
      gatewayError: { code: 'PRODUCT_CONTEXT_CHANGED' }
    });
    expect(h.request).toHaveBeenCalledTimes(1);
  });
});
