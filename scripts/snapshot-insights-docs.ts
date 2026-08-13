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

type FeatureArea = 'performance' | 'partnerData' | 'suppliers' | 'supplierProducts';

interface OverrideDefinition {
  title?: string;
  description?: string;
  lifecycle?: 'active' | 'deprecated' | 'unlisted';
  risk?: 'read' | 'mutation';
  featureArea?: FeatureArea;
  restricted?: boolean;
  restrictionReason?: string;
  requestParams?: ParamNode[];
  responseParams?: ParamNode[];
  requestExample?: unknown;
  responseExample?: unknown;
}

const root = resolve(import.meta.dirname, '..');
const audit = JSON.parse(await readFile(resolve(root, 'docs/alibaba-api-audit.json'), 'utf8')) as {
  checkedAt: string;
  entries: AuditEntry[];
};
const overrides = JSON.parse(
  await readFile(resolve(root, 'config/alibaba-insights-overrides.json'), 'utf8')
) as Record<string, OverrideDefinition>;
const methods = JSON.parse(
  await readFile(resolve(root, 'config/alibaba-insights-category.json'), 'utf8')
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
    throw new Error('Alibaba insights document contains an invalid parameter node');
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

const eligible = new Map(
  audit.entries
    .filter((entry) => entry.domain === 'data' || entry.domain === 'buyer')
    .map((entry) => [entry.method, entry])
);
const definitions = [];
const exclusions = [];
for (const method of methods) {
  const auditEntry = eligible.get(method);
  if (!auditEntry) {
    exclusions.push({ method, reason: 'not-in-eligible-audit', docId: null, labels: [] });
    continue;
  }
  const docId = docIdFromUrl(auditEntry.docUrl);
  const document = await fetchDocument(docId);
  const override = overrides[method];
  definitions.push({
    method,
    source: 'catalog' as const,
    sourceCategory: auditEntry.domain as 'data' | 'buyer',
    docId,
    title: override?.title ?? stringValue(document.apiChineseName) ?? method,
    description: override?.description ?? stringValue(document.description) ?? '',
    lifecycle: override?.lifecycle ?? ('active' as const),
    risk: override?.risk ?? auditEntry.risk,
    featureArea: override?.featureArea ?? ('performance' as const),
    restricted: override?.restricted ?? auditEntry.restricted,
    restrictionReason: override?.restrictionReason ?? auditEntry.restrictionReason,
    labels: labelsOf(document),
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
    resolve(root, 'docs/alibaba-insights-api-docs.json'),
    `${JSON.stringify(
      {
        checkedAt: audit.checkedAt,
        dataCount: definitions.filter((item) => item.sourceCategory === 'data').length,
        buyerCount: definitions.filter((item) => item.sourceCategory === 'buyer').length,
        catalogCount: definitions.length,
        definitions
      },
      null,
      2
    )}\n`,
    'utf8'
  ),
  writeFile(
    resolve(root, 'docs/alibaba-insights-api-exclusions.json'),
    `${JSON.stringify({ checkedAt: audit.checkedAt, count: exclusions.length, exclusions }, null, 2)}\n`,
    'utf8'
  )
]);
process.stdout.write(`Snapshotted ${definitions.length} insights APIs and ${exclusions.length} exclusions\n`);
