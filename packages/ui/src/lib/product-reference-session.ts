import { GatewayException, type GatewayClient, type RequestOf, type ResponseOf } from '@one-vegetable/core';
import { IOP_REFERENCE_METHODS } from '@one-vegetable/core/product-reference';

export const PRODUCT_REFERENCE_TTL = 300_000;
type Payload = RequestOf<'callCapability'>;
type Result = ResponseOf<'callCapability'>;
interface Store {
  cache: Map<string, { at: number; data: Result }>;
  pending: Map<string, Promise<Result>>;
}
const stores = new WeakMap<GatewayClient, Store>();

/** Memory-only reads. Context is selected using the actual native method AND parameters. */
export function createProductReferenceSession(
  source: GatewayClient,
  boundary: () => string,
  now: () => number = Date.now
) {
  let epoch = 0;
  let alive = true;
  let store = stores.get(source);
  if (!store) {
    store = { cache: new Map(), pending: new Map() };
    stores.set(source, store);
  }
  const capturedStore = store;
  function invalidate(): void {
    epoch++;
    capturedStore.cache.clear();
    capturedStore.pending.clear();
  }
  async function read(payload: Payload): Promise<Result> {
    const capturedEpoch = epoch;
    const scope = boundary();
    const assertCurrent = () => {
      if (!alive || epoch !== capturedEpoch || boundary() !== scope)
        throw new GatewayException({
          code: 'PRODUCT_CONTEXT_CHANGED',
          message: 'PRODUCT_CONTEXT_CHANGED',
          retryable: false
        });
    };
    assertCurrent();
    if (!source.galleryTransferContext)
      throw new GatewayException({
        code: 'ALIBABA_IOP_AUTHORIZATION_REQUIRED',
        message: 'ALIBABA_IOP_AUTHORIZATION_REQUIRED',
        retryable: false
      });
    const context = await source.galleryTransferContext('callCapability', payload);
    assertCurrent();
    const key = JSON.stringify([scope, context.identity, context.gateway, payload]);
    async function checkContext(): Promise<void> {
      const current = await source.galleryTransferContext?.('callCapability', payload);
      assertCurrent();
      if (current?.identity !== context.identity || current.gateway !== context.gateway)
        throw new GatewayException({
          code: 'PRODUCT_CONTEXT_CHANGED',
          message: 'PRODUCT_CONTEXT_CHANGED',
          retryable: false
        });
    }
    const cached = capturedStore.cache.get(key);
    if (cached && now() - cached.at < PRODUCT_REFERENCE_TTL) {
      await checkContext();
      return cached.data;
    }
    const existing = capturedStore.pending.get(key);
    if (existing) {
      const data = await existing;
      await checkContext();
      return data;
    }
    const job = (async () => {
      const data = await source.request('callCapability', payload, { galleryContext: context });
      await checkContext();
      for (const [oldKey, entry] of capturedStore.cache)
        if (now() - entry.at >= PRODUCT_REFERENCE_TTL) capturedStore.cache.delete(oldKey);
      if (capturedStore.cache.size >= 100) capturedStore.cache.clear();
      const envelope =
        data.data && typeof data.data === 'object' ? (data.data as Record<string, unknown>) : null;
      const business = payload.method === IOP_REFERENCE_METHODS.predictCategory ? envelope?.result : envelope;
      if (
        data.contractValid &&
        business &&
        typeof business === 'object' &&
        'success' in business &&
        business.success === true
      )
        capturedStore.cache.set(key, { at: now(), data });
      return data;
    })();
    capturedStore.pending.set(key, job);
    try {
      return await job;
    } finally {
      if (capturedStore.pending.get(key) === job) capturedStore.pending.delete(key);
    }
  }
  const gateway: Pick<GatewayClient, 'request'> = {
    async request(operation, payload) {
      if (operation !== 'callCapability') throw new Error('PRODUCT_REFERENCE_READ_ONLY');
      return await read(payload as Payload);
    }
  };
  return {
    gateway,
    invalidate,
    dispose() {
      alive = false;
      epoch++;
    }
  };
}
