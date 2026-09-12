import ts from 'typescript';

/** AJV embeds whole schemas when code only reads e.g. `schema.required`.
 * Retain precisely those constant branches. Validation functions and errors
 * are untouched; dynamic/root reads conservatively preserve the full value.
 * Build-time AST + JSON parsing only: never evaluate generated code.
 */
export function compactStandaloneSchemaConstants(source: string): string {
  const file = ts.createSourceFile('standalone.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const declarations = new Map<string, ts.Expression>();
  const uses = new Map<string, string[][]>();
  const visitDeclarations = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      /^schema\d+$/.test(node.name.text) &&
      node.initializer &&
      ts.isObjectLiteralExpression(node.initializer)
    ) {
      declarations.set(node.name.text, node.initializer);
      uses.set(node.name.text, []);
    }
    ts.forEachChild(node, visitDeclarations);
  };
  visitDeclarations(file);
  const visitUses = (node: ts.Node): void => {
    if (
      ts.isIdentifier(node) &&
      declarations.has(node.text) &&
      !(ts.isVariableDeclaration(node.parent) && node.parent.name === node) &&
      !(ts.isPropertyAccessExpression(node.parent) && node.parent.name === node) &&
      !(ts.isPropertyAssignment(node.parent) && node.parent.name === node)
    ) {
      const path: string[] = [];
      let current: ts.Node = node;
      for (;;) {
        const parent = current.parent;
        if (ts.isPropertyAccessExpression(parent) && parent.expression === current) {
          path.push(parent.name.text);
          current = parent;
        } else if (
          ts.isElementAccessExpression(parent) &&
          parent.expression === current &&
          (ts.isStringLiteral(parent.argumentExpression) || ts.isNumericLiteral(parent.argumentExpression))
        ) {
          path.push(parent.argumentExpression.text);
          current = parent;
        } else break;
      }
      uses.get(node.text)?.push(path);
    }
    ts.forEachChild(node, visitUses);
  };
  visitUses(file);
  const edits: { start: number; end: number; text: string }[] = [];
  for (const [name, expression] of declarations) {
    const paths = uses.get(name) ?? [];
    if (!paths.length || paths.some((path) => !path.length)) continue;
    try {
      const value: unknown = JSON.parse(expression.getText(file));
      const text = JSON.stringify(prune(value, paths));
      if (text && text.length < expression.getWidth(file))
        edits.push({ start: expression.getStart(file), end: expression.getEnd(), text });
    } catch {
      /* Non-JSON constants remain unchanged. */
    }
  }
  for (const edit of edits.toSorted((a, b) => b.start - a.start))
    source = source.slice(0, edit.start) + edit.text + source.slice(edit.end);
  return shareErrorMessages(source);
}

/** Reuse repeated immutable error text. No validation branches or error details are removed. */
function shareErrorMessages(source: string): string {
  const file = ts.createSourceFile('standalone.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const messages = new Map<string, ts.StringLiteral[]>();
  function visit(node: ts.Node): void {
    if (
      ts.isPropertyAssignment(node) &&
      (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) &&
      node.name.text === 'message' &&
      ts.isStringLiteral(node.initializer) &&
      node.initializer.text.length >= 20
    ) {
      const uses = messages.get(node.initializer.text) ?? [];
      uses.push(node.initializer);
      messages.set(node.initializer.text, uses);
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  const edits: { start: number; end: number; text: string }[] = [];
  const declarations: string[] = [];
  for (const [message, nodes] of messages) {
    if (nodes.length < 3) continue;
    const name = `sharedValidationMessage${declarations.length}`;
    if (source.includes(name)) continue;
    declarations.push(`const ${name} = ${JSON.stringify(message)};`);
    for (const node of nodes) edits.push({ start: node.getStart(file), end: node.getEnd(), text: name });
  }
  for (const edit of edits.toSorted((a, b) => b.start - a.start))
    source = source.slice(0, edit.start) + edit.text + source.slice(edit.end);
  return declarations.length ? `${declarations.join('\n')}\n${source}` : source;
}

function prune(value: unknown, paths: string[][]): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value) || paths.some((path) => !path.length))
    return value;
  const object = value as Record<string, unknown>;
  const keys = [...new Set(paths.map((path) => path[0]).filter((key) => key !== undefined))];
  if (keys.some((key) => !Object.hasOwn(object, key))) return value;
  return Object.fromEntries(
    keys.map((key) => [
      key,
      prune(
        object[key],
        paths.filter((path) => path[0] === key).map((path) => path.slice(1))
      )
    ])
  );
}
