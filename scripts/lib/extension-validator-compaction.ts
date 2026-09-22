import ts from 'typescript';

const errorKeys = ['instancePath', 'schemaPath', 'keyword', 'params', 'message'];

function errorValues(node: ts.Node): ts.Expression[] | undefined {
  if (!ts.isObjectLiteralExpression(node) || node.properties.length !== errorKeys.length) return;
  const values: ts.Expression[] = [];
  for (const [index, property] of node.properties.entries()) {
    if (
      ts.isPropertyAssignment(property) &&
      (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) &&
      property.name.text === errorKeys[index]
    ) {
      values.push(property.initializer);
    } else if (
      index === 0 &&
      ts.isShorthandPropertyAssignment(property) &&
      property.name.text === 'instancePath' &&
      !property.objectAssignmentInitializer
    ) {
      // AJV uses shorthand for root paths. Do not match our own all-shorthand helper.
      values.push(property.name);
    } else return;
  }
  return values;
}

function identifier(node: ts.Node | undefined, name: string): boolean {
  return !!node && ts.isIdentifier(node) && node.text === name;
}

function onlyExpression(node: ts.Statement | undefined): ts.Expression | undefined {
  if (!node || !ts.isBlock(node) || node.statements.length !== 1) return;
  const statement = node.statements[0];
  return statement && ts.isExpressionStatement(statement) ? statement.expression : undefined;
}

/** Build-time only: share error bookkeeping, never validation branches or mutable error objects. */
export function compactExtensionValidatorErrors(source: string): string {
  const file = ts.createSourceFile('validator.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let helper = '__extensionAjvError';
  while (source.includes(helper)) helper += '_';
  let appendHelper = '__extensionAjvAppendError';
  while (source.includes(appendHelper)) appendHelper += '_';
  const edits: { start: number; end: number; text: string }[] = [];
  const helpers = new Set<string>();
  const localArrays = new Map<ts.Node, boolean>();

  function hasLocalArray(node: ts.Node): boolean {
    let parent = node.parent;
    while (!ts.isSourceFile(parent) && !ts.isFunctionLike(parent)) parent = parent.parent;
    if (!ts.isFunctionDeclaration(parent) || !parent.body) return false;
    const cached = localArrays.get(parent);
    if (cached !== undefined) return cached;
    // The extra assignment on the non-null path is safe only for an unshadowed local let.
    const scope = { declarations: 0, local: false, dynamic: false };
    const body = parent.body;
    function inspect(child: ts.Node): void {
      if (
        (ts.isVariableDeclaration(child) ||
          ts.isParameter(child) ||
          ts.isBindingElement(child) ||
          ts.isFunctionDeclaration(child) ||
          ts.isClassDeclaration(child)) &&
        child.name &&
        identifier(child.name, 'vErrors')
      ) {
        scope.declarations++;
        if (
          ts.isVariableDeclaration(child) &&
          child.initializer?.kind === ts.SyntaxKind.NullKeyword &&
          ts.isVariableDeclarationList(child.parent) &&
          (child.parent.flags & ts.NodeFlags.Let) !== 0 &&
          child.parent.parent.parent === body
        )
          scope.local = true;
      }
      if (ts.isWithStatement(child) || (ts.isCallExpression(child) && identifier(child.expression, 'eval')))
        scope.dynamic = true;
      ts.forEachChild(child, inspect);
    }
    inspect(parent);
    const result = scope.local && scope.declarations === 1 && !scope.dynamic;
    localArrays.set(parent, result);
    return result;
  }

  function appendValues(node: ts.Node): ts.Expression[] | undefined {
    if (!ts.isBlock(node) || node.statements.length !== 3) return;
    const [declaration, branch, increment] = node.statements;
    if (
      !declaration ||
      !ts.isVariableStatement(declaration) ||
      (declaration.declarationList.flags & ts.NodeFlags.Const) === 0 ||
      declaration.declarationList.declarations.length !== 1 ||
      !branch ||
      !ts.isIfStatement(branch) ||
      !increment ||
      !ts.isExpressionStatement(increment) ||
      !ts.isPostfixUnaryExpression(increment.expression) ||
      increment.expression.operator !== ts.SyntaxKind.PlusPlusToken ||
      !identifier(increment.expression.operand, 'errors')
    )
      return;
    const entry = declaration.declarationList.declarations[0];
    if (!entry?.initializer || !ts.isIdentifier(entry.name)) return;
    const errorName = entry.name.text;
    const values = errorValues(entry.initializer);
    if (!values) return;
    const condition = branch.expression;
    const initial = onlyExpression(branch.thenStatement);
    const append = onlyExpression(branch.elseStatement);
    if (
      !ts.isBinaryExpression(condition) ||
      !identifier(condition.left, 'vErrors') ||
      condition.operatorToken.kind !== ts.SyntaxKind.EqualsEqualsEqualsToken ||
      condition.right.kind !== ts.SyntaxKind.NullKeyword ||
      !initial ||
      !ts.isBinaryExpression(initial) ||
      !identifier(initial.left, 'vErrors') ||
      initial.operatorToken.kind !== ts.SyntaxKind.EqualsToken ||
      !ts.isArrayLiteralExpression(initial.right) ||
      initial.right.elements.length !== 1 ||
      !identifier(initial.right.elements[0], errorName) ||
      !append ||
      !ts.isCallExpression(append) ||
      append.questionDotToken ||
      !ts.isPropertyAccessExpression(append.expression) ||
      append.expression.questionDotToken ||
      !identifier(append.expression.expression, 'vErrors') ||
      append.expression.name.text !== 'push' ||
      append.arguments.length !== 1 ||
      !identifier(append.arguments[0], errorName)
    )
      return;
    // Removing the temporary must not remove a binding captured/read by an initializer.
    let references = 0;
    function count(child: ts.Node): void {
      if (identifier(child, errorName)) references++;
      ts.forEachChild(child, count);
    }
    count(node);
    return references === 3 && hasLocalArray(node) ? values : undefined;
  }

  function argumentsText(values: ts.Expression[]): string {
    // Parentheses preserve comma expressions and left-to-right evaluation order.
    return values.map((value) => `(${value.getText(file)})`).join(',');
  }

  function visit(node: ts.Node): void {
    const append = appendValues(node);
    if (append) {
      helpers.add(appendHelper);
      edits.push({
        start: node.getStart(file),
        end: node.getEnd(),
        // Read the array AFTER all error fields, exactly as in the original block.
        // Keep errors++ at the call site: combinators separately reset/merge this counter.
        text: `{vErrors=${appendHelper}(${argumentsText(append)},vErrors);errors++;}`
      });
      return;
    }
    const values = errorValues(node);
    if (values) {
      helpers.add(helper);
      edits.push({
        start: node.getStart(file),
        end: node.getEnd(),
        text: `${helper}(${argumentsText(values)})`
      });
      return;
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
  if (helpers.has(helper))
    source += `\nfunction ${helper}(instancePath,schemaPath,keyword,params,message){return {instancePath,schemaPath,keyword,params,message};}\n`;
  if (helpers.has(appendHelper))
    source += `\nfunction ${appendHelper}(instancePath,schemaPath,keyword,params,message,vErrors){const error={instancePath,schemaPath,keyword,params,message};if(vErrors===null)return [error];vErrors.push(error);return vErrors;}\n`;
  return source;
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
