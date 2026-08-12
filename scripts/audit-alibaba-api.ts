import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

interface CatalogResponse {
  data: unknown;
}

interface DocumentLabel {
  displayName?: string;
}

interface DocumentData {
  gmtModified?: number;
  labels?: DocumentLabel[];
  name?: string;
}

interface DocumentResponse {
  data: DocumentData;
}

interface AuditEntry {
  method: string;
  domain: string;
  chargeLabel: string;
  auth: 'required' | 'optional' | 'none' | 'unknown';
  jushitaOnly: boolean;
  restricted: boolean;
  restrictionReason: string | null;
  enabled: boolean;
  docUrl: string;
  checkedAt: string;
  updatedAt: string | null;
  source: 'catalog' | 'article';
  lifecycle: 'active' | 'deprecated' | 'unlisted';
  risk: 'read' | 'mutation';
  verification: 'documented' | 'account-verified';
  realCallEnabled: boolean;
  requestSchema: string | null;
  responseSchema: string | null;
}

interface ProductOverride {
  lifecycle?: AuditEntry['lifecycle'];
  risk?: AuditEntry['risk'];
}

const CATALOG_URL = 'https://developer.alibaba.com/handler/document/getCatelogConfig.json?docId=118496';
const DOCUMENT_URL = 'https://developer.alibaba.com/handler/document/getDocument.json?docType=2&docId=';
const FREE_LABELS = new Set(['￥免费', '￥开放平台免费API']);
const ENABLED_METHODS = new Set([
  'alibaba.icbu.category.attribute.get',
  'alibaba.icbu.category.get.new',
  'alibaba.icbu.photobank.group.list',
  'alibaba.icbu.photobank.group.operate',
  'alibaba.icbu.photobank.list',
  'alibaba.icbu.photobank.upload',
  'alibaba.icbu.product.batch.update.display',
  'alibaba.icbu.product.get',
  'alibaba.icbu.product.group.add',
  'alibaba.icbu.product.group.get',
  'alibaba.icbu.product.id.decrypt',
  'alibaba.icbu.product.id.encrypt',
  'alibaba.icbu.product.list',
  'alibaba.icbu.product.schema.get',
  'alibaba.icbu.product.schema.render',
  'alibaba.icbu.product.schema.update',
  'alibaba.icbu.product.score.get',
  'alibaba.seller.order.fund.get',
  'alibaba.seller.order.list',
  'alibaba.seller.order.logistics.get'
]);

const root = resolve(import.meta.dirname, '..');
const productOverrides = JSON.parse(
  await readFile(resolve(root, 'config/alibaba-product-overrides.json'), 'utf8')
) as Record<string, ProductOverride>;
const checkedAt = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
}).format(new Date());

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asCatalogResponse(value: unknown): CatalogResponse {
  if (!isRecord(value) || !('data' in value)) throw new Error('Unexpected catalog response');
  return { data: value.data };
}

function collectDocuments(value: unknown, result = new Map<string, number>()): Map<string, number> {
  if (Array.isArray(value)) {
    for (const child of value) collectDocuments(child, result);
    return result;
  }
  if (!isRecord(value)) return result;
  if (value.docType === 2 && typeof value.docId === 'number' && typeof value.name === 'string') {
    result.set(value.name, value.docId);
  }
  for (const child of Object.values(value)) collectDocuments(child, result);
  return result;
}

function asDocumentResponse(value: unknown): DocumentResponse {
  if (!isRecord(value) || !isRecord(value.data)) throw new Error('Unexpected document response');
  const labels = Array.isArray(value.data.labels)
    ? value.data.labels.filter(isRecord).map((label) => ({
        ...(typeof label.displayName === 'string' ? { displayName: label.displayName } : {})
      }))
    : [];
  return {
    data: {
      ...(typeof value.data.name === 'string' ? { name: value.data.name } : {}),
      ...(typeof value.data.gmtModified === 'number' ? { gmtModified: value.data.gmtModified } : {}),
      labels
    }
  };
}

function resolveDomain(method: string): string {
  if (/photobank|photo/.test(method)) return 'photo';
  if (/rfq|quotation/.test(method)) return 'rfq';
  if (/logistics|shipping|onetouch/.test(method)) return 'logistics';
  if (/product|category/.test(method)) return 'product';
  if (/procurement|buyer/.test(method)) return 'buyer';
  if (/order|trade|seller\.address/.test(method)) return 'trade';
  if (/mydata|diagnostic/.test(method)) return 'data';
  return 'other';
}

function resolveAuth(labels: string[]): AuditEntry['auth'] {
  if (labels.some((label) => /必须用户授权|需要授权/.test(label))) return 'required';
  if (labels.some((label) => /不需用户授权|不需要授权/.test(label))) return 'none';
  if (labels.some((label) => label.includes('可选授权'))) return 'optional';
  return 'unknown';
}

function isRestricted(method: string): boolean {
  return /\.(snsoft|xiaoman|wetrade)\./.test(method) || method.includes('ecology.write');
}

function resolveRisk(method: string): AuditEntry['risk'] {
  const explicit = productOverrides[method]?.risk;
  if (explicit) return explicit;
  return /\.(add|create|delete|modify|operate|post|save|update|upload)(\.|$)/.test(method)
    ? 'mutation'
    : 'read';
}

function capabilitySchemaName(method: string): string {
  return method
    .split('.')
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join('');
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  return response.json() as Promise<unknown>;
}

async function fetchInBatches<T, R>(
  values: T[],
  batchSize: number,
  task: (value: T) => Promise<R>
): Promise<R[]> {
  const result: R[] = [];
  for (let index = 0; index < values.length; index += batchSize) {
    result.push(...(await Promise.all(values.slice(index, index + batchSize).map(task))));
  }
  return result;
}

const catalog = asCatalogResponse(await fetchJson(CATALOG_URL));
const documents = [...collectDocuments(catalog.data).entries()];
const audited = await fetchInBatches(documents, 12, async ([catalogMethod, docId]) => {
  const document = asDocumentResponse(await fetchJson(`${DOCUMENT_URL}${docId}`)).data;
  const method = document.name ?? catalogMethod;
  const labels = (document.labels ?? []).flatMap((label) =>
    label.displayName === undefined ? [] : [label.displayName]
  );
  if (!labels.some((label) => FREE_LABELS.has(label))) return null;
  const jushitaOnly = labels.some((label) => label.includes('聚石塔内调用'));
  if (jushitaOnly) return null;
  const restricted = isRestricted(method);
  const domain = resolveDomain(method);
  const risk = resolveRisk(method);
  const enabled = !restricted && (ENABLED_METHODS.has(method) || domain === 'product');
  const schemaName = domain === 'product' ? capabilitySchemaName(method) : null;
  return {
    method,
    domain,
    chargeLabel: labels.find((label) => FREE_LABELS.has(label)) ?? '￥免费',
    auth: resolveAuth(labels),
    jushitaOnly,
    restricted,
    restrictionReason: restricted ? '特定 ISV、业务资格或额外权限，默认关闭' : null,
    enabled,
    docUrl: `https://developer.alibaba.com/docs/api.htm?apiId=${docId}`,
    checkedAt,
    updatedAt: document.gmtModified ? new Date(document.gmtModified).toISOString().slice(0, 10) : null,
    source: 'catalog',
    lifecycle: productOverrides[method]?.lifecycle ?? 'active',
    risk,
    verification: 'documented',
    realCallEnabled: enabled && risk === 'read',
    requestSchema: schemaName ? `AlibabaProduct${schemaName}Request` : null,
    responseSchema: schemaName ? `AlibabaProduct${schemaName}Response` : null
  } satisfies AuditEntry;
});

const entries = audited
  .filter((entry): entry is AuditEntry => entry !== null)
  .sort((left, right) => left.method.localeCompare(right.method));
const json = `${JSON.stringify({ checkedAt, count: entries.length, entries }, null, 2)}\n`;
const ts = `// Generated by scripts/audit-alibaba-api.ts. Do not edit.\nimport type { ApiCapability } from '../types';\n\nexport const API_CAPABILITIES = ${JSON.stringify(entries, null, 2)} as const satisfies readonly ApiCapability[];\n`;

const jsonPath = resolve(root, 'docs/alibaba-api-audit.json');
const tsPath = resolve(root, 'packages/core/src/generated/capabilities.ts');
if (process.argv.includes('--check')) {
  const current = await readFile(jsonPath, 'utf8');
  if (current !== json) throw new Error('Alibaba API audit snapshot is stale; run pnpm audit:apis');
} else {
  await Promise.all([writeFile(jsonPath, json, 'utf8'), writeFile(tsPath, ts, 'utf8')]);
  process.stdout.write(`Audited ${entries.length} eligible APIs at ${checkedAt}\n`);
}
