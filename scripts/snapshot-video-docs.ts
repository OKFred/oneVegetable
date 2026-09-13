// Offline extraction from the anonymous TOP audit. Never reads account credentials.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
interface Param {
  name: string;
  type: string;
  required: boolean;
  description: string;
  subParams?: Param[];
}
interface Doc {
  name: string;
  apiChineseName: string;
  description: string;
  gmtModified: number;
  labels: { displayName: string }[];
  requestParams: Param[];
  responseParams: Param[];
  rspSampleSimplifyJson: string;
}
const root = resolve(import.meta.dirname, '..');
const clean = (nodes: Param[]): Param[] =>
  nodes.map((n) => ({
    name: n.name,
    type: n.type,
    required: n.required,
    description: n.description,
    ...(n.subParams?.length ? { subParams: clean(n.subParams) } : {})
  }));
const definitions = [];
for (const docId of [49930, 50709]) {
  const source = JSON.parse(
    await readFile(resolve(root, `artifacts/top-api-audit/documents/${docId}.json`), 'utf8')
  ) as { success: boolean; data: Doc };
  if (!source.success) throw new Error('Invalid official document');
  const d = source.data;
  const example = JSON.parse(d.rspSampleSimplifyJson) as Record<string, unknown>;
  definitions.push({
    method: d.name,
    source: 'catalog',
    docId,
    title: d.apiChineseName,
    description: d.description,
    lifecycle: 'active',
    risk: 'read',
    featureArea: 'videos',
    restricted: false,
    restrictionReason: null,
    checkedAt: '2026-09-10',
    updatedAt: new Date(d.gmtModified).toISOString().slice(0, 10),
    labels: d.labels.map((l) => l.displayName),
    requestParams: clean(d.requestParams),
    responseParams: clean(d.responseParams),
    errorCodes: [],
    requestExample:
      docId === 49930
        ? { current_page: 1, page_size: 20 }
        : { type: 'videoId', video_id: 'example-encrypted-video' },
    responseExample: Object.values(example)[0]
  });
}
await writeFile(
  resolve(root, 'docs/alibaba-video-api-docs.json'),
  JSON.stringify({ definitions }, null, 2) + '\n'
);
const supplementPath = resolve(root, 'docs/alibaba-api-supplements.json');
const supplements = JSON.parse(await readFile(supplementPath, 'utf8')) as {
  entries: Record<string, unknown>[];
};
for (const d of definitions) {
  const prefix =
    'AlibabaPhoto' +
    d.method
      .split('.')
      .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
      .join('');
  supplements.entries = supplements.entries.filter((e) => e.method !== d.method);
  supplements.entries.push({
    method: d.method,
    domain: 'photo',
    chargeLabel: d.labels[0],
    auth: 'required',
    jushitaOnly: false,
    restricted: false,
    restrictionReason: null,
    enabled: true,
    docUrl: `https://developer.alibaba.com/docs/api.htm?apiId=${d.docId}`,
    checkedAt: d.checkedAt,
    updatedAt: d.updatedAt,
    source: 'catalog',
    lifecycle: 'active',
    risk: 'read',
    verification: 'documented',
    realCallEnabled: true,
    requestSchema: prefix + 'Request',
    responseSchema: prefix + 'Response'
  });
}
await writeFile(supplementPath, JSON.stringify(supplements, null, 2) + '\n');
