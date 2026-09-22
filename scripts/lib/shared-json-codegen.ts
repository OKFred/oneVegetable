/** Emit shared immutable JSON constants. Runs only while generating source, never in the browser. */
export function sharedJsonSource(value: unknown): { declarations: string; expression: string } {
  const counts = new Map<string, number>();
  const names = new Map<string, string>();
  const declarations: string[] = [];
  function count(node: unknown): void {
    if (node === undefined || typeof node === 'function' || typeof node === 'symbol')
      throw new Error('Registry must contain only JSON values');
    const json = JSON.stringify(node);
    if (json.length >= 64) counts.set(json, (counts.get(json) ?? 0) + 1);
    if (Array.isArray(node)) node.forEach(count);
    else if (node && typeof node === 'object') Object.values(node).forEach(count);
  }
  function emit(node: unknown): string {
    const json = JSON.stringify(node);
    const existing = names.get(json);
    if (existing) return existing;
    const expression = Array.isArray(node)
      ? `[${node.map(emit).join(',')}]`
      : node && typeof node === 'object'
        ? `{${Object.entries(node)
            .map(([key, child]) => `${JSON.stringify(key)}:${emit(child)}`)
            .join(',')}}`
        : json;
    if ((counts.get(json) ?? 0) < 2) return expression;
    const name = `shared${names.size}`;
    names.set(json, name);
    declarations.push(`const ${name} = ${expression} as const;`);
    return name;
  }
  count(value);
  const expression = emit(value);
  return { declarations: declarations.join('\n'), expression };
}
