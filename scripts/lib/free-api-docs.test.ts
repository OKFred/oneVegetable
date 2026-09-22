import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import scopeJson from '../../config/alibaba-free-api-scope.json';
import snapshotJson from '../../docs/alibaba-free-api-docs.json';
import { auditOptions, documentHash, publicDocument } from '../audit-top-api';
import {
  buildSnapshot,
  normalizeAuth,
  normalizeDefinition,
  parseParam,
  parseScope,
  runSnapshot
} from '../snapshot-free-api-docs';

const scope = parseScope(scopeJson);
const first = scope.entries[0];
if (!first) throw new Error('Missing test scope entry');
const entry = first;
function document(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: entry.method,
    apiChineseName: 'Public title',
    description: 'Public description',
    labels: [{ displayName: '￥开放平台免费API' }, { displayName: '必须用户授权' }],
    applyScopes: [{ name: '国际站基础权限包', descprition: 'ICBU国际站' }],
    requestParams: [],
    responseParams: [],
    errorCodes: [],
    gmtModified: 0,
    ...overrides
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('free public documentation scope and audit arguments', () => {
  it('pins 8 general and 27 conditional identities, without excluding all seller.vendor methods', () => {
    expect(scope.entries).toHaveLength(35);
    expect(scope.entries.filter((e) => e.businessScope === 'general')).toHaveLength(8);
    expect(scope.entries.filter((e) => e.businessScope === 'conditional')).toHaveLength(27);
    expect(scope.entries.find((e) => e.docId === 48967)?.method).toBe('alibaba.seller.vendor.order.detail');
  });
  it('rejects missing, duplicate, extra, excluded and incorrectly grouped IDs', () => {
    expect(() => parseScope({ ...scopeJson, entries: scopeJson.entries.slice(1) })).toThrow();
    expect(() =>
      parseScope({ ...scopeJson, entries: [...scopeJson.entries, scopeJson.entries[0]] })
    ).toThrow();
    for (const change of [
      { docId: 99999 },
      { docId: 48967 },
      { businessScope: 'conditional' },
      { method: 'alibaba.xiaoman.query' }
    ]) {
      expect(() =>
        parseScope({
          ...scopeJson,
          entries: [{ ...scopeJson.entries[0], ...change }, ...scopeJson.entries.slice(1)]
        })
      ).toThrow();
    }
  });
  it('supports the requested seed/output/offline flags and rejects typos and duplicates', () => {
    expect(
      auditOptions(['--seed-doc-id=48967', '--output=artifacts/free-api-audit', '--offline'])
    ).toMatchObject({
      seedDocId: 48967,
      offline: true,
      output: resolve(import.meta.dirname, '../../artifacts/free-api-audit')
    });
    expect(() => auditOptions(['--seed-doc-id=0'])).toThrow();
    expect(() => auditOptions(['--seed-doc-id=9007199254740993'])).toThrow();
    expect(() => auditOptions(['--offline', '--offline'])).toThrow();
    expect(() => auditOptions(['--offine'])).toThrow();
  });
});

describe('lossless parameter and sample normalization', () => {
  it('retains deep children, null[] types, false/zero/empty demos and numeric constraints', () => {
    const result = parseParam({
      name: 'query',
      type: 'Query',
      required: true,
      subParams: [
        {
          name: 'status',
          type: 'null[]',
          required: false,
          description: '<b>Status</b>',
          minValue: '0',
          maxValue: '100',
          maxLength: '200',
          maxListSize: '5',
          demoValue: 'approved',
          defaultValue: '',
          subParams: [{ name: 'deep', type: 'Boolean', demoValue: false, maxListSize: 0 }]
        }
      ]
    });
    expect(result.subParams[0]).toEqual({
      name: 'status',
      type: 'null[]',
      required: false,
      description: 'Status',
      minValue: 0,
      maxValue: 100,
      maxLength: 200,
      maxListSize: 5,
      demoValue: 'approved',
      defaultValue: '',
      subParams: [
        {
          name: 'deep',
          type: 'Boolean',
          required: false,
          description: '',
          demoValue: 'false',
          maxListSize: 0,
          subParams: []
        }
      ]
    });
    expect(parseParam({ name: 'zero', type: 'Number', demoValue: 0 }).demoValue).toBe('0');
  });
  it('fails rather than silently dropping invalid nodes, children or constraints', () => {
    for (const invalid of [
      { type: null },
      { subParams: {} },
      { required: 'false' },
      { maxValue: 'oops' },
      { maxListSize: -1 },
      { maxLength: 1.5 },
      { maxValue: '9007199254740993' }
    ]) {
      expect(() => parseParam({ name: 'field', type: 'String', ...invalid })).toThrow();
    }
  });
  it('keeps malformed official JSON as text, normalizes line endings and preserves raw properties', () => {
    const raw = document({
      reqSampleJson: '{\r\n"query": "example"\r\n}',
      rspSampleSimplifyJson: '{"buyer_ali_id":阿里id}',
      rspSampleJson: 'alternate',
      errorCodes: [{ errorCode: 'invalid', description: 'Invalid input' }]
    });
    const result = normalizeDefinition(entry, raw, '2026-09-22', scope);
    expect(result.requestExample).toBe('{\n"query": "example"\n}');
    expect(result.responseExample).toBe('{"buyer_ali_id":阿里id}');
    expect(result.rawDocument.reqSampleJson).toBe(raw.reqSampleJson);
    expect(result.errorCodes).toEqual(raw.errorCodes);
    expect(normalizeDefinition(entry, document(), '2026-09-22', scope).requestExample).toBeNull();
  });
  it('does not persist envelopes, cookies, account metadata or generated SDK credentials', () => {
    const raw = document({
      cookie: 'private',
      _tb_token_: 'private',
      account: { email: 'private' },
      sdkDemos: [{ descprition: 'session=private' }],
      envConfigs: [{ appKey: 'private' }]
    });
    expect(JSON.stringify(publicDocument(raw))).not.toContain('private');
    expect(documentHash(raw)).toBe(documentHash(document()));
  });
});

describe('eligibility is not account verification', () => {
  it.each([
    [['必须用户授权'], 'required'],
    [['不需用户授权'], 'none'],
    [['可选用户授权'], 'optional'],
    [[], 'unknown']
  ])('normalizes public auth labels %j to %s', (labels, expected) => {
    expect(normalizeAuth(labels)).toBe(expected);
  });
  it('rejects contradictory authorization labels', () => {
    expect(() => normalizeAuth(['必须用户授权', '不需用户授权'])).toThrow();
  });
  it('marks conditional read calls restricted without claiming account acceptance', () => {
    const conditionalEntry = scope.entries.find((e) => e.docId === 48967);
    if (!conditionalEntry) throw new Error('Missing conditional scope');
    const result = normalizeDefinition(
      conditionalEntry,
      document({ name: conditionalEntry.method, applyScopes: [{ name: '国际站服务市场权限包' }] }),
      '2026-09-22',
      scope
    );
    expect(result).toMatchObject({
      risk: 'read',
      restricted: true,
      auth: 'required',
      permissionGroups: ['国际站服务市场权限包'],
      checkedAt: '2026-09-22',
      updatedAt: '1970-01-01'
    });
    expect(result.restrictionReason).toContain('account authorization has not been verified');
    expect(result).not.toHaveProperty('accountVerified');
    expect(result).not.toHaveProperty('realCallEnabled');
  });
  it.each([
    { name: 'wrong.method' },
    { docId: 99999 },
    { labels: [] },
    { labels: [{ displayName: '￥0.01/次' }] },
    { labels: [{ displayName: '￥免费' }, { displayName: '收费API' }] },
    { description: '聚石塔内调用' },
    { description: 'jushita only' },
    { applyScopes: [{ name: 'ACP小满' }] },
    { description: 'snsoft only' },
    { requestParams: null },
    { responseParams: {} },
    { description: '已废弃' }
  ])('fails closed for invalid source %j', (change) => {
    expect(() => normalizeDefinition(entry, document(change), '2026-09-22', scope)).toThrow();
  });
});

describe('checked-in snapshot reproducibility', () => {
  it('rebuilds all 35 sources deterministically and preserves the capture date', () => {
    const sources = new Map(snapshotJson.definitions.map((d) => [d.docId, d.rawDocument]));
    expect(buildSnapshot(scope, sources, snapshotJson.capturedAtUtc)).toEqual(snapshotJson);
    expect(() => buildSnapshot(scope, new Map([...sources].slice(1)), snapshotJson.capturedAtUtc)).toThrow();
    expect(() => buildSnapshot(scope, sources, '')).toThrow();
    expect(
      snapshotJson.definitions.every((d) => d.permissionGroups.every((g) => typeof g === 'string'))
    ).toBe(true);
    expect(snapshotJson.definitions.filter((d) => d.restricted)).toHaveLength(27);
  });
  it('offline check uses no network and does not rewrite the file', async () => {
    const network = vi.fn(() => {
      throw new Error('Unexpected network');
    });
    vi.stubGlobal('fetch', network);
    const path = resolve(import.meta.dirname, '../../docs/alibaba-free-api-docs.json');
    const before = await readFile(path, 'utf8');
    await runSnapshot(['--offline', '--check']);
    expect(await readFile(path, 'utf8')).toBe(before);
    expect(network).not.toHaveBeenCalled();
  });
});
