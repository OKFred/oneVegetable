import { describe, expect, it } from 'vitest';
import { inspectExtensionWorkerGraph } from './extension-worker-graph';

function inspect(modules: Record<string, string>) {
  return inspectExtensionWorkerGraph('background.js', (file) => {
    const source = modules[file];
    return source === undefined ? Promise.reject(new Error('missing')) : Promise.resolve(source);
  });
}

describe('formal MV3 static dependency graph', () => {
  it('follows static imports and reexports with cycles, ignoring strings and comments', async () => {
    const result = await inspect({
      'background.js': 'import "./chunks/a.js"; // import("ignored")',
      'chunks/a.js': 'export * from "./b.js"; const description = "import(ignored)";',
      'chunks/b.js': 'import "../background.js";'
    });
    expect(result.errors).toEqual([]);
    expect(result.files).toHaveLength(3);
  });
  it('rejects a dynamic import hidden in a nested shared chunk', async () => {
    const result = await inspect({
      'background.js': 'import "./chunks/a.js";',
      'chunks/a.js': 'export function validate() { return import("./validator.js"); }'
    });
    expect(result.errors).toEqual(['chunks/a.js: dynamic import is unsupported in MV3 service workers']);
  });
  it('rejects remote, escaping, bare and missing dependencies', async () => {
    const result = await inspect({
      'background.js':
        'import "https://example.com/script.js"; import "../outside.js"; import "ajv"; import "./missing.js";'
    });
    expect(result.errors).toHaveLength(4);
  });
});
