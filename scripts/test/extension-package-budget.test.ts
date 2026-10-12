import { describe, expect, it } from 'vitest';
import {
  assertExtensionUnpackedBudget,
  assertExtensionZipBudget,
  assertStoreListingVersion,
  EXTENSION_UNPACKED_MAX_BYTES,
  EXTENSION_ZIP_MAX_BYTES
} from '../lib/extension-package-budget';

describe('Store package preflight', () => {
  it('pins the approved decimal-byte package budgets', () => {
    expect(EXTENSION_ZIP_MAX_BYTES).toBe(2_000_000);
    expect(EXTENSION_UNPACKED_MAX_BYTES).toBe(5_470_000);
  });
  describe.each([
    { name: 'Store ZIP', assertBudget: assertExtensionZipBudget, maxBytes: EXTENSION_ZIP_MAX_BYTES },
    {
      name: 'Unpacked extension',
      assertBudget: assertExtensionUnpackedBudget,
      maxBytes: EXTENSION_UNPACKED_MAX_BYTES
    }
  ])('$name budget', ({ assertBudget, maxBytes }) => {
    it('accepts zero bytes', () => {
      expect(() => {
        assertBudget(0);
      }).not.toThrow();
    });
    it('accepts exactly the byte limit', () => {
      expect(() => {
        assertBudget(maxBytes);
      }).not.toThrow();
    });
    it('rejects one byte above the limit', () => {
      expect(() => {
        assertBudget(maxBytes + 1);
      }).toThrow(`${maxBytes} bytes`);
    });
    it.each([NaN, Infinity, -Infinity, -1, -0.5, 0.5, Number.MAX_SAFE_INTEGER + 1])(
      'rejects invalid byte count %s',
      (size) => {
        expect(() => {
          assertBudget(size);
        }).toThrow();
      }
    );
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
