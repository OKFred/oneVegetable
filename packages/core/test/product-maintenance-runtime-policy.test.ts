import { describe, expect, it, vi } from 'vitest';
import {
  PRODUCT_MAINTENANCE_RUNTIME_ACCEPTANCE,
  isProductMaintenanceRuntimeAccepted,
  productMaintenanceRuntimeWriteEnabled
} from '../src/product-maintenance-runtime-policy';
import { PRODUCT_MAINTENANCE_METHODS } from '../src/product-maintenance-api';
import bridge from '../../../mock/data/product-maintenance-bridge.json';
import { isAccountVerifiedIopMethod } from '../src/alibaba-iop-business';

vi.mock('../src/alibaba-iop-business', () => ({
  isAccountVerifiedIopMethod: () => true
}));

describe('independent method and runtime maintenance acceptance', () => {
  for (const runtime of ['node', 'worker', 'extension'] as const) {
    it.each(Object.values(PRODUCT_MAINTENANCE_METHODS))(
      'starts denied for ' + runtime + ' and %s',
      (method) => {
        expect(PRODUCT_MAINTENANCE_RUNTIME_ACCEPTANCE[runtime]).toHaveLength(0);
        expect(isProductMaintenanceRuntimeAccepted(method, runtime)).toBe(false);
        expect(
          productMaintenanceRuntimeWriteEnabled({
            method,
            runtime,
            methodEnabled: true,
            mutationsPaused: false
          })
        ).toBe(false);
      }
    );
  }
  it('does not inherit a global registry accountVerified flag', () => {
    for (const method of Object.values(PRODUCT_MAINTENANCE_METHODS)) {
      expect(isAccountVerifiedIopMethod(method)).toBe(true);
      expect(isProductMaintenanceRuntimeAccepted(method, 'extension')).toBe(false);
      expect(isProductMaintenanceRuntimeAccepted(method, 'node')).toBe(false);
      expect(isProductMaintenanceRuntimeAccepted(method, 'worker')).toBe(false);
    }
  });
  it.each(bridge.invalidMethods)('denies unsupported or malformed native method %#', (method) => {
    expect(isProductMaintenanceRuntimeAccepted(method, 'extension')).toBe(false);
  });
  it.each(bridge.invalidRuntimes)('denies unsupported or malformed runtime %#', (runtime) => {
    expect(isProductMaintenanceRuntimeAccepted(PRODUCT_MAINTENANCE_METHODS.setPrice, runtime)).toBe(false);
  });
  it.each(bridge.flags)('has no implicit enablement from flags or pause values %#', (flags) => {
    for (const method of Object.values(PRODUCT_MAINTENANCE_METHODS))
      expect(productMaintenanceRuntimeWriteEnabled({ method, runtime: 'extension', ...flags })).toBe(false);
  });
  it('keeps the manifest and every empty runtime entry immutable', () => {
    expect(Object.isFrozen(PRODUCT_MAINTENANCE_RUNTIME_ACCEPTANCE)).toBe(true);
    for (const methods of Object.values(PRODUCT_MAINTENANCE_RUNTIME_ACCEPTANCE)) {
      expect(Object.isFrozen(methods)).toBe(true);
      expect(methods).toHaveLength(0);
    }
  });
  it('always denies draft deletion while reliable absence readback is unavailable', () => {
    for (const runtime of ['node', 'worker', 'extension'] as const)
      expect(
        productMaintenanceRuntimeWriteEnabled({
          method: PRODUCT_MAINTENANCE_METHODS.deleteDraft,
          runtime,
          methodEnabled: true,
          mutationsPaused: false
        })
      ).toBe(false);
  });
});
