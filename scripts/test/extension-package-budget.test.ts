import { describe, expect, it } from 'vitest';
import {
  assertExtensionUnpackedBudget,
  assertExtensionZipBudget,
  assertPackingThreeBudget,
  assertPackingWorkerBudget,
  assertStoreListingVersion,
  EXTENSION_UNPACKED_MAX_BYTES,
  EXTENSION_ZIP_MAX_BYTES,
  PACKING_THREE_MAX_BYTES,
  PACKING_WORKER_MAX_BYTES
} from '../lib/extension-package-budget';
import { inspectExtensionWorkerGraph } from '../lib/extension-worker-graph';

const packingThreeFile = 'chunks/packing-three-abc123.js';

describe('Store package preflight', () => {
  it('pins the approved decimal-byte package budgets', () => {
    expect(EXTENSION_ZIP_MAX_BYTES).toBe(2_500_000);
    expect(EXTENSION_UNPACKED_MAX_BYTES).toBe(8_500_000);
    expect(PACKING_THREE_MAX_BYTES).toBe(1_000_000);
    expect(PACKING_WORKER_MAX_BYTES).toBe(50_000);
  });
  describe.each([
    { name: 'Store ZIP', assertBudget: assertExtensionZipBudget, maxBytes: EXTENSION_ZIP_MAX_BYTES },
    {
      name: 'Unpacked extension',
      assertBudget: assertExtensionUnpackedBudget,
      maxBytes: EXTENSION_UNPACKED_MAX_BYTES
    },
    {
      name: 'Packing Three.js',
      assertBudget: (size: number) => assertPackingThreeBudget([{ file: packingThreeFile, size }], []),
      maxBytes: PACKING_THREE_MAX_BYTES
    },
    {
      name: 'Local packing worker',
      assertBudget: (size: number) => {
        assertPackingWorkerBudget([{ file: 'assets/packing.worker-abc123.js', size }]);
      },
      maxBytes: PACKING_WORKER_MAX_BYTES
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
  it.each([{ chunks: [] }, { chunks: [{ file: 'chunks/business-packing-three-abc123.js', size: 1 }] }])(
    'requires the dedicated vendor chunk ($chunks)',
    ({ chunks }) => {
      expect(() => assertPackingThreeBudget(chunks, [])).toThrow('exactly one packing-three');
    }
  );
  it('rejects split vendor chunks instead of multiplying the allowance', () => {
    expect(() =>
      assertPackingThreeBudget(
        [
          { file: packingThreeFile, size: 600_000 },
          { file: 'chunks/packing-three-other.js', size: 600_000 }
        ],
        []
      )
    ).toThrow('exactly one packing-three');
  });
  it('returns the exact vendor filename so no other web chunk receives its budget', () => {
    expect(
      assertPackingThreeBudget(
        [
          { file: 'packing-three-web.js', size: PACKING_THREE_MAX_BYTES },
          { file: 'business.js', size: 500_000 }
        ],
        []
      )
    ).toBe('packing-three-web.js');
  });
  it.each(['background.js', 'chunks/options-entry.js'])(
    'rejects the vendor in the transitive static graph of %s',
    async (entry) => {
      const graph = await inspectExtensionWorkerGraph(entry, (file) =>
        Promise.resolve(
          file === entry
            ? `export * from ${JSON.stringify(entry === 'background.js' ? './chunks/shared.js' : './shared.js')};`
            : file === 'chunks/shared.js'
              ? 'import "./packing-three-abc123.js";'
              : ''
        )
      );
      expect(graph.errors).toEqual([]);
      expect(() => assertPackingThreeBudget([{ file: packingThreeFile, size: 1 }], graph.files)).toThrow(
        'background or eager page graph'
      );
    }
  );
  it('allows a dynamic Options import without pulling the vendor into the eager graph', async () => {
    const graph = await inspectExtensionWorkerGraph('chunks/options-entry.js', () =>
      Promise.resolve('export const preview = () => import("./packing-three-abc123.js");')
    );
    expect(graph.files).toEqual(['chunks/options-entry.js']);
    expect(() => assertPackingThreeBudget([{ file: packingThreeFile, size: 1 }], graph.files)).not.toThrow();
  });
  it('requires exactly one dedicated packing worker', () => {
    expect(() => {
      assertPackingWorkerBudget([]);
    }).toThrow('exactly one packing.worker');
    expect(() => {
      assertPackingWorkerBudget([
        { file: 'assets/packing.worker-one.js', size: 25_000 },
        { file: 'assets/packing.worker-two.js', size: 25_000 }
      ]);
    }).toThrow('exactly one packing.worker');
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
