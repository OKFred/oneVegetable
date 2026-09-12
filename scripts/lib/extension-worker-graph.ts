import { posix } from 'node:path';
import ts from 'typescript';

export async function inspectExtensionWorkerGraph(
  entry: string,
  read: (file: string) => Promise<string>
): Promise<{ files: string[]; errors: string[] }> {
  const files = new Set<string>();
  const errors: string[] = [];
  async function visit(file: string): Promise<void> {
    if (files.has(file)) return;
    files.add(file);
    let source: string;
    try {
      source = await read(file);
    } catch {
      errors.push(`${file}: missing static worker dependency`);
      return;
    }
    const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const dependencies = new Set<string>();
    function walk(node: ts.Node): void {
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword)
        errors.push(`${file}: dynamic import is unsupported in MV3 service workers`);
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)
      ) {
        const specifier = node.moduleSpecifier.text;
        const dependency = posix.normalize(posix.join(posix.dirname(file), specifier));
        if (
          (!specifier.startsWith('./') && !specifier.startsWith('../')) ||
          dependency.startsWith('../') ||
          specifier.includes('\\') ||
          !dependency.endsWith('.js')
        )
          errors.push(`${file}: worker import must resolve to a packaged JavaScript file`);
        else dependencies.add(dependency);
      }
      ts.forEachChild(node, walk);
    }
    walk(parsed);
    for (const dependency of dependencies) await visit(dependency);
  }
  await visit(entry);
  return { files: [...files], errors };
}
