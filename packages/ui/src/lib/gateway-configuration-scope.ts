import { GatewayException } from '@one-vegetable/core';
import type { GatewayClient } from '@one-vegetable/core';

/** Do not let a late response repopulate a view after a credential replacement. */
export function createGatewayConfigurationScope(source: GatewayClient): {
  gateway: GatewayClient;
  invalidate(): void;
} {
  let generation = 0;
  return {
    invalidate() {
      generation += 1;
    },
    gateway: {
      ...(source.galleryTransferContext
        ? { galleryTransferContext: source.galleryTransferContext.bind(source) }
        : {}),
      async request(operation, payload, options) {
        const captured = generation;
        const data = await source.request(operation, payload, options);
        if (captured !== generation)
          throw new GatewayException({
            code: 'GALLERY_CONTEXT_CHANGED',
            message: 'GALLERY_CONTEXT_CHANGED',
            retryable: false
          });
        return data;
      }
    }
  };
}
