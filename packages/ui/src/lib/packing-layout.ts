export interface PackingDimensions {
  length: number;
  width: number;
  height: number;
}

export interface PackingCargo {
  id: string;
  name: string;
  size: PackingDimensions;
  quantity: number;
  allowRotation: boolean;
}

export interface PackingInput {
  container: PackingDimensions;
  cargo: PackingCargo[];
}

export interface PackingPlacement {
  cargoId: string;
  index: number;
  x: number;
  y: number;
  z: number;
  size: PackingDimensions;
}

export interface PackingResult {
  placements: PackingPlacement[];
  unplaced: { cargoId: string; count: number; reason: 'dimensions' | 'space' }[];
  totalCount: number;
  packedCount: number;
  containerVolume: number;
  usedVolume: number;
}

const dimensions = ['length', 'width', 'height'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function validDimensions(size: unknown): size is PackingDimensions {
  return (
    isRecord(size) &&
    dimensions.every((axis) => {
      const value = size[axis];
      return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 100_000;
    })
  );
}

function volume(size: PackingDimensions): number {
  return size.length * size.width * size.height;
}

function fits(size: PackingDimensions, container: PackingDimensions): boolean {
  return dimensions.every((axis) => size[axis] <= container[axis]);
}

function sameSize(left: PackingDimensions, right: PackingDimensions): boolean {
  return dimensions.every((axis) => left[axis] === right[axis]);
}

function orientations(cargo: PackingCargo): PackingDimensions[] {
  const { length: a, width: b, height: c } = cargo.size;
  const permutations = cargo.allowRotation
    ? ([
        [a, b, c],
        [a, c, b],
        [b, a, c],
        [b, c, a],
        [c, a, b],
        [c, b, a]
      ] as const)
    : ([[a, b, c]] as const);
  const seen = new Set<string>();
  return permutations.flatMap(([length, width, height]) => {
    const key = `${length},${width},${height}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ length, width, height }];
  });
}

export function validatePackingInput(input: PackingInput): void {
  const value: unknown = input;
  if (
    !isRecord(value) ||
    !validDimensions(value.container) ||
    !Array.isArray(value.cargo) ||
    value.cargo.length < 1 ||
    value.cargo.length > 20
  ) {
    throw new Error('Invalid packing input');
  }
  const ids = new Set<string>();
  let total = 0;
  const rows: unknown[] = value.cargo;
  for (const cargo of rows) {
    if (
      !isRecord(cargo) ||
      typeof cargo.id !== 'string' ||
      !cargo.id.trim() ||
      cargo.id.length > 100 ||
      ids.has(cargo.id) ||
      typeof cargo.name !== 'string' ||
      !cargo.name.trim() ||
      cargo.name.length > 100 ||
      !validDimensions(cargo.size) ||
      typeof cargo.quantity !== 'number' ||
      !Number.isInteger(cargo.quantity) ||
      cargo.quantity < 1 ||
      cargo.quantity > 500 ||
      typeof cargo.allowRotation !== 'boolean'
    ) {
      throw new Error('Invalid packing input');
    }
    ids.add(cargo.id);
    total += cargo.quantity;
  }
  if (total > 500) throw new Error('Invalid packing input');
}

function assertResult(condition: unknown): asserts condition {
  if (!condition) throw new Error('Invalid packing result');
}

export function validatePackingResult(input: PackingInput, result: PackingResult): void {
  validatePackingInput(input);
  assertResult(isRecord(result) && Array.isArray(result.placements) && Array.isArray(result.unplaced));
  const cargoById = new Map(input.cargo.map((cargo) => [cargo.id, cargo]));
  const indices = new Map(input.cargo.map((cargo) => [cargo.id, new Set<number>()]));
  const missing = new Map<string, number>();
  let usedVolume = 0;
  for (const placement of result.placements) {
    assertResult(isRecord(placement) && validDimensions(placement.size));
    const cargo = cargoById.get(placement.cargoId);
    const seen = indices.get(placement.cargoId);
    assertResult(
      cargo &&
        seen &&
        Number.isInteger(placement.index) &&
        placement.index >= 0 &&
        placement.index < cargo.quantity &&
        !seen.has(placement.index)
    );
    assertResult(orientations(cargo).some((size) => sameSize(size, placement.size)));
    for (const [coordinate, axis] of [
      ['x', 'length'],
      ['y', 'width'],
      ['z', 'height']
    ] as const) {
      assertResult(
        Number.isInteger(placement[coordinate]) &&
          placement[coordinate] >= 0 &&
          placement[coordinate] + placement.size[axis] <= input.container[axis]
      );
    }
    seen.add(placement.index);
    usedVolume += volume(placement.size);
  }
  for (const [index, placement] of result.placements.entries()) {
    for (const other of result.placements.slice(index + 1)) {
      assertResult(
        placement.x + placement.size.length <= other.x ||
          other.x + other.size.length <= placement.x ||
          placement.y + placement.size.width <= other.y ||
          other.y + other.size.width <= placement.y ||
          placement.z + placement.size.height <= other.z ||
          other.z + other.size.height <= placement.z
      );
    }
    if (placement.z > 0) {
      const supportArea = result.placements.reduce((area, other) => {
        if (other.z + other.size.height !== placement.z) return area;
        return (
          area +
          Math.max(
            0,
            Math.min(placement.x + placement.size.length, other.x + other.size.length) -
              Math.max(placement.x, other.x)
          ) *
            Math.max(
              0,
              Math.min(placement.y + placement.size.width, other.y + other.size.width) -
                Math.max(placement.y, other.y)
            )
        );
      }, 0);
      assertResult(supportArea === placement.size.length * placement.size.width);
    }
  }
  for (const item of result.unplaced) {
    assertResult(item);
    const cargo = cargoById.get(item.cargoId);
    assertResult(cargo && !missing.has(item.cargoId) && Number.isInteger(item.count) && item.count > 0);
    const canFit = orientations(cargo).some((size) => fits(size, input.container));
    assertResult(item.reason === (canFit ? 'space' : 'dimensions'));
    missing.set(item.cargoId, item.count);
  }
  for (const cargo of input.cargo) {
    assertResult((indices.get(cargo.id)?.size ?? 0) + (missing.get(cargo.id) ?? 0) === cargo.quantity);
  }
  assertResult(
    result.totalCount === input.cargo.reduce((sum, cargo) => sum + cargo.quantity, 0) &&
      result.packedCount === result.placements.length &&
      result.containerVolume === volume(input.container) &&
      result.usedVolume === usedVolume &&
      Number.isSafeInteger(usedVolume) &&
      usedVolume <= result.containerVolume
  );
}

interface Space {
  x: number;
  y: number;
  z: number;
  size: PackingDimensions;
  order: number;
}

function compareScores(left: number[], right: number[]): number {
  for (const [index, value] of left.entries()) {
    const other = right[index];
    if (other !== undefined && value !== other) return value - other;
  }
  return 0;
}

export function packCargo(input: PackingInput): PackingResult {
  validatePackingInput(input);
  const result: PackingResult = {
    placements: [],
    unplaced: [],
    totalCount: input.cargo.reduce((sum, cargo) => sum + cargo.quantity, 0),
    packedCount: 0,
    containerVolume: volume(input.container),
    usedVolume: 0
  };
  const spaces: Space[] = [{ x: 0, y: 0, z: 0, size: { ...input.container }, order: 0 }];
  let nextSpaceOrder = 1;
  // shortcut: fixed disjoint splits can leave usable gaps, use a different solver if optimal packing is required.
  for (const cargo of [...input.cargo].sort((left, right) => volume(right.size) - volume(left.size))) {
    const allowed = orientations(cargo);
    if (!allowed.some((size) => fits(size, input.container))) {
      result.unplaced.push({ cargoId: cargo.id, count: cargo.quantity, reason: 'dimensions' });
      continue;
    }
    for (let index = 0; index < cargo.quantity; index++) {
      let best: { space: Space; spaceIndex: number; size: PackingDimensions; score: number[] } | undefined;
      for (const [spaceIndex, space] of spaces.entries()) {
        for (const [orientationOrder, size] of allowed.entries()) {
          if (!fits(size, space.size)) continue;
          const score = [
            space.z,
            volume(space.size) - volume(size),
            space.y,
            space.x,
            orientationOrder,
            space.order
          ];
          if (!best || compareScores(score, best.score) < 0) best = { space, spaceIndex, size, score };
        }
      }
      if (!best) {
        result.unplaced.push({ cargoId: cargo.id, count: cargo.quantity - index, reason: 'space' });
        break;
      }
      const { space, size } = best;
      result.placements.push({
        cargoId: cargo.id,
        index,
        x: space.x,
        y: space.y,
        z: space.z,
        size: { ...size }
      });
      result.usedVolume += volume(size);
      spaces.splice(best.spaceIndex, 1);
      const { length: a, width: b, height: c } = size;
      const { length, width, height } = space.size;
      const children = [
        { x: space.x + a, y: space.y, z: space.z, size: { length: length - a, width, height } },
        { x: space.x, y: space.y + b, z: space.z, size: { length: a, width: width - b, height } },
        { x: space.x, y: space.y, z: space.z + c, size: { length: a, width: b, height: height - c } }
      ];
      for (const child of children) {
        if (volume(child.size) > 0) spaces.push({ ...child, order: nextSpaceOrder++ });
      }
    }
  }
  result.packedCount = result.placements.length;
  validatePackingResult(input, result);
  return result;
}
