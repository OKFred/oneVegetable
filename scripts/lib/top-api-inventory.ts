export function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
export function plain(value: unknown): string {
  return typeof value === 'string'
    ? value
        .replace(/<[^>]*>/g, ' ')
        .replace(/&(?:emsp|nbsp|ensp);/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    : '';
}
export interface CatalogItem {
  method: string;
  docId: number;
  title: string;
  categories: string[];
}
export function collectCatalog(value: unknown): CatalogItem[] {
  const found = new Map<number, CatalogItem>();
  function visit(node: unknown, category: string): void {
    if (Array.isArray(node)) {
      for (const child of node) visit(child, category);
      return;
    }
    if (!record(node)) return;
    const current = typeof node.treeName === 'string' ? node.treeName : category;
    if (node.docType === 2 && typeof node.docId === 'number' && typeof node.name === 'string') {
      const previous = found.get(node.docId);
      found.set(node.docId, {
        method: node.name,
        docId: node.docId,
        title: plain(node.subName) || (previous?.title ?? ''),
        categories: [...new Set([...(previous?.categories ?? []), current].filter(Boolean))]
      });
    }
    for (const child of Object.values(node)) visit(child, current);
  }
  visit(value, '');
  return [...found.values()].sort((a, b) => a.method.localeCompare(b.method));
}
export function related(item: CatalogItem, known: ReadonlySet<string>): boolean {
  return (
    known.has(item.method) ||
    item.categories.some((name) => /ICBU|国际站|一达通|外贸/i.test(name)) ||
    /^alibaba\.(icbu|intention|mydata|onetouch|order|procurement|seller|trade|wholesale)\./.test(item.method)
  );
}
export function documentData(value: unknown): Record<string, unknown> {
  if (!record(value) || value.success !== true || !record(value.data))
    throw new Error('Document service rejected or returned an invalid envelope');
  return value.data;
}
export interface ExistingEntry {
  method: string;
  docUrl: string;
  lifecycle: string;
  enabled: boolean;
  realCallEnabled: boolean;
  jushitaOnly: boolean;
  restricted: boolean;
}
export function existingEntries(value: unknown): ExistingEntry[] {
  if (!record(value) || !Array.isArray(value.entries)) throw new Error('Invalid existing audit');
  return value.entries.filter(record).map((item) => ({
    method: plain(item.method),
    docUrl: plain(item.docUrl),
    lifecycle: plain(item.lifecycle),
    enabled: item.enabled === true,
    realCallEnabled: item.realCallEnabled === true,
    jushitaOnly: item.jushitaOnly === true,
    restricted: item.restricted === true
  }));
}
export function summarize(
  item: CatalogItem,
  data: Record<string, unknown>,
  existing: ExistingEntry | undefined
) {
  if (data.name !== item.method) throw new Error('Document method does not match catalog');
  const labels = Array.isArray(data.labels)
    ? data.labels
        .filter(record)
        .map((label) => plain(label.displayName))
        .filter(Boolean)
    : [];
  const description = plain(data.description);
  const title = plain(data.apiChineseName) || item.title;
  const scopes = (Array.isArray(data.applyScopes) ? data.applyScopes : [data.applyScopes])
    .filter(record)
    .map((scope) => ({
      name: plain(scope.name),
      applications: plain(scope.descprition ?? scope.description)
    }));
  const fee = labels.find((label) => /￥|免费|收费/.test(label)) ?? 'unknown';
  const auth = labels.find((label) => label.includes('授权')) ?? 'unknown';
  const free = /^￥?(免费|开放平台免费API)$/.test(fee);
  const scopeText = scopes.map((scope) => `${scope.name} ${scope.applications}`).join(' ');
  const scopeReview =
    /DropShipping|海外分销|站外店铺继承|三方服务商|ACP小满|服务市场|ICBU-直播|ICBU翻译能力/i.test(scopeText);
  const outOfScope = /1688|淘宝|天猫/.test(scopeText) && !/ICBU|国际站/i.test(scopeText);
  const jushita = existing?.jushitaOnly === true || /聚石塔|jushita/i.test(description + labels.join(' '));
  const lifecycle =
    existing?.lifecycle === 'deprecated'
      ? 'deprecated'
      : /废弃|停止维护|下线|不再维护/.test(description)
        ? 'review-required'
        : 'not-marked-deprecated';
  const restrictions = description
    .split(/[。；;\n]/)
    .filter((text) => /ISV|仅供|白名单|限定|签约|特定|聚石塔|申请.*权限/i.test(text))
    .map((text) => text.slice(0, 400));
  const disposition = outOfScope
    ? 'out-of-scope'
    : jushita
      ? 'jushita-review'
      : lifecycle !== 'not-marked-deprecated'
        ? 'lifecycle-review'
        : !free
          ? 'fee-review'
          : existing
            ? 'already-recorded'
            : restrictions.length || scopeReview
              ? 'conditional-candidate'
              : 'candidate';
  return {
    ...item,
    title,
    description,
    docUrl: `https://open.taobao.com/api.htm?docId=${item.docId}&docType=2`,
    updatedAtUtc:
      typeof data.gmtModified === 'number' && Number.isFinite(new Date(data.gmtModified).getTime())
        ? new Date(data.gmtModified).toISOString()
        : null,
    labels,
    fee,
    auth,
    scopes,
    scopeReview,
    restrictions,
    lifecycle,
    disposition,
    existing: existing
      ? {
          enabled: existing.enabled,
          realCallEnabled: existing.realCallEnabled,
          restricted: existing.restricted
        }
      : null,
    requestFields: Array.isArray(data.requestParams)
      ? data.requestParams.filter(record).map((p) => plain(p.name))
      : [],
    responseFields: Array.isArray(data.responseParams)
      ? data.responseParams.filter(record).map((p) => plain(p.name))
      : []
  };
}

export function markdownTable(rows: ReturnType<typeof summarize>[]): string {
  const escape = (text: string) => text.replaceAll('|', '\\|').replace(/[\r\n]/g, ' ');
  return [
    '| 方法 | 用途 | 分类 | 费用 / 授权 | 权限组 / 适用应用 | 判定 |',
    '|---|---|---|---|---|---|',
    ...rows.map(
      (row) =>
        `| [${row.method}](${row.docUrl}) | ${escape(row.title)} | ${escape(row.categories.join(' / '))} | ${escape(`${row.fee} / ${row.auth}`)} | ${escape(row.scopes.map((s) => `${s.name}: ${s.applications}`).join(' / '))} | ${row.disposition} |`
    )
  ].join('\n');
}
