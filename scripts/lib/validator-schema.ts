// Documentation stays in OpenAPI and the capability catalogue. Standalone
// validators only need assertions; strip annotations at schema nodes, never at
// property maps or arbitrary values such as const/default/examples.
export function validationSchema(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return value;
  const result: Record<string, unknown> = {};
  const maps = new Set(['properties', 'patternProperties', '$defs', 'definitions', 'dependentSchemas']);
  const arrays = new Set(['allOf', 'anyOf', 'oneOf', 'prefixItems']);
  const children = new Set([
    'items',
    'additionalItems',
    'additionalProperties',
    'unevaluatedProperties',
    'unevaluatedItems',
    'contains',
    'propertyNames',
    'not',
    'if',
    'then',
    'else'
  ]);
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (['title', 'description', 'examples', '$comment'].includes(key)) continue;
    if (maps.has(key) && typeof child === 'object' && child !== null && !Array.isArray(child)) {
      result[key] = Object.fromEntries(
        Object.entries(child).map(([name, schema]) => [name, validationSchema(schema)])
      );
    } else if (arrays.has(key) && Array.isArray(child)) {
      result[key] = child.map(validationSchema);
    } else result[key] = children.has(key) ? validationSchema(child) : child;
  }
  return result;
}
