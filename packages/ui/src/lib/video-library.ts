import type { GatewayClient, RequestOf, ResponseOf } from '@one-vegetable/core';
import {
  validateVideoPage,
  validateVideoRelations,
  validateVideoProductResolution
} from '@one-vegetable/core/video';
import { pageDetailIdentity } from './page-details';
import { GatewayException } from '@one-vegetable/core/errors';
type Operation = 'listVideos' | 'listVideoRelatedProducts' | 'resolveVideoRelatedProduct';
type Value = ResponseOf<Operation>;
const cache = new WeakMap<GatewayClient, Map<string, { at: number; value: Value }>>();
const validators = {
  listVideos: validateVideoPage,
  listVideoRelatedProducts: validateVideoRelations,
  resolveVideoRelatedProduct: validateVideoProductResolution
};
/** Short-lived, account-scoped and bounded. Every request also carries the checked opaque context. */
export async function requestVideo<K extends Operation>(
  gateway: GatewayClient,
  mode: string,
  language: string,
  operation: K,
  payload: RequestOf<K>,
  expectedIdentity: string,
  refresh = false
): Promise<ResponseOf<K>> {
  const context = await gateway.galleryTransferContext?.();
  const identity = context
    ? JSON.stringify([context.identity, context.gateway])
    : mode === 'mock'
      ? 'mock'
      : '';
  if (!identity || identity !== expectedIdentity) fail('GALLERY_CONTEXT_CHANGED');
  let entries = cache.get(gateway);
  if (!entries) {
    entries = new Map();
    cache.set(gateway, entries);
  }
  const key = JSON.stringify([mode, identity, language, operation, payload]);
  const old = entries.get(key);
  if (!refresh && old && Date.now() - old.at < 300_000) return old.value;
  const result = await gateway.request(operation, payload, context ? { galleryContext: context } : undefined);
  if ((await pageDetailIdentity(gateway, mode)) !== identity) fail('GALLERY_CONTEXT_CHANGED');
  if (!validators[operation](result)) fail('VIDEO_RESPONSE_INVALID');
  if (entries.size >= 200) entries.clear();
  entries.set(key, { at: Date.now(), value: result });
  return result;
}
function fail(code: string): never {
  throw new GatewayException({ code, message: code, retryable: false });
}
export class VideoReadScope {
  private revision = 0;
  stop() {
    this.revision++;
  }
  capture() {
    const revision = this.revision;
    return () => revision === this.revision;
  }
}
