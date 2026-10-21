import { describe, expect, it, vi } from 'vitest';
import { GatewayException } from '@one-vegetable/core';
import photos from '../../../mock/data/photos.json';
import {
  createExtensionOperationAvailabilityClient,
  type AuthorizationStatus
} from '../lib/operation-availability';

describe('context-bound extension availability', () => {
  it('allows background operations while only the sensitive settings view is locked', async () => {
    const client = createExtensionOperationAvailabilityClient(() =>
      Promise.resolve({
        state: 'locked',
        gatewayAvailable: true,
        protocol: 'top'
      })
    );
    expect(await client.get(['listProducts', 'createTradeOrder'])).toMatchObject({
      items: [{ allowed: true }, { allowed: false, reasonCode: 'REAL_MUTATION_DISABLED' }]
    });
  });

  it.each([
    { state: 'locked' as const },
    { state: 'locked' as const, gatewayAvailable: false },
    { state: 'invalid' as const, gatewayAvailable: true }
  ])('fails closed when a locked or invalid record has no usable background key: %j', async (status) => {
    const client = createExtensionOperationAvailabilityClient(() => Promise.resolve(status));
    expect(await client.get(['listProducts'])).toMatchObject({
      items: [{ allowed: false, reasonCode: 'OPERATION_AVAILABILITY_UNAVAILABLE' }]
    });
  });
  it('forwards context and uses the background-matched IOP profile rather than dual default routing', async () => {
    const readStatus = vi.fn(() =>
      Promise.resolve<AuthorizationStatus>({
        state: 'unlocked',
        protocol: 'iop',
        pool: { top: true, iop: true, defaultProtocol: 'top', bindingConfirmed: false }
      })
    );
    const client = createExtensionOperationAvailabilityClient(readStatus);
    const options = { galleryContext: photos.transferContext };
    const scoped = await client.get(['listPhotos'], options);
    expect(readStatus).toHaveBeenCalledWith(options);
    expect(scoped).toMatchObject({
      items: [
        {
          operation: 'listPhotos',
          protocolSupport: {
            protocol: 'iop',
            constraints: ['photo-group-required', 'photo-group-scope-unverified']
          }
        }
      ]
    });
    const legacy = await client.get(['listPhotos']);
    expect(legacy.items[0]).not.toHaveProperty('protocolSupport');
  });

  it('retains historical TOP without requiring protocol metadata for unscoped callers', async () => {
    const client = createExtensionOperationAvailabilityClient(() => Promise.resolve({ state: 'legacy' }));
    expect(await client.get(['listPhotos'])).toMatchObject({ items: [{ allowed: true }] });
    expect(await client.get(['listPhotos'], { galleryContext: photos.transferContext })).toMatchObject({
      items: [{ allowed: false, reasonCode: 'OPERATION_AVAILABILITY_UNAVAILABLE' }]
    });
    const top = createExtensionOperationAvailabilityClient(() =>
      Promise.resolve({ state: 'unlocked', protocol: 'top' })
    );
    expect(
      await top.get(['listPhotos', 'createTradeOrder'], { galleryContext: photos.transferContext })
    ).toMatchObject({
      items: [
        { operation: 'listPhotos', allowed: true },
        { operation: 'createTradeOrder', allowed: false }
      ]
    });
  });

  it.each(['GALLERY_CONTEXT_CHANGED', 'GALLERY_CONTEXT_INVALID', 'GALLERY_CONTEXT_UNTRUSTED'])(
    'preserves %s as a denial without trying another status/profile',
    async (code) => {
      const readStatus = vi.fn(() =>
        Promise.reject(new GatewayException({ code, message: code, retryable: false }))
      );
      const client = createExtensionOperationAvailabilityClient(readStatus);
      expect(await client.get(['listPhotos'], { galleryContext: photos.transferContext })).toMatchObject({
        items: [{ allowed: false, reasonCode: code }]
      });
      expect(readStatus).toHaveBeenCalledOnce();
    }
  );
});
