import { readdir, readFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';

import { enUS } from '../packages/ui/src/i18n/messages/en-US/index';
import { zhCN } from '../packages/ui/src/i18n/messages/zh-CN/index';

interface TranslationLeaf {
  kind: 'boolean' | 'null' | 'number' | 'string';
  value: string;
}

const root = resolve(import.meta.dirname, '..');
const uiSourceRoots = [
  'packages/ui/src',
  'apps/web/src',
  'apps/extension/entrypoints/options',
  'apps/extension/entrypoints/popup'
] as const;
const sourceExtensions = new Set(['.html', '.ts', '.tsx', '.vue']);
const hardcodedHanAllowlist: Readonly<Record<string, readonly RegExp[]>> = {
  'packages/ui/src/components/ProductSchemaField.vue': [/keyword\|关键词/u],
  'packages/ui/src/views/LogisticsView.vue': [
    /\b(?:cargoNameCn|cargoMaterial|addressSearchText|consignorPerson|consignorAddress|consigneePerson)\b/u,
    /purpose:\s*'商品销售'/u
  ]
};

const errors = [...compareCatalogs(zhCN, enUS), ...(await findHardcodedInterfaceText())];

if (errors.length > 0) {
  throw new Error(`i18n checks failed:\n${errors.map((error) => `- ${error}`).join('\n')}`);
}

console.log('i18n catalogs match and interface sources contain no unregistered Chinese copy.');

function compareCatalogs(left: unknown, right: unknown): string[] {
  const leftLeaves = flattenCatalog(left);
  const rightLeaves = flattenCatalog(right);
  const issues: string[] = [];
  const leftKeys = [...leftLeaves.keys()].toSorted();
  const rightKeys = [...rightLeaves.keys()].toSorted();

  for (const key of leftKeys.filter((key) => !rightLeaves.has(key))) {
    issues.push(`English catalog is missing ${key}`);
  }
  for (const key of rightKeys.filter((key) => !leftLeaves.has(key))) {
    issues.push(`Chinese catalog is missing ${key}`);
  }

  for (const key of leftKeys.filter((key) => rightLeaves.has(key))) {
    const leftLeaf = leftLeaves.get(key);
    const rightLeaf = rightLeaves.get(key);
    if (!leftLeaf || !rightLeaf) continue;
    if (leftLeaf.kind !== rightLeaf.kind) {
      issues.push(`Catalog value type differs at ${key}: ${leftLeaf.kind} versus ${rightLeaf.kind}`);
      continue;
    }
    if (leftLeaf.kind !== 'string') continue;
    if (leftLeaf.value.trim() === '') issues.push(`Chinese translation is empty at ${key}`);
    if (rightLeaf.value.trim() === '') issues.push(`English translation is empty at ${key}`);
    const leftPlaceholders = placeholders(leftLeaf.value);
    const rightPlaceholders = placeholders(rightLeaf.value);
    if (leftPlaceholders.join('\u0000') !== rightPlaceholders.join('\u0000')) {
      issues.push(
        `Interpolation parameters differ at ${key}: {${leftPlaceholders.join(', ')}} versus {${rightPlaceholders.join(', ')}}`
      );
    }
  }

  return issues;
}

function flattenCatalog(value: unknown): Map<string, TranslationLeaf> {
  const leaves = new Map<string, TranslationLeaf>();
  visitCatalog(value, '', leaves);
  return leaves;
}

function visitCatalog(value: unknown, path: string, leaves: Map<string, TranslationLeaf>): void {
  if (value === null) {
    leaves.set(path, { kind: 'null', value: 'null' });
    return;
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    leaves.set(path, { kind: typeof value, value: String(value) });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      visitCatalog(item, joinPath(path, String(index)), leaves);
    });
    return;
  }
  if (typeof value === 'object') {
    for (const [key, child] of Object.entries(value).toSorted(([left], [right]) =>
      left.localeCompare(right)
    )) {
      visitCatalog(child, joinPath(path, key), leaves);
    }
    return;
  }
  throw new Error(`Unsupported i18n catalog value at ${path || '<root>'}`);
}

function joinPath(parent: string, child: string): string {
  return parent === '' ? child : `${parent}.${child}`;
}

function placeholders(value: string): string[] {
  return [...value.matchAll(/\{([A-Za-z][A-Za-z0-9_.-]*)\}/gu)]
    .map((match) => match[1] ?? '')
    .filter(Boolean)
    .toSorted();
}

async function findHardcodedInterfaceText(): Promise<string[]> {
  const issues: string[] = [];
  for (const sourceRoot of uiSourceRoots) {
    const files = await listSourceFiles(resolve(root, sourceRoot));
    for (const file of files) {
      const relativePath = normalizePath(relative(root, file));
      if (relativePath.includes('/i18n/messages/')) continue;
      if (/\.(?:spec|test)\./u.test(relativePath)) continue;
      const source = stripComments(await readFile(file, 'utf8'));
      source.split(/\r?\n/u).forEach((line, index) => {
        if (!/[\p{Script=Han}]/u.test(line)) return;
        const allowed = hardcodedHanAllowlist[relativePath]?.some((pattern) => pattern.test(line)) ?? false;
        if (!allowed) issues.push(`Hardcoded Chinese interface copy at ${relativePath}:${index + 1}`);
      });
    }
  }
  return issues;
}

async function listSourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) return listSourceFiles(path);
      const extension = entry.name.slice(entry.name.lastIndexOf('.'));
      return sourceExtensions.has(extension) ? [path] : [];
    })
  );
  return nested.flat();
}

function stripComments(source: string): string {
  return source
    .replace(/<!--[\s\S]*?-->/gu, '')
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .replace(/^\s*\/\/.*$/gmu, '');
}

function normalizePath(value: string): string {
  return value.replaceAll('\\', '/');
}
