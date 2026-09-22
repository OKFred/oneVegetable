import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { atomicWriteJson } from './openapi-auth/storage';
import { parseScope, normalizeDefinition } from './snapshot-free-api-docs';
import {
  collectCatalog,
  related,
  documentData,
  existingEntries,
  summarize,
  markdownTable,
  record
} from './lib/top-api-inventory';

const root = resolve(import.meta.dirname, '..');
const origin = 'https://open.taobao.com';

export function auditOptions(args: string[]) {
  let seedDocId = 58734;
  let output = resolve(root, 'artifacts/top-api-audit');
  let scope: string | null = null;
  let offline = false;
  const seen = new Set<string>();
  for (const arg of args) {
    const key = arg.split('=')[0] ?? '';
    if (seen.has(key)) throw new Error(`Duplicate option: ${key}`);
    seen.add(key);
    if (arg === '--offline') offline = true;
    else if (/^--seed-doc-id=[1-9]\d*$/.test(arg)) seedDocId = Number(arg.slice(14));
    else if (arg.startsWith('--output=') && arg.slice(9)) output = resolve(root, arg.slice(9));
    else if (arg.startsWith('--scope=') && arg.slice(8)) scope = resolve(root, arg.slice(8));
    else throw new Error(`Unknown or invalid option: ${key}`);
  }
  if (!Number.isSafeInteger(seedDocId)) throw new Error('Invalid seed docId');
  return { seedDocId, output, scope, offline };
}

// Allowlist public documentation only: exclude generated SDK credentials, account
// envelopes, environment settings, HTTP headers and session data.
const documentFields = [
  'name',
  'docId',
  'id',
  'apiChineseName',
  'description',
  'gmtModified',
  'labels',
  'applyScopes',
  'requestParams',
  'responseParams',
  'errorCodes',
  'requestExample',
  'responseExample',
  'reqSampleJson',
  'reqSampleSimplifyJson',
  'rspSampleJson',
  'rspSampleSimplifyJson',
  'rspSampleXml',
  'apiErrDemoJson',
  'apiErrDemoXml'
] as const;

export function publicDocument(data: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(documentFields.filter((key) => key in data).map((key) => [key, data[key]]));
}

export function documentHash(data: Record<string, unknown>): string {
  return createHash('sha256')
    .update(JSON.stringify(publicDocument(data)))
    .digest('hex');
}

export async function runAudit(args: string[]) {
  const { seedDocId, output, scope: scopePath, offline } = auditOptions(args);
  const scoped = scopePath
    ? { scope: parseScope(JSON.parse(await readFile(scopePath, 'utf8')) as unknown), normalizeDefinition }
    : null;
  await mkdir(output, { recursive: true });
  const previous: unknown = offline
    ? JSON.parse(await readFile(resolve(output, 'summary.json'), 'utf8'))
    : null;
  if (offline && (!record(previous) || typeof previous.capturedAtUtc !== 'string'))
    throw new Error('Offline audit requires the original capture timestamp');
  if (record(previous) && previous.seedDocId !== undefined && previous.seedDocId !== seedDocId)
    throw new Error('Offline seed docId does not match capture');
  const capturedAtUtc = record(previous) ? String(previous.capturedAtUtc) : new Date().toISOString();
  if (!Number.isFinite(Date.parse(capturedAtUtc))) throw new Error('Invalid capture timestamp');
  const cookies = new Map<string, string>();
  const pageUrl = `${origin}/api.htm?docId=${seedDocId}&docType=2`;
  function rememberCookies(headers: Headers): void {
    for (const value of headers.getSetCookie()) {
      const pair = value.split(';')[0] ?? '';
      const separator = pair.indexOf('=');
      if (separator > 0) cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
    }
  }
  // Normal anonymous TOP session. Never read .env, browser cookies or account profiles.
  if (!offline) {
    const page = await fetch(pageUrl, { redirect: 'error', signal: AbortSignal.timeout(30_000) });
    rememberCookies(page.headers);
    await page.body?.cancel();
    if (!page.ok) throw new Error(`Documentation session initialization HTTP ${page.status}`);
  }
  async function fetchDocument(path: string, parameters: Record<string, string>): Promise<unknown> {
    const url = new URL(path, origin);
    for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value);
    const token = cookies.get('_tb_token_');
    if (token) url.searchParams.set('_tb_token_', token);
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        Referer: pageUrl,
        Cookie: [...cookies].map(([name, value]) => `${name}=${value}`).join('; ')
      },
      redirect: 'error',
      signal: AbortSignal.timeout(30_000)
    });
    rememberCookies(response.headers);
    if (!response.ok) throw new Error(`Documentation HTTP ${response.status}`);
    if (!response.body) throw new Error('Empty documentation response');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    let part = await reader.read();
    while (!part.done) {
      size += part.value.byteLength;
      if (size > 16 * 1024 * 1024) {
        await reader.cancel();
        throw new Error('Documentation exceeds 16 MiB');
      }
      chunks.push(part.value);
      part = await reader.read();
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    } catch {
      throw new Error('Response is not JSON; stop without bypassing login or challenge');
    }
  }
  function assertNoCookies(value: unknown): void {
    const text = JSON.stringify(value);
    if (text.includes('_tb_token_') || [...cookies.values()].some((v) => v.length > 6 && text.includes(v)))
      throw new Error('Public document unexpectedly contains session data; not persisted');
  }
  const sources = [
    {
      name: 'catalog',
      path: '/handler/document/getApiCatelogConfig.json',
      parameters: { scopeId: '', treeId: '', docId: String(seedDocId), docType: '2', tag: '' }
    },
    {
      name: `document-${seedDocId}`,
      path: '/handler/document/getDocument.json',
      parameters: { isEn: 'false', treeId: '', docId: String(seedDocId), docType: '2' }
    }
  ];
  const results: { name: string; ok: boolean; error?: string }[] = [];
  const seedBodies = new Map<string, Record<string, unknown>>();
  for (const source of sources) {
    try {
      const response: unknown = offline
        ? JSON.parse(await readFile(resolve(output, `${source.name}.json`), 'utf8'))
        : await fetchDocument(source.path, source.parameters);
      const data = documentData(response);
      const safe =
        source.name === 'catalog'
          ? {
              items: collectCatalog(data).map((item) => ({
                docId: item.docId,
                docType: 2,
                name: item.method,
                subName: item.title,
                categories: item.categories.map((treeName) => ({
                  treeName,
                  docs: [{ docId: item.docId, docType: 2, name: item.method, subName: item.title }]
                }))
              }))
            }
          : publicDocument(data);
      assertNoCookies(safe);
      seedBodies.set(source.name, safe);
      if (!offline)
        await atomicWriteJson(resolve(output, `${source.name}.json`), { success: true, data: safe });
      results.push({ name: source.name, ok: true });
    } catch (error: unknown) {
      results.push({
        name: source.name,
        ok: false,
        error: error instanceof Error ? error.message : 'Unknown documentation failure'
      });
    }
  }
  if (!offline) await atomicWriteJson(resolve(output, 'summary.json'), { capturedAtUtc, seedDocId, results });
  if (!results.every((result) => result.ok))
    throw new Error(
      `Seed requests failed: ${results
        .filter((r) => !r.ok)
        .map((r) => r.error)
        .join('; ')}`
    );
  const all = collectCatalog(seedBodies.get('catalog'));
  const existing = existingEntries(
    JSON.parse(await readFile(resolve(root, 'docs/alibaba-api-audit.json'), 'utf8')) as unknown
  );
  const byMethod = new Map(existing.map((entry) => [entry.method, entry]));
  const missing = existing.filter((entry) => !all.some((item) => item.method === entry.method));
  const selected = scoped
    ? scoped.scope.entries.map((entry) => {
        const item = all.find((candidate) => candidate.docId === entry.docId);
        if (item?.method !== entry.method)
          throw new Error(`Scoped catalog identity mismatch: ${entry.docId}`);
        return item;
      })
    : all.filter((item) => related(item, new Set(byMethod.keys())));
  if (!scoped)
    for (const entry of missing) {
      const url = new URL(entry.docUrl);
      const id = Number(url.searchParams.get('docId') ?? url.searchParams.get('apiId'));
      if (id > 0)
        selected.push({
          method: entry.method,
          docId: id,
          title: '',
          categories: ['historical-ICBU-unlisted-in-TOP']
        });
    }
  await atomicWriteJson(resolve(output, 'catalog-flat.json'), all);
  const rows: (ReturnType<typeof summarize> & { checkedAt: string; sourceSha256: string })[] = [];
  const errors: { method: string; docId: number; error: string }[] = [];
  await mkdir(resolve(output, 'documents'), { recursive: true });
  for (const [index, item] of selected.entries()) {
    const path = resolve(output, 'documents', `${item.docId}.json`);
    try {
      const response: unknown = offline
        ? JSON.parse(await readFile(path, 'utf8'))
        : await fetchDocument('/handler/document/getDocument.json', {
            isEn: 'false',
            treeId: '',
            docType: '2',
            docId: String(item.docId)
          });
      const data = publicDocument(documentData(response));
      assertNoCookies(data);
      const row = summarize(item, data, byMethod.get(item.method));
      const entry = scoped?.scope.entries.find((e) => e.docId === item.docId);
      if (scoped && entry) scoped.normalizeDefinition(entry, data, capturedAtUtc.slice(0, 10), scoped.scope);
      if (!offline) await atomicWriteJson(path, { success: true, data });
      rows.push({ ...row, checkedAt: capturedAtUtc.slice(0, 10), sourceSha256: documentHash(data) });
    } catch (error: unknown) {
      errors.push({
        method: item.method,
        docId: item.docId,
        error: error instanceof Error ? error.message : 'Unknown documentation failure'
      });
    }
    if (!offline) await new Promise((done) => setTimeout(done, 300));
    if ((index + 1) % 10 === 0) process.stdout.write(`Documents ${index + 1}/${selected.length}\n`);
  }
  rows.sort((a, b) => a.method.localeCompare(b.method));
  const inventory = {
    capturedAtUtc,
    generatedAtUtc: offline ? capturedAtUtc : new Date().toISOString(),
    offline,
    seedDocId,
    scopeDocIds: scoped?.scope.entries.map((e) => e.docId) ?? null,
    catalogCount: all.length,
    selectedCount: selected.length,
    existingCount: existing.length,
    missingFromCurrentCatalog: missing.map((entry) => entry.method),
    documentCount: rows.length,
    errors,
    rows
  };
  await atomicWriteJson(resolve(output, 'inventory.json'), inventory);
  const report = `# TOP API 文档差异盘点\n\n采集时间：${capturedAtUtc}。目录 ${all.length} 项；候选 ${selected.length} 项；成功 ${rows.length} 项；失败 ${errors.length} 项。\n\n仅公开文档审计，无业务接口调用。免费不等于有授权；conditional 表示需业务资格，不代表账号验证通过。\n\n${markdownTable(rows)}\n\n## 无法读取\n\n${errors.map((e) => `- ${e.method} (${e.docId}): ${e.error}`).join('\n') || '无'}\n`;
  await writeFile(resolve(output, 'inventory.md'), report, 'utf8');
  process.stdout.write(
    `${JSON.stringify({ output, selected: selected.length, documents: rows.length, errors: errors.length })}\n`
  );
  if (errors.length)
    throw new Error(`${errors.length} documents failed; snapshot must not consume partial capture`);
  return inventory;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await runAudit(process.argv.slice(2));
}
