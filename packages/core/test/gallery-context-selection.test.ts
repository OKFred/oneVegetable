import { describe, expect, it } from 'vitest';
import { validGalleryContextRequest } from '../src/gallery-transfer-context';
import { OPERATION_IDS } from '../src/operation-id';

describe('operation-scoped authorization context selection', () => {
  const requestId = '93294f89-560f-49a1-97e3-714db5858d50';

  it('accepts legacy requests and every registered operation without executing them', () => {
    expect(validGalleryContextRequest({ requestId })).toBe(true);
    for (const operation of OPERATION_IDS)
      expect(validGalleryContextRequest({ requestId, operation }), operation).toBe(true);
  });

  it.each([
    { operation: 'getProductInventory', payload: { source: 'sku' } },
    { operation: 'operatePhotoGroup', payload: { operation: 'delete' } },
    {
      operation: 'callCapability',
      payload: { method: 'alibaba.icbu.video.upload', parameters: {} }
    }
  ])('retains routing parameters for $operation', (selection) => {
    expect(validGalleryContextRequest({ requestId, ...selection })).toBe(true);
  });

  it.each([
    null,
    [],
    {},
    { requestId: 'invalid' },
    { requestId, operation: 'not-an-operation' },
    { requestId, operation: '__proto__' },
    { requestId, operation: null },
    { requestId, payload: {} },
    { requestId, operation: 'getProductShowcase', payload: [] },
    { requestId, operation: 'getProductShowcase', payload: null },
    { requestId, operation: 'getProductShowcase', protocol: 'top' }
  ])('rejects invalid or ambiguous selection: %j', (value) => {
    expect(validGalleryContextRequest(value)).toBe(false);
  });
});
