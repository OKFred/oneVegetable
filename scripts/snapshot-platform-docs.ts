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
  subParams?: ParamNode[];
}

type FeatureArea = 'fileTransfer' | 'riskAssessment' | 'taskCallback';

interface OverrideDefinition {
  featureArea: FeatureArea;
  risk?: 'read' | 'mutation';
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
  await readFile(resolve(root, 'config/alibaba-platform-overrides.json'), 'utf8')
) as Record<string, OverrideDefinition>;
const methods = JSON.parse(
  await readFile(resolve(root, 'config/alibaba-platform-category.json'), 'utf8')
) as string[];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function parseParam(value: unknown): ParamNode {
  if (!isRecord(value) || typeof value.name !== 'string' || typeof value.type !== 'string') {
    throw new Error('Alibaba platform document contains an invalid parameter node');
  }
  const children = Array.isArray(value.subParams) ? value.subParams.map(parseParam) : [];
  return {
    name: value.name,
    type: value.type,
    required: value.required === true,
    description: stringValue(value.description) ?? '',
    ...(stringValue(value.defaultValue) ? { defaultValue: stringValue(value.defaultValue) } : {}),
    ...(stringValue(value.demoValue) ? { demoValue: stringValue(value.demoValue) } : {}),
    ...(children.length > 0 ? { subParams: children } : {})
  };
}

async function fetchDocument(docId: number): Promise<Record<string, unknown>> {
  const response = await fetch(
    `https://developer.alibaba.com/handler/document/getDocument.json?docType=2&docId=${docId}`,
    { headers: { Accept: 'application/json' } }
  );
  if (!response.ok) throw new Error(`Could not fetch Alibaba document ${docId}: ${response.status}`);
  const body: unknown = await response.json();
  if (!isRecord(body) || !isRecord(body.data)) throw new Error(`Invalid Alibaba document ${docId}`);
  return body.data;
}

function docIdFromUrl(url: string): number {
  const match = /apiId=(\d+)/.exec(url);
  if (!match?.[1]) throw new Error(`Missing apiId in ${url}`);
  return Number(match[1]);
}

const eligible = new Map(
  audit.entries.filter((entry) => entry.domain === 'platform').map((entry) => [entry.method, entry])
);
const definitions = [];
for (const method of methods) {
  const auditEntry = eligible.get(method);
  if (!auditEntry) throw new Error(`${method} is missing from the eligible platform audit`);
  const docId = docIdFromUrl(auditEntry.docUrl);
  const document = await fetchDocument(docId);
  const override = overrides[method];
  if (!override) throw new Error(`${method} is missing its platform override`);
  definitions.push({
    method,
    source: 'catalog' as const,
    sourceCategory: 'platform' as const,
    docId,
    title: stringValue(document.apiChineseName) ?? method,
    description: stringValue(document.description) ?? '',
    lifecycle: 'active' as const,
    risk: override.risk ?? auditEntry.risk,
    featureArea: override.featureArea,
    restricted: override.restricted ?? auditEntry.restricted,
    restrictionReason: override.restrictionReason ?? auditEntry.restrictionReason,
    checkedAt: audit.checkedAt,
    updatedAt:
      typeof document.gmtModified === 'number'
        ? new Date(document.gmtModified).toISOString().slice(0, 10)
        : null,
    requestParams:
      override.requestParams ??
      (Array.isArray(document.requestParams) ? document.requestParams.map(parseParam) : []),
    responseParams:
      override.responseParams ??
      (Array.isArray(document.responseParams) ? document.responseParams.map(parseParam) : []),
    errorCodes: Array.isArray(document.errorCodes) ? document.errorCodes : [],
    requestExample: override.requestExample ?? null,
    responseExample: override.responseExample ?? null
  });
}

await writeFile(
  resolve(root, 'docs/alibaba-platform-api-docs.json'),
  `${JSON.stringify({ checkedAt: audit.checkedAt, catalogCount: definitions.length, definitions }, null, 2)}\n`,
  'utf8'
);
process.stdout.write(`Snapshotted ${definitions.length} platform APIs\n`);
