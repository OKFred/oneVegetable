import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createMv3ReferenceGateway,
  installReferenceWorkerGuard
} from '../smoke-product-reference-extension-real';
import type { WorkerGuard } from '../smoke-product-reference-extension-real';
import { REFERENCE_METHODS } from '../smoke-product-reference-real';
import type { ReferenceOperation } from '../smoke-product-reference-real';

const context = { identity: '0'.repeat(64), gateway: '1'.repeat(64) };
const guard = () =>
  (globalThis as typeof globalThis & { __productReferenceGuard: WorkerGuard }).__productReferenceGuard;
const url = (operation: ReferenceOperation) =>
  'https://openapi-api.alibaba.com/rest' + REFERENCE_METHODS[operation];
const signed = (requestId: string): RequestInit => ({
  method: 'POST',
  headers: { 'X-Request-ID': requestId },
  body: 'app_key=fixture&access_token=fixture&sign=fixture&sign_method=sha256'
});

afterEach(() => {
  Reflect.deleteProperty(globalThis, '__productReferenceGuard');
  vi.unstubAllGlobals();
});

describe('MV3 product reference guard and runtime bridge (offline, no browser launch)', () => {
  it('carries the actual product context and preserves runtime request correlation', async () => {
    const requestId = randomUUID();
    const dispatch = vi.fn<(message: Record<string, unknown>) => Promise<unknown>>().mockResolvedValue({
      ok: true,
      requestId,
      data: { method: REFERENCE_METHODS.getProduct, contractValid: true, data: {} }
    });
    const gateway = createMv3ReferenceGateway(dispatch, context);
    const payload = { method: REFERENCE_METHODS.getProduct, parameters: { product_id: '880001' } };
    await gateway.request('callCapability', payload, { requestId });
    expect(dispatch).toHaveBeenCalledWith({
      kind: 'gateway-request',
      operation: 'callCapability',
      requestId,
      productContext: context,
      payload
    });
    dispatch.mockResolvedValue({ ok: true, requestId: randomUUID(), data: {} });
    await expect(gateway.request('callCapability', payload, { requestId })).rejects.toThrow(
      'READ_CORRELATION_NOT_CONFIRMED'
    );
    expect(() => createMv3ReferenceGateway(dispatch, null)).toThrow('PRODUCT_CONTEXT_INVALID');
  });
  it('requires a signed armed request and preserves cumulative sends after disarm', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ code: '0' }));
    vi.stubGlobal('fetch', transport);
    installReferenceWorkerGuard();
    const requestId = randomUUID();
    await expect(fetch(url('getProduct'), signed(requestId))).rejects.toThrow('READ_ONLY_NETWORK_DENIED');
    guard().arm('getProduct', requestId);
    await fetch(url('getProduct'), signed(requestId));
    expect(transport).toHaveBeenCalledOnce();
    const request = transport.mock.calls[0]?.[0];
    if (!(request instanceof Request)) throw new Error('MISSING_REQUEST');
    expect(request.redirect).toBe('error');
    expect(guard().snapshot()).toMatchObject({ sent: 1, total: 1, activeSent: 1 });
    guard().disarm();
    expect(guard().snapshot()).toMatchObject({ sent: 1, total: 1, activeSent: 0 });
  });
});
