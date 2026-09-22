import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { format, resolveConfig } from 'prettier';
import { documentHash, publicDocument, runAudit } from './audit-top-api';
import { documentData, plain, record, summarize } from './lib/top-api-inventory';

const root = resolve(import.meta.dirname, '..');
const snapshotPath = resolve(root, 'docs/alibaba-free-api-docs.json');
const scopePath = resolve(root, 'config/alibaba-free-api-scope.json');
const general = [50558, 58733, 58593, 58594, 31686, 70438, 53178, 50133];
const conditional = [
  67168, 67167, 69862, 69877, 54908, 55331, 54717, 61189, 54739, 54972, 55278, 55329, 54716, 69201, 69202,
  68142, 68143, 68144, 68145, 75093, 51234, 48967, 48971, 54661, 55311, 56479, 57592
];

export interface ScopeEntry {
  docId: number;
  method: string;
  domain: string;
  risk: 'read' | 'mutation';
  featureArea: string;
  businessScope: 'general' | 'conditional';
}
export interface Scope {
  schemaVersion: 1;
  source: 'publicdoc';
  seedDocId: number;
  expectedCount: 35;
  excludedVendorPatterns: string[];
  entries: ScopeEntry[];
}
export interface ParamNode {
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
  subParams: ParamNode[];
}

export function parseScope(value: unknown): Scope {
  if (
    !record(value) ||
    value.schemaVersion !== 1 ||
    value.source !== 'publicdoc' ||
    value.expectedCount !== 35 ||
    value.seedDocId !== 48967 ||
    !Array.isArray(value.entries) ||
    value.entries.length !== 35 ||
    !Array.isArray(value.excludedVendorPatterns) ||
    !value.excludedVendorPatterns.every((v: unknown) => typeof v === 'string' && v.length > 0)
  )
    throw new Error('Invalid free API scope: expected exactly 35 pinned entries');
  const ids = new Set<number>();
  const methods = new Set<string>();
  const entries = value.entries.map((item: unknown): ScopeEntry => {
    if (
      !record(item) ||
      typeof item.docId !== 'number' ||
      ![...general, ...conditional].includes(item.docId) ||
      typeof item.method !== 'string' ||
      !/^alibaba\.[a-z0-9.]+$/.test(item.method) ||
      typeof item.domain !== 'string' ||
      !item.domain ||
      typeof item.featureArea !== 'string' ||
      !item.featureArea ||
      (item.risk !== 'read' && item.risk !== 'mutation') ||
      item.businessScope !== (general.includes(item.docId) ? 'general' : 'conditional') ||
      ids.has(item.docId) ||
      methods.has(item.method)
    )
      throw new Error('Scope identity/group mismatch or duplicate');
    if (/xiaoman|snsoft|小满|南北软件/i.test(item.method)) throw new Error('Excluded vendor in scope');
    ids.add(item.docId);
    methods.add(item.method);
    return {
      docId: item.docId,
      method: item.method,
      domain: item.domain,
      risk: item.risk,
      featureArea: item.featureArea,
      businessScope: general.includes(item.docId) ? 'general' : 'conditional'
    };
  });
  return {
    schemaVersion: 1,
    source: 'publicdoc',
    seedDocId: 48967,
    expectedCount: 35,
    excludedVendorPatterns: value.excludedVendorPatterns as string[],
    entries
  };
}

function scalar(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)))
    return String(value);
  throw new Error(`Invalid parameter ${field}`);
}
export function parseParam(value: unknown): ParamNode {
  if (
    !record(value) ||
    typeof value.name !== 'string' ||
    !value.name ||
    typeof value.type !== 'string' ||
    !value.type
  )
    throw new Error('Invalid publicdoc parameter node');
  if (value.required !== undefined && value.required !== null && typeof value.required !== 'boolean')
    throw new Error(`Invalid required flag: ${value.name}`);
  if (value.subParams !== undefined && value.subParams !== null && !Array.isArray(value.subParams))
    throw new Error(`Invalid nested parameters: ${value.name}`);
  const node: ParamNode = {
    name: value.name,
    type: value.type,
    required: value.required === true,
    description: plain(value.description),
    subParams: Array.isArray(value.subParams) ? value.subParams.map(parseParam) : []
  };
  for (const key of ['defaultValue', 'demoValue'] as const) {
    const text = scalar(value[key], key);
    if (text !== undefined) node[key] = text;
  }
  for (const key of ['minValue', 'maxValue', 'maxLength', 'maxListSize'] as const) {
    const raw = value[key];
    if (raw === null || raw === undefined || raw === '') continue;
    const number = typeof raw === 'string' && raw.trim() ? Number(raw) : raw;
    if (
      typeof number !== 'number' ||
      !Number.isFinite(number) ||
      (Number.isInteger(number) && !Number.isSafeInteger(number)) ||
      ((key === 'maxLength' || key === 'maxListSize') && (!Number.isInteger(number) || number < 0))
    )
      throw new Error(`Invalid numeric constraint ${value.name}.${key}`);
    node[key] = number;
  }
  return node;
}

export function normalizeAuth(labels: string[]): 'required' | 'optional' | 'none' | 'unknown' {
  const result = new Set<'required' | 'optional' | 'none'>();
  for (const label of labels) {
    if (/^(必须|需要)用户授权$/.test(label)) result.add('required');
    if (/^(不需|不需要|无需)用户授权$/.test(label)) result.add('none');
    if (/^(可选用户授权|用户授权可选|可选授权)$/.test(label)) result.add('optional');
  }
  if (result.size > 1) throw new Error('Conflicting public authorization labels');
  return [...result][0] ?? 'unknown';
}

function sample(data: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === 'string' && value.trim()) return value.replace(/\r\n?/g, '\n');
    if (record(value) || Array.isArray(value)) return JSON.stringify(value, null, 2);
  }
  return null;
}

export function normalizeDefinition(
  entry: ScopeEntry,
  input: Record<string, unknown>,
  checkedAt: string,
  scope: Scope
) {
  const data = publicDocument(input);
  if (data.name !== entry.method || (data.docId !== undefined && Number(data.docId) !== entry.docId))
    throw new Error(`Document identity mismatch: ${entry.docId}`);
  const summary = summarize({ ...entry, title: entry.method, categories: [] }, data, undefined);
  const metadata = [
    entry.method,
    summary.title,
    summary.description,
    ...summary.labels,
    ...summary.scopes.flatMap((s) => [s.name, s.applications])
  ].join(' ');
  if (
    /xiaoman|snsoft|小满|南北软件/i.test(metadata) ||
    scope.excludedVendorPatterns.some((p) => metadata.toLowerCase().includes(p.toLowerCase()))
  )
    throw new Error(`Excluded vendor: ${entry.docId}`);
  if (/聚石塔|jushita/i.test(metadata)) throw new Error(`Jushita API is excluded: ${entry.docId}`);
  const prices = summary.labels.filter((label) => /[￥¥]|免费|收费/.test(label));
  if (!prices.length || prices.some((label) => !/^[￥¥]?(免费|开放平台免费API)$/.test(label)))
    throw new Error(`Fee or unknown charge label: ${entry.docId}`);
  if (summary.lifecycle !== 'not-marked-deprecated')
    throw new Error(`Lifecycle review required: ${entry.docId}`);
  const restricted =
    entry.businessScope === 'conditional' || summary.scopeReview || summary.restrictions.length > 0;
  const permissionGroups = [...new Set(summary.scopes.map((s) => s.name).filter(Boolean))];
  if (!permissionGroups.length) throw new Error(`Missing permission groups: ${entry.docId}`);
  const restrictionReason = restricted
    ? [
        ...summary.restrictions,
        `Requires applicable business qualifications and platform grants: ${permissionGroups.join('; ')}. Public documentation only; account authorization has not been verified.`
      ].join(' ')
    : null;
  if (!Array.isArray(data.requestParams) || !Array.isArray(data.responseParams))
    throw new Error(`Missing full request/response parameters: ${entry.docId}`);
  if (data.errorCodes !== undefined && data.errorCodes !== null && !Array.isArray(data.errorCodes))
    throw new Error(`Invalid error codes: ${entry.docId}`);
  return {
    method: entry.method,
    docId: entry.docId,
    docUrl: summary.docUrl,
    title: summary.title,
    description: summary.description,
    domain: entry.domain,
    risk: entry.risk,
    featureArea: entry.featureArea,
    businessScope: entry.businessScope,
    permissionGroups,
    auth: normalizeAuth(summary.labels),
    chargeLabel: prices[0] ?? '',
    restricted,
    restrictionReason,
    checkedAt,
    updatedAt: summary.updatedAtUtc?.slice(0, 10) ?? null,
    requestParams: data.requestParams.map(parseParam),
    responseParams: data.responseParams.map(parseParam),
    errorCodes: Array.isArray(data.errorCodes) ? data.errorCodes : [],
    requestExample: sample(data, ['requestExample', 'reqSampleSimplifyJson', 'reqSampleJson']),
    responseExample: sample(data, ['responseExample', 'rspSampleSimplifyJson', 'rspSampleJson']),
    rawDocument: data
  };
}

export function buildSnapshot(
  scope: Scope,
  sources: Map<number, Record<string, unknown>>,
  capturedAtUtc: string
) {
  if (!/^\d{4}-\d{2}-\d{2}T/.test(capturedAtUtc) || !Number.isFinite(Date.parse(capturedAtUtc)))
    throw new Error('Missing/invalid original public documentation capture timestamp');
  if (sources.size !== 35 || scope.entries.some((entry) => !sources.has(entry.docId)))
    throw new Error('Snapshot requires exactly 35 complete source documents');
  const checkedAt = capturedAtUtc.slice(0, 10);
  const definitions = [...scope.entries]
    .sort((a, b) => (a.method < b.method ? -1 : a.method > b.method ? 1 : 0))
    .map((entry) => normalizeDefinition(entry, sources.get(entry.docId) ?? {}, checkedAt, scope));
  return { schemaVersion: 1, checkedAt, source: 'publicdoc', capturedAtUtc, catalogCount: 35, definitions };
}

export async function runSnapshot(args: string[]) {
  const allowed = /^(--offline|--check|--input=.+)$/;
  if (
    args.some((arg) => !allowed.test(arg)) ||
    new Set(args.map((a) => a.split('=')[0])).size !== args.length
  )
    throw new Error('Use --offline, --check and/or --input=<audit-directory>');
  const offline = args.includes('--offline') || args.includes('--check');
  const check = args.includes('--check');
  const inputOption = args.find((arg) => arg.startsWith('--input='));
  if (inputOption && !offline) throw new Error('--input requires --offline or --check');
  const scope = parseScope(JSON.parse(await readFile(scopePath, 'utf8')) as unknown);
  const sources = new Map<number, Record<string, unknown>>();
  let capturedAtUtc: string;
  if (!offline || inputOption) {
    const input = resolve(root, inputOption?.slice(8) ?? 'artifacts/free-api-audit');
    if (!offline)
      await runAudit([`--seed-doc-id=${scope.seedDocId}`, `--output=${input}`, `--scope=${scopePath}`]);
    const inventory: unknown = JSON.parse(await readFile(resolve(input, 'inventory.json'), 'utf8'));
    const manifest: unknown = JSON.parse(await readFile(resolve(input, 'summary.json'), 'utf8'));
    if (
      !record(inventory) ||
      typeof inventory.capturedAtUtc !== 'string' ||
      inventory.documentCount !== 35 ||
      inventory.selectedCount !== 35 ||
      !Array.isArray(inventory.errors) ||
      inventory.errors.length ||
      !Array.isArray(inventory.rows) ||
      inventory.rows.length !== 35 ||
      !record(manifest) ||
      manifest.capturedAtUtc !== inventory.capturedAtUtc ||
      manifest.seedDocId !== scope.seedDocId ||
      !Array.isArray(manifest.results) ||
      manifest.results.length !== 2 ||
      !manifest.results.every((r: unknown) => record(r) && r.ok === true)
    )
      throw new Error('Incomplete/mismatched audit capture; refusing stale documents');
    capturedAtUtc = inventory.capturedAtUtc;
    for (const entry of scope.entries) {
      const data = publicDocument(
        documentData(
          JSON.parse(await readFile(resolve(input, 'documents', `${entry.docId}.json`), 'utf8')) as unknown
        )
      );
      const rows = inventory.rows.filter((r: unknown) => record(r) && r.docId === entry.docId);
      const row: unknown = rows[0];
      if (
        rows.length !== 1 ||
        !record(row) ||
        row.method !== entry.method ||
        row.sourceSha256 !== documentHash(data) ||
        row.checkedAt !== capturedAtUtc.slice(0, 10)
      )
        throw new Error(`Audit document/hash mismatch: ${entry.docId}`);
      sources.set(entry.docId, data);
    }
  } else {
    const saved: unknown = JSON.parse(await readFile(snapshotPath, 'utf8'));
    if (
      !record(saved) ||
      saved.schemaVersion !== 1 ||
      saved.source !== 'publicdoc' ||
      saved.catalogCount !== 35 ||
      typeof saved.capturedAtUtc !== 'string' ||
      !Array.isArray(saved.definitions) ||
      saved.definitions.length !== 35
    )
      throw new Error('Invalid checked-in snapshot source');
    capturedAtUtc = saved.capturedAtUtc;
    for (const value of saved.definitions as unknown[]) {
      if (
        !record(value) ||
        typeof value.docId !== 'number' ||
        sources.has(value.docId) ||
        !record(value.rawDocument)
      )
        throw new Error('Invalid/duplicate embedded rawDocument source');
      sources.set(value.docId, value.rawDocument);
    }
  }
  const snapshot = buildSnapshot(scope, sources, capturedAtUtc);
  const text = await format(JSON.stringify(snapshot), {
    ...(await resolveConfig(snapshotPath)),
    parser: 'json'
  });
  if (check) {
    if ((await readFile(snapshotPath, 'utf8')) !== text)
      throw new Error('Free API snapshot mismatch; regenerate offline and review');
  } else await writeFile(snapshotPath, text, 'utf8');
  process.stdout.write(
    `${check ? 'Verified' : 'Snapshotted'} 35 public docs; checkedAt=${snapshot.checkedAt}; no account verification\n`
  );
  return snapshot;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await runSnapshot(process.argv.slice(2));
}
