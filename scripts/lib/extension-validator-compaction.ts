import ts from 'typescript';

const errorKeys = ['instancePath', 'schemaPath', 'keyword', 'params', 'message'];

/** Build-time only: share error construction, never validation branches or mutable error objects. */
export function compactExtensionValidatorErrors(source: string): string {
  const file = ts.createSourceFile('validator.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let helper = '__extensionAjvError';
  while (source.includes(helper)) helper += '_';
  const edits: { start: number; end: number; text: string }[] = [];

  function visit(node: ts.Node): void {
    if (ts.isObjectLiteralExpression(node) && node.properties.length === errorKeys.length) {
      const properties = node.properties.filter(ts.isPropertyAssignment);
      if (
        properties.length === errorKeys.length &&
        properties.every(
          (property, index) =>
            (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) &&
            property.name.text === errorKeys[index]
        )
      ) {
        edits.push({
          start: node.getStart(file),
          end: node.getEnd(),
          // Parentheses preserve comma expressions and the original left-to-right evaluation order.
          text: `${helper}(${properties.map((property) => `(${property.initializer.getText(file)})`).join(',')})`
        });
        return;
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  // Small or unfamiliar modules are left alone, including all nonstandard AJV error shapes.
  if (edits.length < 5) return source;
  for (const edit of edits.toSorted((left, right) => right.start - left.start)) {
    source = source.slice(0, edit.start) + edit.text + source.slice(edit.end);
  }
  // Append a hoisted function so existing directives, imports and annotations remain in place.
  return `${source}\nfunction ${helper}(instancePath,schemaPath,keyword,params,message){return {instancePath,schemaPath,keyword,params,message};}\n`;
}

/** Extension builds only; the generator, its checked-in outputs and other runtimes stay untouched. */
export function extensionValidatorCompactionPlugin() {
  return {
    name: 'one-vegetable-extension-validator-compaction',
    apply: 'build' as const,
    enforce: 'pre' as const,
    transform(source: string, id: string) {
      const path = id.replaceAll('\\', '/').split('?')[0] ?? '';
      if (!/\/packages\/core\/src\/generated\/validators-[^/]+\.ts$/u.test(path)) return null;
      const code = compactExtensionValidatorErrors(source);
      return code === source ? null : { code, map: null };
    }
  };
}
