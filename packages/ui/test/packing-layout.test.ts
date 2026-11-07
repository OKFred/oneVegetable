import { afterEach, describe, expect, it, vi } from 'vitest';
import fixture from '../../../mock/data/logistics/packing-example.json';
import {
  packCargo,
  validatePackingInput,
  validatePackingResult,
  type PackingCargo,
  type PackingInput,
  type PackingResult
} from '../src/lib/packing-layout';

function input(
  cargo: Partial<PackingCargo> = {},
  container = { length: 10, width: 10, height: 10 }
): PackingInput {
  return {
    container,
    cargo: [
      {
        id: 'cargo',
        name: 'Cargo',
        size: { length: 2, width: 2, height: 2 },
        quantity: 1,
        allowRotation: false,
        ...cargo
      }
    ]
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('packing input validation', () => {
  it.each([
    null,
    undefined,
    {},
    [],
    { container: null, cargo: [] },
    { ...input(), cargo: null },
    { ...input(), cargo: {} },
    { ...input(), cargo: [null] },
    { ...input(), cargo: [] }
  ])('rejects malformed input %# with a stable internal error', (value) => {
    expect(() => packCargo(value as PackingInput)).toThrow('Invalid packing input');
  });

  for (const target of ['container', 'cargo'] as const) {
    for (const axis of ['length', 'width', 'height'] as const) {
      it.each([0, -1, 100_001, 1.5, NaN, Infinity, '10', null, undefined])(
        `rejects non-integer/out-of-range ${target}.${axis}: %s`,
        (value) => {
          const size = { length: 2, width: 2, height: 2, [axis]: value };
          const request = target === 'container' ? { ...input(), container: size } : input({ size: size });
          expect(() => {
            validatePackingInput(request);
          }).toThrow('Invalid packing input');
        }
      );
    }
  }

  it('accepts the integer millimetre bounds with exact safe volume accounting', () => {
    expect(
      packCargo(input({ size: { length: 1, width: 1, height: 1 } }, { length: 1, width: 1, height: 1 }))
        .usedVolume
    ).toBe(1);
    const size = { length: 100_000, width: 100_000, height: 100_000 };
    const result = packCargo(input({ size, quantity: 500 }, size));
    expect(result).toMatchObject({
      packedCount: 1,
      totalCount: 500,
      containerVolume: 1_000_000_000_000_000,
      usedVolume: 1_000_000_000_000_000,
      unplaced: [{ cargoId: 'cargo', count: 499, reason: 'space' }]
    });
  });

  for (const field of ['id', 'name'] as const) {
    it.each(['', '   ', 'x'.repeat(101), 1, null, undefined])(
      `rejects invalid cargo ${field}: %s`,
      (value) => {
        expect(() => {
          validatePackingInput(input({ [field]: value }));
        }).toThrow('Invalid packing input');
      }
    );
  }

  it.each([0, -1, 1.25, 501, NaN, Infinity, '1', null, undefined])(
    'rejects invalid quantity %s',
    (quantity) => {
      expect(() => {
        validatePackingInput(input({ quantity } as Partial<PackingCargo>));
      }).toThrow('Invalid packing input');
    }
  );

  it.each([0, 1, 'true', null, undefined])('rejects non-boolean rotation %s', (allowRotation) => {
    expect(() => {
      validatePackingInput(input({ allowRotation } as unknown as Partial<PackingCargo>));
    }).toThrow('Invalid packing input');
  });

  it('rejects duplicate ids, too many rows, and a combined quantity over 500', () => {
    const cargo = input().cargo;
    expect(() => {
      validatePackingInput({ ...input(), cargo: [...cargo, ...cargo] });
    }).toThrow('Invalid packing input');
    const rows = Array.from({ length: 21 }, (_, index) => ({
      id: String(index),
      name: 'Cargo',
      size: { length: 1, width: 1, height: 1 },
      quantity: 25,
      allowRotation: true
    }));
    expect(() => {
      validatePackingInput({ ...input(), cargo: rows });
    }).toThrow('Invalid packing input');
    expect(() => {
      validatePackingInput({ ...input(), cargo: rows.slice(0, 20).map((row) => ({ ...row, quantity: 26 })) });
    }).toThrow('Invalid packing input');
  });

  it('accepts 20 unique rows, 100-character identities, and a combined 500 items', () => {
    const request = input({}, { length: 10, width: 10, height: 5 });
    request.cargo = Array.from({ length: 20 }, (_, index) => ({
      id: String(index).padEnd(100, 'x'),
      name: 'N'.repeat(100),
      size: { length: 1, width: 1, height: 1 },
      quantity: 25,
      allowRotation: true
    }));
    expect(packCargo(request)).toMatchObject({
      packedCount: 500,
      totalCount: 500,
      usedVolume: 500,
      unplaced: []
    });
  });
});

describe('deterministic packing', () => {
  it('packs the explicitly loaded prototype fixture without changing it', () => {
    const request = structuredClone(fixture);
    const before = structuredClone(request);
    const result = packCargo(request);
    expect(result).toMatchObject({
      packedCount: 20,
      totalCount: 20,
      containerVolume: 135_000_000,
      usedVolume: 84_000_000,
      unplaced: []
    });
    expect(result.usedVolume / 1_000_000_000).toBe(0.084);
    expect(((100 * result.usedVolume) / result.containerVolume).toFixed(1)).toBe('62.2');
    expect(request).toEqual(before);
    expect(() => {
      validatePackingResult(request, result);
    }).not.toThrow();
    for (let repeat = 0; repeat < 5; repeat++) expect(packCargo(request)).toEqual(result);
  });

  it('sorts by single-item volume and keeps equal-volume row/copy order', () => {
    const request = input();
    request.cargo = [
      { ...input({ id: 'small', quantity: 3 }).cargo[0] } as PackingCargo,
      {
        ...input({ id: 'first', quantity: 2, size: { length: 2, width: 3, height: 2 } }).cargo[0]
      } as PackingCargo,
      { ...input({ id: 'second', size: { length: 3, width: 2, height: 2 } }).cargo[0] } as PackingCargo
    ];
    expect(packCargo(request).placements.map(({ cargoId, index }) => [cargoId, index])).toEqual([
      ['first', 0],
      ['first', 1],
      ['second', 0],
      ['small', 0],
      ['small', 1],
      ['small', 2]
    ]);
  });

  it('uses lower spaces before upper spaces, then the least volume waste', () => {
    const request = input({}, { length: 5, width: 4, height: 3 });
    request.cargo = [
      {
        id: 'large',
        name: 'Large',
        size: { length: 3, width: 2, height: 1 },
        quantity: 1,
        allowRotation: false
      },
      {
        id: 'small',
        name: 'Small',
        size: { length: 1, width: 1, height: 1 },
        quantity: 2,
        allowRotation: false
      }
    ];
    expect(packCargo(request).placements.map(({ cargoId, x, y, z }) => [cargoId, x, y, z])).toEqual([
      ['large', 0, 0, 0],
      ['small', 0, 2, 0],
      ['small', 0, 3, 0]
    ]);
  });

  it.each([
    { length: 2, width: 3, height: 4 },
    { length: 2, width: 4, height: 3 },
    { length: 3, width: 2, height: 4 },
    { length: 3, width: 4, height: 2 },
    { length: 4, width: 2, height: 3 },
    { length: 4, width: 3, height: 2 }
  ])('uses each allowed unique orientation when required: %o', (container) => {
    const request = input({ size: { length: 2, width: 3, height: 4 }, allowRotation: true }, container);
    expect(packCargo(request).placements[0]?.size).toEqual(container);
  });

  it('never rotates when disabled and reports dimensional impossibility', () => {
    const request = input({ size: { length: 2, width: 3, height: 4 } }, { length: 4, width: 3, height: 2 });
    expect(packCargo(request)).toMatchObject({
      placements: [],
      packedCount: 0,
      usedVolume: 0,
      unplaced: [{ cargoId: 'cargo', count: 1, reason: 'dimensions' }]
    });
  });

  it('prefers the identity orientation and deduplicates square/cube rotations deterministically', () => {
    for (const size of [
      { length: 2, width: 3, height: 4 },
      { length: 2, width: 2, height: 3 },
      { length: 2, width: 2, height: 2 }
    ]) {
      const request = input({ size, allowRotation: true, quantity: 8 });
      const result = packCargo(request);
      expect(result.placements[0]?.size).toEqual(size);
      expect(result.packedCount).toBe(8);
      expect(new Set(result.placements.map((item) => item.index)).size).toBe(8);
      expect(packCargo(request)).toEqual(result);
    }
  });

  it('distinguishes heuristic space exhaustion from impossible dimensions', () => {
    const request = input({}, { length: 4, width: 4, height: 1 });
    request.cargo = [
      { id: 'a', name: 'A', size: { length: 3, width: 2, height: 1 }, quantity: 1, allowRotation: false },
      { id: 'b', name: 'B', size: { length: 2, width: 2, height: 1 }, quantity: 2, allowRotation: true },
      { id: 'c', name: 'C', size: { length: 5, width: 1, height: 1 }, quantity: 2, allowRotation: true }
    ];
    const result = packCargo(request);
    expect(result).toMatchObject({ totalCount: 5, packedCount: 2, usedVolume: 10 });
    expect(result.unplaced).toEqual([
      { cargoId: 'c', count: 2, reason: 'dimensions' },
      { cargoId: 'b', count: 1, reason: 'space' }
    ]);
  });

  it('does not alias input dimensions or leak mutable state across calls', () => {
    const request = input();
    const expected = packCargo(request);
    const changed = packCargo(request);
    if (changed.placements[0]) changed.placements[0].size.length = 999;
    expect(packCargo(request)).toEqual(expected);
    expect(request.cargo[0]?.size.length).toBe(2);
  });

  it('preserves bounds, identities, counts, non-overlap and support across seeded random cases', () => {
    let seed = 0x1a2b3c4d;
    const random = (max: number) => {
      seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
      return seed % max;
    };
    for (let run = 0; run < 100; run++) {
      const request: PackingInput = {
        container: { length: 12 + random(20), width: 12 + random(20), height: 12 + random(20) },
        cargo: Array.from({ length: 1 + random(6) }, (_, index) => ({
          id: String(index),
          name: 'Random cargo',
          size: { length: 1 + random(20), width: 1 + random(20), height: 1 + random(20) },
          quantity: 1 + random(12),
          allowRotation: random(2) === 1
        }))
      };
      const before = structuredClone(request);
      const result = packCargo(request);
      expect(() => {
        validatePackingResult(request, result);
      }).not.toThrow();
      expect(packCargo(request)).toEqual(result);
      expect(request).toEqual(before);
      expect(result.packedCount + result.unplaced.reduce((sum, row) => sum + row.count, 0)).toBe(
        result.totalCount
      );
      expect(result.usedVolume).toBe(
        result.placements.reduce((sum, row) => sum + row.size.length * row.size.width * row.size.height, 0)
      );
      for (const cargo of request.cargo) {
        const packed = result.placements.filter((row) => row.cargoId === cargo.id);
        expect(
          packed.length +
            result.unplaced.filter((row) => row.cargoId === cargo.id).reduce((sum, row) => sum + row.count, 0)
        ).toBe(cargo.quantity);
        expect(packed.map((row) => row.index)).toEqual(
          Array.from({ length: packed.length }, (_, index) => index)
        );
      }
      for (const [index, row] of result.placements.entries()) {
        expect(row.x).toBeGreaterThanOrEqual(0);
        expect(row.y).toBeGreaterThanOrEqual(0);
        expect(row.z).toBeGreaterThanOrEqual(0);
        expect(row.x + row.size.length).toBeLessThanOrEqual(request.container.length);
        expect(row.y + row.size.width).toBeLessThanOrEqual(request.container.width);
        expect(row.z + row.size.height).toBeLessThanOrEqual(request.container.height);
        for (const other of result.placements.slice(index + 1)) {
          expect(
            row.x < other.x + other.size.length &&
              other.x < row.x + row.size.length &&
              row.y < other.y + other.size.width &&
              other.y < row.y + row.size.width &&
              row.z < other.z + other.size.height &&
              other.z < row.z + row.size.height
          ).toBe(false);
        }
        if (row.z > 0) {
          expect(
            result.placements.some(
              (base) =>
                base.z + base.size.height === row.z &&
                base.x <= row.x &&
                base.y <= row.y &&
                base.x + base.size.length >= row.x + row.size.length &&
                base.y + base.size.width >= row.y + row.size.width
            )
          ).toBe(true);
        }
      }
    }
  });
});

describe('packing result assertions', () => {
  it.each(['totalCount', 'packedCount', 'containerVolume', 'usedVolume'] as const)(
    'rejects incorrect %s',
    (key) => {
      const request = input();
      const result = packCargo(request);
      result[key]++;
      expect(() => {
        validatePackingResult(request, result);
      }).toThrow('Invalid packing result');
    }
  );

  const corruptions: [string, (result: PackingResult) => void][] = [
    [
      'unknown identity',
      (result) => {
        if (result.placements[0]) result.placements[0].cargoId = 'unknown';
      }
    ],
    [
      'invalid copy index',
      (result) => {
        if (result.placements[0]) result.placements[0].index = 2;
      }
    ],
    [
      'fractional coordinate',
      (result) => {
        if (result.placements[0]) result.placements[0].x = 0.5;
      }
    ],
    [
      'negative coordinate',
      (result) => {
        if (result.placements[0]) result.placements[0].x = -1;
      }
    ],
    [
      'out of bounds',
      (result) => {
        if (result.placements[0]) result.placements[0].x = 10;
      }
    ],
    [
      'forbidden rotation',
      (result) => {
        if (result.placements[0]) result.placements[0].size = { length: 3, width: 2, height: 4 };
      }
    ],
    [
      'floating placement',
      (result) => {
        if (result.placements[0]) result.placements[0].z = 1;
      }
    ],
    [
      'duplicate identity',
      (result) => {
        if (result.placements[0]) result.placements[1] = structuredClone(result.placements[0]);
      }
    ],
    [
      'overlap',
      (result) => {
        if (result.placements[0] && result.placements[1]) {
          Object.assign(result.placements[1], {
            x: result.placements[0].x,
            y: result.placements[0].y,
            z: result.placements[0].z
          });
        }
      }
    ],
    [
      'lost item',
      (result) => {
        result.placements.pop();
        result.packedCount--;
        result.usedVolume -= 24;
      }
    ]
  ];
  it.each(corruptions)('rejects %s', (_name, corrupt) => {
    const request = input({ size: { length: 2, width: 3, height: 4 }, quantity: 2 });
    const result = packCargo(request);
    corrupt(result);
    expect(() => {
      validatePackingResult(request, result);
    }).toThrow('Invalid packing result');
  });

  it('rejects incorrect, duplicated or missing unplaced counts/reasons/identities', () => {
    const request = input({ quantity: 3 }, { length: 2, width: 2, height: 2 });
    for (const replacement of [
      [],
      [{ cargoId: 'cargo', count: 1, reason: 'space' }],
      [{ cargoId: 'cargo', count: 2, reason: 'dimensions' }],
      [{ cargoId: 'cargo', count: 2, reason: 'other' }],
      [{ cargoId: 'other', count: 2, reason: 'space' }],
      [{ cargoId: 'cargo', count: 2.5, reason: 'space' }],
      [{ cargoId: 'cargo', count: 0, reason: 'space' }],
      [
        { cargoId: 'cargo', count: 1, reason: 'space' },
        { cargoId: 'cargo', count: 1, reason: 'space' }
      ]
    ]) {
      const result = packCargo(request);
      result.unplaced = replacement as PackingResult['unplaced'];
      expect(() => {
        validatePackingResult(request, result);
      }).toThrow('Invalid packing result');
    }
  });
});

describe('packing worker messages', () => {
  it('accepts a direct input and replies only with result or a stable error, then remains usable', async () => {
    const postMessage = vi.fn<(message: unknown) => void>();
    vi.stubGlobal('postMessage', postMessage);
    vi.stubGlobal('onmessage', null);
    await import('../src/workers/packing.worker');
    const receive: ((event: MessageEvent<unknown>) => void) | null = globalThis.onmessage;
    expect(receive).toBeTypeOf('function');
    receive?.(new MessageEvent('message', { data: fixture }));
    expect(postMessage).toHaveBeenNthCalledWith(1, { result: packCargo(fixture) });
    receive?.(new MessageEvent('message', { data: { container: null, cargo: [] } }));
    expect(postMessage).toHaveBeenNthCalledWith(2, { error: 'Invalid packing input' });
    receive?.(new MessageEvent('message', { data: input() }));
    expect(postMessage).toHaveBeenNthCalledWith(3, { result: packCargo(input()) });
  });
});
