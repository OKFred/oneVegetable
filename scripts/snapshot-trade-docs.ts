import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

interface AuditEntry {
  method: string;
  domain: string;
  docUrl: string;
  restricted: boolean;
  restrictionReason: string | null;
  risk: 'read' | 'mutation';
}

interface ParamNode {
  name: string;
  type: string;
  required: boolean;
  description: string;
  defaultValue?: string;
  demoValue?: string;
  minValue?: number;
  maxValue?: number;
  maxLength?: number;
  maxListSize?: number;
  subParams?: ParamNode[];
}

interface OverrideDefinition {
  title?: string;
  description?: string;
  lifecycle?: 'active' | 'deprecated' | 'unlisted';
  risk?: 'read' | 'mutation';
  featureArea?: FeatureArea;
  requestParams?: ParamNode[];
  responseParams?: ParamNode[];
  requestExample?: unknown;
  responseExample?: unknown;
}

type FeatureArea = 'order' | 'finance' | 'fulfillment' | 'address' | 'authorization' | 'partner-specific';

const root = resolve(import.meta.dirname, '..');
const audit = JSON.parse(await readFile(resolve(root, 'docs/alibaba-api-audit.json'), 'utf8')) as {
  checkedAt: string;
  entries: AuditEntry[];
};
const overrides = JSON.parse(
  await readFile(resolve(root, 'config/alibaba-trade-overrides.json'), 'utf8')
) as Record<string, OverrideDefinition>;
const officialMethods = JSON.parse(
  await readFile(resolve(root, 'config/alibaba-trade-category.json'), 'utf8')
) as string[];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function parseParam(value: unknown): ParamNode {
  if (!isRecord(value) || typeof value.name !== 'string' || typeof value.type !== 'string') {
    throw new Error('Alibaba trade document contains an invalid parameter node');
  }
  const children = Array.isArray(value.subParams) ? value.subParams.map(parseParam) : [];
  return {
    name: value.name,
    type: value.type,
    required: value.required === true,
    description: stringValue(value.description) ?? '',
    ...(stringValue(value.defaultValue) ? { defaultValue: stringValue(value.defaultValue) } : {}),
    ...(stringValue(value.demoValue) ? { demoValue: stringValue(value.demoValue) } : {}),
    ...(numberValue(value.minValue) !== undefined ? { minValue: numberValue(value.minValue) } : {}),
    ...(numberValue(value.maxValue) !== undefined ? { maxValue: numberValue(value.maxValue) } : {}),
    ...(numberValue(value.maxLength) !== undefined ? { maxLength: numberValue(value.maxLength) } : {}),
    ...(numberValue(value.maxListSize) !== undefined ? { maxListSize: numberValue(value.maxListSize) } : {}),
    ...(children.length > 0 ? { subParams: children } : {})
  };
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Could not fetch Alibaba document: ${response.status} ${url}`);
  return response.json() as Promise<unknown>;
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

async function fetchDocument(docId: number): Promise<Record<string, unknown>> {
  const body = await fetchJson(
    `https://developer.alibaba.com/handler/document/getDocument.json?docType=2&docId=${docId}`
  );
  if (!isRecord(body) || !isRecord(body.data)) throw new Error(`Invalid Alibaba document ${docId}`);
  return body.data;
}

function docIdFromUrl(url: string): number {
  const match = /apiId=(\d+)/.exec(url);
  if (!match?.[1]) throw new Error(`Missing apiId in ${url}`);
  return Number(match[1]);
}

function featureAreaOf(method: string): FeatureArea {
  const explicit = overrides[method]?.featureArea;
  if (explicit) return explicit;
  if (/snsoft|xiaoman/.test(method)) return 'partner-specific';
  if (method.includes('address')) return 'address';
  if (/fund|charge|credit|\.tt\./.test(method)) return 'finance';
  if (/logistics|fulfillment|overseas/.test(method)) return 'fulfillment';
  if (/auth|ecology|decode|drafttype/.test(method)) return 'authorization';
  return 'order';
}

function mergeParams(documentParams: unknown, overrideParams: ParamNode[] | undefined): ParamNode[] {
  return overrideParams ?? (Array.isArray(documentParams) ? documentParams.map(parseParam) : []);
}

function labelsOf(document: Record<string, unknown>): string[] {
  return Array.isArray(document.labels)
    ? document.labels.flatMap((label) =>
        isRecord(label) && typeof label.displayName === 'string' ? [label.displayName] : []
      )
    : [];
}

const catalogBody = await fetchJson(
  'https://developer.alibaba.com/handler/document/getCatelogConfig.json?docId=118496'
);
if (!isRecord(catalogBody) || !('data' in catalogBody)) throw new Error('Invalid Alibaba catalog');
const catalogDocuments = collectDocuments(catalogBody.data);
const eligibleByMethod = new Map(
  audit.entries.filter((entry) => entry.domain === 'trade').map((entry) => [entry.method, entry])
);

const definitions = [];
const exclusions = [];
for (const method of officialMethods) {
  const auditEntry = eligibleByMethod.get(method);
  const docId = auditEntry ? docIdFromUrl(auditEntry.docUrl) : catalogDocuments.get(method);
  if (docId === undefined) {
    exclusions.push({ method, reason: 'not-in-main-catalog', docId: null, labels: [] });
    continue;
  }
  const document = await fetchDocument(docId);
  const labels = labelsOf(document);
  if (!auditEntry) {
    const reason = labels.some((label) => label.includes('聚石塔内调用'))
      ? 'jushita-only'
      : labels.some((label) => label === '￥免费' || label === '￥开放平台免费API')
        ? 'not-in-eligible-audit'
        : 'not-free';
    exclusions.push({ method, reason, docId, labels });
    continue;
  }
  const override = overrides[method];
  definitions.push({
    method,
    source: 'catalog' as const,
    docId,
    title: override?.title ?? stringValue(document.apiChineseName) ?? method,
    description: override?.description ?? stringValue(document.description) ?? '',
    lifecycle: override?.lifecycle ?? ('active' as const),
    risk: override?.risk ?? auditEntry.risk,
    featureArea: featureAreaOf(method),
    restricted: auditEntry.restricted,
    restrictionReason: auditEntry.restrictionReason,
    labels,
    checkedAt: audit.checkedAt,
    updatedAt:
      typeof document.gmtModified === 'number'
        ? new Date(document.gmtModified).toISOString().slice(0, 10)
        : null,
    requestParams: mergeParams(document.requestParams, override?.requestParams),
    responseParams: mergeParams(document.responseParams, override?.responseParams),
    errorCodes: Array.isArray(document.errorCodes) ? document.errorCodes : [],
    requestExample: override?.requestExample ?? null,
    responseExample: override?.responseExample ?? stringValue(document.rspSampleSimplifyJson) ?? null
  });
}

await Promise.all([
  writeFile(
    resolve(root, 'docs/alibaba-trade-api-docs.json'),
    `${JSON.stringify(
      {
        checkedAt: audit.checkedAt,
        officialCategoryCount: officialMethods.length,
        catalogCount: definitions.length,
        definitions
      },
      null,
      2
    )}\n`,
    'utf8'
  ),
  writeFile(
    resolve(root, 'docs/alibaba-trade-api-exclusions.json'),
    `${JSON.stringify({ checkedAt: audit.checkedAt, count: exclusions.length, exclusions }, null, 2)}\n`,
    'utf8'
  )
]);
process.stdout.write(`Snapshotted ${definitions.length} trade APIs and ${exclusions.length} exclusions\n`);
