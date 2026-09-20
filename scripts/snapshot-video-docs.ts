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
for (const docId of [49930, 50709, 50089, 50088]) {
  const source = JSON.parse(
    await readFile(resolve(root, `artifacts/top-api-audit/documents/${docId}.json`), 'utf8')
  ) as { success: boolean; data: Doc };
  if (!source.success) throw new Error('Invalid official document');
  const d = source.data;
  const mutation = docId === 50089 || docId === 50088;
  // 50088's public sample contains unquoted 结果, not a JSON Boolean. This explicit
  // type-only override is NOT an observed response or evidence of a success code.
  const example =
    docId === 50088
      ? {
          alibaba_icbu_video_relation_product_detail_response: {
            model: false,
            msg_code: 'code',
            msg_info: 'info'
          }
        }
      : (JSON.parse(d.rspSampleSimplifyJson) as Record<string, unknown>);
  definitions.push({
    method: d.name,
    source: 'catalog',
    docId,
    title: d.apiChineseName,
    description: d.description,
    lifecycle: 'active',
    risk: mutation ? 'mutation' : 'read',
    featureArea: 'videos',
    restricted: false,
    restrictionReason: null,
    checkedAt: mutation ? '2026-09-21' : '2026-09-10',
    updatedAt: new Date(d.gmtModified).toISOString().slice(0, 10),
    labels: d.labels.map((l) => l.displayName),
    requestParams: clean(d.requestParams),
    responseParams: clean(d.responseParams),
    errorCodes: [],
    requestExample: mutation
      ? { video_id: '1111', product_id: '11111' }
      : docId === 49930
        ? { current_page: 1, page_size: 20 }
        : { type: 'videoId', video_id: 'example-encrypted-video' },
    responseExample: Object.values(example)[0],
    ...(docId === 50088
      ? {
          responseExampleOverride: {
            reason:
              'Official sample is INVALID JSON: model contains unquoted 结果 despite its Boolean declaration. Replaced only that placeholder with false for schema/replay validation. msg_code code remains an undocumented placeholder, NOT a success code. Not account-verified.',
            originalSample: d.rspSampleSimplifyJson
          }
        }
      : {})
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
    risk: d.risk,
    verification: 'documented',
    realCallEnabled: d.risk === 'read',
    requestSchema: prefix + 'Request',
    responseSchema: prefix + 'Response'
  });
}
await writeFile(supplementPath, JSON.stringify(supplements, null, 2) + '\n');
