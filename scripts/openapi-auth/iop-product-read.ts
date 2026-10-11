/** Minimal read-only evidence. Never return product records or customer/account identifiers. */
export function summarizeIopProductRead(value: unknown): { itemCount: number; totalItems: number } | null {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('code' in value) ||
    (value.code !== 0 && value.code !== '0') ||
    !('result' in value)
  )
    return null;
  const result = value.result;
  if (
    typeof result !== 'object' ||
    result === null ||
    !('products' in result) ||
    !Array.isArray(result.products) ||
    !('total_item' in result)
  )
    return null;
  const total = result.total_item;
  if ((typeof total !== 'number' && typeof total !== 'string') || !/^[0-9]+$/u.test(String(total)))
    return null;
  const totalItems = Number(total);
  if (!Number.isSafeInteger(totalItems) || totalItems < result.products.length) return null;
  if (result.products.length === 0 && totalItems !== 0) return null;
  if (
    result.products.some((product: unknown) => {
      if (typeof product !== 'object' || product === null || !('id' in product)) return true;
      const id = product.id;
      return typeof id === 'string'
        ? !/^[1-9][0-9]*$/u.test(id)
        : typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0;
    })
  )
    return null;
  return { itemCount: result.products.length, totalItems };
}
