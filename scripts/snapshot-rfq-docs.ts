import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

interface AuditEntry {
  method: string;
  domain: string;
  docUrl: string;
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
  await readFile(resolve(root, 'config/alibaba-rfq-overrides.json'), 'utf8')
) as Record<string, OverrideDefinition>;

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
    throw new Error('Alibaba RFQ document contains an invalid parameter node');
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

async function fetchDocument(docId: number): Promise<Record<string, unknown>> {
  const response = await fetch(
    `https://developer.alibaba.com/handler/document/getDocument.json?docType=2&docId=${docId}`,
    { headers: { Accept: 'application/json' } }
  );
  if (!response.ok) throw new Error(`Could not fetch Alibaba RFQ document ${docId}: ${response.status}`);
  const body: unknown = await response.json();
  if (!isRecord(body) || !isRecord(body.data)) throw new Error(`Invalid Alibaba RFQ document ${docId}`);
  return body.data;
}

function docIdFromUrl(url: string): number {
  const match = /apiId=(\d+)/.exec(url);
  if (!match?.[1]) throw new Error(`Missing apiId in ${url}`);
  return Number(match[1]);
}

function riskOf(method: string): 'read' | 'mutation' {
  const explicit = overrides[method]?.risk;
  if (explicit) return explicit;
  return /\.(add|create|delete|modify|operate|post|save|update|upload)(\.|$)/.test(method)
    ? 'mutation'
    : 'read';
}

function mergeParams(documentParams: unknown, overrideParams: ParamNode[] | undefined): ParamNode[] {
  return overrideParams ?? (Array.isArray(documentParams) ? documentParams.map(parseParam) : []);
}

const definitions = [];
for (const entry of audit.entries.filter((candidate) => candidate.domain === 'rfq')) {
  const docId = docIdFromUrl(entry.docUrl);
  const document = await fetchDocument(docId);
  const override = overrides[entry.method];
  const labels = Array.isArray(document.labels)
    ? document.labels.flatMap((label) =>
        isRecord(label) && typeof label.displayName === 'string' ? [label.displayName] : []
      )
    : [];
  definitions.push({
    method: entry.method,
    source: 'catalog' as const,
    docId,
    title: override?.title ?? stringValue(document.apiChineseName) ?? entry.method,
    description: override?.description ?? stringValue(document.description) ?? '',
    lifecycle: override?.lifecycle ?? ('active' as const),
    risk: riskOf(entry.method),
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

const snapshot = {
  checkedAt: audit.checkedAt,
  catalogCount: definitions.length,
  definitions: definitions.sort((left, right) => left.method.localeCompare(right.method))
};

await writeFile(
  resolve(root, 'docs/alibaba-rfq-api-docs.json'),
  `${JSON.stringify(snapshot, null, 2)}\n`,
  'utf8'
);
process.stdout.write(`Snapshotted ${snapshot.catalogCount} RFQ catalog APIs\n`);
