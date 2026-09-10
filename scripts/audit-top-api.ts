import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { atomicWriteJson } from './openapi-auth/storage';
import {
  collectCatalog,
  related,
  documentData,
  existingEntries,
  summarize,
  markdownTable
} from './lib/top-api-inventory';

// Public documentation only. No Alibaba gateway, login session or .env credentials.
const origin = 'https://open.taobao.com';
const output = resolve('artifacts/top-api-audit');
await mkdir(output, { recursive: true });
const generatedAtUtc = new Date().toISOString();
const offline = process.argv.includes('--offline');
const previousSummary: unknown = offline
  ? JSON.parse(await readFile(resolve(output, 'summary.json'), 'utf8'))
  : null;
const capturedAtUtc =
  isRecord(previousSummary) && typeof previousSummary.capturedAtUtc === 'string'
    ? previousSummary.capturedAtUtc
    : generatedAtUtc;
const cookies = new Map<string, string>();
const pageUrl = `${origin}/api.htm?docId=58734&docType=2`;
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function rememberCookies(headers: Headers): void {
  for (const value of headers.getSetCookie()) {
    const pair = value.split(';')[0] ?? '';
    const separator = pair.indexOf('=');
    if (separator > 0) cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
  }
}
// Start a normal, anonymous documentation session; do not reuse the user's cookies.
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
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  if (!response.body) throw new Error('Empty response');
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
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return value;
  } catch {
    throw new Error('Response is not JSON; stop without bypassing login or challenge');
  }
}

const sources = [
  {
    name: 'catalog',
    path: '/handler/document/getApiCatelogConfig.json',
    parameters: { scopeId: '', treeId: '', docId: '58734', docType: '2', tag: '' }
  },
  {
    name: 'document-58734',
    path: '/handler/document/getDocument.json',
    parameters: { isEn: 'false', treeId: '', docId: '58734', docType: '2' }
  }
];
const results: Record<string, unknown>[] = [];
for (const source of sources) {
  try {
    const response: unknown = offline
      ? JSON.parse(await readFile(resolve(output, `${source.name}.json`), 'utf8'))
      : await fetchDocument(source.path, source.parameters);
    if (!offline) await atomicWriteJson(resolve(output, `${source.name}.json`), response);
    const ok = isRecord(response) && response.success === true && isRecord(response.data);
    results.push({
      name: source.name,
      ok,
      code: isRecord(response) ? response.code : null,
      message: isRecord(response) ? response.msg : null,
      keys: response && typeof response === 'object' ? Object.keys(response) : []
    });
    if (!ok) process.exitCode = 1;
  } catch (error: unknown) {
    results.push({
      name: source.name,
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    process.exitCode = 1;
  }
}
if (!offline) await atomicWriteJson(resolve(output, 'summary.json'), { capturedAtUtc, results });
process.stdout.write(`${JSON.stringify({ output, results }, null, 2)}\n`);
if (!results.every((result) => result.ok))
  throw new Error('Seed requests failed; do not treat an expired page as a successful audit');
const catalog: unknown = JSON.parse(await readFile(resolve(output, 'catalog.json'), 'utf8'));
const all = collectCatalog(documentData(catalog));
const existing = existingEntries(
  JSON.parse(await readFile(resolve('docs/alibaba-api-audit.json'), 'utf8')) as unknown
);
const byMethod = new Map(existing.map((entry) => [entry.method, entry]));
const selected = all.filter((item) => related(item, new Set(byMethod.keys())));
const missing = existing.filter((entry) => !all.some((item) => item.method === entry.method));
// Include historical doc IDs absent from the current TOP catalog, without claiming they are listed there.
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
const rows: ReturnType<typeof summarize>[] = [];
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
    if (!offline) await atomicWriteJson(path, response);
    rows.push(summarize(item, documentData(response), byMethod.get(item.method)));
  } catch (error: unknown) {
    errors.push({
      method: item.method,
      docId: item.docId,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
  if (!offline) await new Promise((done) => setTimeout(done, 300));
  if ((index + 1) % 20 === 0) process.stdout.write(`Documents ${index + 1}/${selected.length}\n`);
}
rows.sort((a, b) => a.method.localeCompare(b.method));
const inventory = {
  capturedAtUtc,
  generatedAtUtc,
  offline,
  catalogCount: all.length,
  selectedCount: selected.length,
  existingCount: existing.length,
  missingFromCurrentCatalog: missing.map((entry) => entry.method),
  documentCount: rows.length,
  errors,
  rows
};
await atomicWriteJson(resolve(output, 'inventory.json'), inventory);
const report = `# TOP API 文档差异盘点\n\n采集时间：${capturedAtUtc}。目录 ${all.length} 项；相关候选 ${selected.length} 项；成功读取 ${rows.length} 项；失败 ${errors.length} 项。\n\n仅文档审计，无业务接口调用。candidate=免费候选，conditional-candidate=额外业务限制待核实，already-recorded=已有审计，fee-review=收费或标签未知，lifecycle-review=废弃/下线待核实，jushita-review=聚石塔限制待核实。目录缺失不等于下线；现有功能启用不等于当前账号有权限。\n\n## 新增候选\n\n${markdownTable(rows.filter((row) => !row.existing))}\n\n## 已有记录及变更核对\n\n${markdownTable(rows.filter((row) => row.existing))}\n\n## 无法读取\n\n${errors.map((entry) => `- ${entry.method} (${entry.docId}): ${entry.error}`).join('\n') || '无'}\n`;
await writeFile(resolve(output, 'inventory.md'), report, 'utf8');
process.stdout.write(
  `${JSON.stringify({ catalogCount: all.length, selected: selected.length, documents: rows.length, errors: errors.length })}\n`
);
if (errors.length) process.exitCode = 1;
