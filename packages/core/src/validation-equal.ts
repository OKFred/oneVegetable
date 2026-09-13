/** JSON equality used by generated enum loops; no runtime code generation or Node dependency. */
export function validationEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (typeof left === 'number' && typeof right === 'number' && Number.isNaN(left) && Number.isNaN(right))
    return true;
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    const items: unknown[] = left;
    return items.every((value, index) => validationEqual(value, right[index]));
  }
  const a = left as Record<string, unknown>,
    b = right as Record<string, unknown>,
    keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => Object.hasOwn(b, key) && validationEqual(a[key], b[key]))
  );
}
