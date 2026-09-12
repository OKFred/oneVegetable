import { describe, expect, it } from 'vitest';
import { assertExtensionZipBudget, assertStoreListingVersion } from '../lib/extension-package-budget';

describe('Store package preflight', () => {
  it('accepts exactly 1.5 decimal MB and rejects one byte more', () => {
    expect(() => {
      assertExtensionZipBudget(990914);
    }).not.toThrow();
    expect(() => {
      assertExtensionZipBudget(1_500_000);
    }).not.toThrow();
    expect(() => {
      assertExtensionZipBudget(1_500_001);
    }).toThrow('1.5 MB');
  });
  it.each([NaN, Infinity, -1, 0.5])('rejects invalid byte count %s', (size) => {
    expect(() => {
      assertExtensionZipBudget(size);
    }).toThrow();
  });
  it('checks listing before building or writing a release', () => {
    expect(() => {
      assertStoreListingVersion('2.8.0', { extensionVersion: '2.8.0' });
    }).not.toThrow();
    for (const listing of [null, {}, { extensionVersion: '2.7.0' }]) {
      expect(() => {
        assertStoreListingVersion('2.8.0', listing);
      }).toThrow('Store listing');
    }
  });
});
