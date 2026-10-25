import { describe, expect, it } from 'vitest';
import { IOP_REFERENCE_METHODS } from '@one-vegetable/core/product-reference';
import { applyExtensionCapabilityProtocol } from '../lib/operation-availability';

describe('native product reference catalogue availability', () => {
  it.each(['top', 'iop'] as const)('supports configured IOP regardless of default %s', (defaultProtocol) => {
    for (const method of Object.values(IOP_REFERENCE_METHODS)) {
      expect(
        applyExtensionCapabilityProtocol(
          { method, realCallEnabled: true },
          {
            state: 'unlocked',
            protocol: defaultProtocol,
            pool: { top: true, iop: true, defaultProtocol, bindingConfirmed: false }
          }
        ).realCallEnabled
      ).toBe(true);
      expect(
        applyExtensionCapabilityProtocol(
          { method, realCallEnabled: true },
          {
            state: 'unlocked',
            protocol: 'top',
            pool: { top: true, iop: false, defaultProtocol, bindingConfirmed: false }
          }
        ).realCallEnabled
      ).toBe(false);
    }
  });
  it('keeps legacy TOP catalogue usable and disables native-only entries individually', () => {
    expect(
      applyExtensionCapabilityProtocol(
        {
          method: IOP_REFERENCE_METHODS.getProduct,
          realCallEnabled: true
        },
        { state: 'legacy', protocol: 'top' }
      ).realCallEnabled
    ).toBe(false);
    expect(
      applyExtensionCapabilityProtocol(
        {
          method: 'alibaba.icbu.product.list',
          realCallEnabled: true
        },
        { state: 'legacy', protocol: 'top' }
      ).realCallEnabled
    ).toBe(true);
  });
});
