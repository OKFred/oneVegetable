import type { ProductSchemaField, ProductSchemaRule } from './product-schema';

export type ProductOfficialHintSource = 'schema-tip' | 'product-score';
export type ProductSchemaOfficialRuleName = 'tipRule' | 'devTipRule';

export interface ProductSchemaOfficialHint {
  id: string;
  source: ProductOfficialHintSource;
  rootFieldKey: string | null;
  rootFieldId: string | null;
  rootFieldName: string;
  fieldKeys: string[];
  fieldIds: string[];
  fieldNames: string[];
  ruleNames: ProductSchemaOfficialRuleName[];
  summary: string;
  html: string;
  text: string;
  codeSamples: string[];
  occurrenceCount: number;
  hasRichContent: boolean;
}

export interface CollectProductSchemaOfficialHintOptions {
  recursive?: boolean;
}

export interface SanitizedOfficialProductHintHtml {
  html: string;
  text: string;
  summary: string;
  codeSamples: string[];
  hasRichContent: boolean;
}

const OFFICIAL_HINT_TAGS = new Set(['p', 'br', 'strong', 'em', 'u', 'ul', 'ol', 'li', 'a', 'pre', 'code']);
const DROP_WITH_CONTENT = new Set([
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'form',
  'input',
  'button',
  'img',
  'video',
  'audio',
  'svg',
  'math',
  'link',
  'meta'
]);
const SCHEMA_TAG_PATTERN =
  /<\/?(?:options|fields|field|values|value|complex-values?|complex-value)\b[^>]*>/giu;
const FIELD_CODE_PATTERN = /<field\b[\s\S]*?<\/field>/giu;

export function collectProductSchemaOfficialHints(
  fields: ProductSchemaField[],
  options: CollectProductSchemaOfficialHintOptions = {}
): ProductSchemaOfficialHint[] {
  const recursive = options.recursive ?? true;
  const collected = new Map<string, MutableOfficialHint>();

  for (const rootField of fields) {
    const rootIdentity = normalizeComparisonText(rootField.id || rootField.key);
    const rootName = displayFieldName(rootField);
    collectFieldRules(rootField, rootField, rootIdentity, rootName, collected);
    if (recursive) visitNestedFields(rootField, rootField, rootIdentity, rootName, collected);
  }

  return [...collected.values()].map(finishHint);
}

export function createProductScoreOfficialHints(messages: string[]): ProductSchemaOfficialHint[] {
  const collected = new Map<string, MutableOfficialHint>();
  for (const message of messages) {
    const sanitized = sanitizeOfficialProductHintHtml(message);
    const comparisonText = normalizeComparisonText(sanitized.text);
    if (!comparisonText) continue;
    const key = `product-score\u0000${comparisonText}`;
    const existing = collected.get(key);
    if (existing) {
      existing.occurrenceCount += 1;
      continue;
    }
    collected.set(key, {
      id: `product-score-${stableHash(key)}`,
      source: 'product-score',
      rootFieldKey: null,
      rootFieldId: null,
      rootFieldName: '平台评分',
      fieldKeys: [],
      fieldIds: [],
      fieldNames: [],
      ruleNames: [],
      ...sanitized,
      occurrenceCount: 1
    });
  }
  return [...collected.values()].map(finishHint);
}

export function sanitizeOfficialProductHintHtml(rawHtml: string): SanitizedOfficialProductHintHtml {
  const codeSamples: string[] = [];
  const withCodeBlocks = rawHtml.replace(FIELD_CODE_PATTERN, (sample) => {
    const normalizedSample = sample.replaceAll('\\"', '"').trim();
    const index = codeSamples.push(normalizedSample) - 1;
    return `<pre data-one-vegetable-code="${index}"><code>${escapeHtml(normalizedSample)}</code></pre>`;
  });
  const preparedHtml = withCodeBlocks.replace(SCHEMA_TAG_PATTERN, (token) => escapeHtml(token));
  const document = new DOMParser().parseFromString(preparedHtml, 'text/html');
  sanitizeChildren(document.body);
  removeEmptyBlocks(document.body);

  const text = extractHintText(document.body, false);
  const summaryText = extractHintText(document.body, true);
  const hasRichContent =
    codeSamples.length > 0 ||
    document.body.querySelector('p,br,strong,em,u,ul,ol,li,a,pre,code') !== null ||
    Array.from(summaryText).length > 96;

  return {
    html: document.body.innerHTML.trim(),
    text,
    summary: summarizeHint(summaryText || text),
    codeSamples,
    hasRichContent
  };
}

type MutableOfficialHint = ProductSchemaOfficialHint;

function visitNestedFields(
  field: ProductSchemaField,
  rootField: ProductSchemaField,
  rootIdentity: string,
  rootName: string,
  output: Map<string, MutableOfficialHint>
): void {
  const directChildren = field.instances.length > 0 ? [] : field.children;
  for (const child of directChildren) {
    collectFieldRules(child, rootField, rootIdentity, rootName, output);
    visitNestedFields(child, rootField, rootIdentity, rootName, output);
  }
  for (const instance of field.instances) {
    for (const child of instance.fields) {
      collectFieldRules(child, rootField, rootIdentity, rootName, output);
      visitNestedFields(child, rootField, rootIdentity, rootName, output);
    }
  }
}

function collectFieldRules(
  field: ProductSchemaField,
  rootField: ProductSchemaField,
  rootIdentity: string,
  rootName: string,
  output: Map<string, MutableOfficialHint>
): void {
  for (const rule of field.rules) {
    if (!isOfficialHintRule(rule) || !rule.value.trim()) continue;
    const sanitized = sanitizeOfficialProductHintHtml(rule.value);
    const comparisonText = normalizeComparisonText(sanitized.text);
    if (!comparisonText) continue;
    const key = `${rootIdentity}\u0000${comparisonText}`;
    const existing = output.get(key);
    if (existing) {
      appendUnique(existing.fieldKeys, field.key);
      appendUnique(existing.fieldIds, field.id);
      appendUnique(existing.fieldNames, displayFieldName(field));
      appendUnique(existing.ruleNames, rule.name);
      existing.occurrenceCount += 1;
      continue;
    }

    output.set(key, {
      id: `schema-tip-${stableHash(key)}`,
      source: 'schema-tip',
      rootFieldKey: rootField.key,
      rootFieldId: rootField.id,
      rootFieldName: rootName,
      fieldKeys: [field.key],
      fieldIds: field.id ? [field.id] : [],
      fieldNames: [displayFieldName(field)],
      ruleNames: [rule.name],
      ...sanitized,
      occurrenceCount: 1
    });
  }
}

function isOfficialHintRule(
  rule: ProductSchemaRule
): rule is ProductSchemaRule & { name: ProductSchemaOfficialRuleName } {
  return rule.name === 'tipRule' || rule.name === 'devTipRule';
}

function finishHint(hint: MutableOfficialHint): ProductSchemaOfficialHint {
  return {
    ...hint,
    fieldKeys: [...hint.fieldKeys],
    fieldIds: [...hint.fieldIds],
    fieldNames: [...hint.fieldNames],
    ruleNames: [...hint.ruleNames],
    codeSamples: [...hint.codeSamples]
  };
}

function sanitizeChildren(parent: Element): void {
  for (const child of Array.from(parent.children)) sanitizeElement(child);
}

function sanitizeElement(element: Element): void {
  const tag = element.localName.toLocaleLowerCase();
  if (tag === 'div') {
    const paragraph = element.ownerDocument.createElement('p');
    paragraph.append(...Array.from(element.childNodes));
    element.replaceWith(paragraph);
    sanitizeElement(paragraph);
    return;
  }
  if (!OFFICIAL_HINT_TAGS.has(tag)) {
    if (DROP_WITH_CONTENT.has(tag)) {
      element.remove();
      return;
    }
    sanitizeChildren(element);
    element.replaceWith(...Array.from(element.childNodes));
    return;
  }

  const rawHref = tag === 'a' ? element.getAttribute('href') : null;
  for (const attribute of Array.from(element.attributes)) element.removeAttribute(attribute.name);
  if (tag === 'a') sanitizeOfficialLink(element, rawHref);
  sanitizeChildren(element);
}

function sanitizeOfficialLink(element: Element, rawHref: string | null): void {
  const href = rawHref ? officialUrl(rawHref) : null;
  if (!href) return;
  element.setAttribute('href', href);
  element.setAttribute('target', '_blank');
  element.setAttribute('rel', 'nofollow noopener noreferrer');
}

function officialUrl(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl.startsWith('//') ? `https:${rawUrl}` : rawUrl);
    const hostname = url.hostname.toLocaleLowerCase();
    const officialHost =
      hostname === 'alibaba.com' ||
      hostname.endsWith('.alibaba.com') ||
      hostname === 'alicdn.com' ||
      hostname.endsWith('.alicdn.com');
    if (!officialHost || (url.protocol !== 'http:' && url.protocol !== 'https:')) return null;
    url.protocol = 'https:';
    url.username = '';
    url.password = '';
    return url.toString();
  } catch {
    return null;
  }
}

function removeEmptyBlocks(parent: Element): void {
  for (const element of Array.from(parent.querySelectorAll('p,ul,ol,li,pre'))) {
    if (!element.textContent.trim() && !element.querySelector('br')) element.remove();
  }
}

function extractHintText(body: Element, excludeCode: boolean): string {
  const clone = body.cloneNode(true) as Element;
  if (excludeCode) for (const code of Array.from(clone.querySelectorAll('pre'))) code.remove();
  for (const lineBreak of Array.from(clone.querySelectorAll('br'))) lineBreak.replaceWith('\n');
  for (const block of Array.from(clone.querySelectorAll('p,li,pre'))) block.append('\n');
  return normalizeDisplayText(clone.textContent);
}

function normalizeDisplayText(value: string): string {
  return value
    .replaceAll(/\u00a0/gu, ' ')
    .replaceAll(/[\t ]+\n/gu, '\n')
    .replaceAll(/\n[\t ]+/gu, '\n')
    .replaceAll(/\n{3,}/gu, '\n\n')
    .replaceAll(/[\t ]{2,}/gu, ' ')
    .trim();
}

function normalizeComparisonText(value: string): string {
  return value.normalize('NFKC').replaceAll(/\s+/gu, ' ').trim();
}

function summarizeHint(value: string): string {
  const text = normalizeComparisonText(value);
  const characters = Array.from(text);
  if (characters.length <= 96) return text;
  const punctuation = new Set(['。', '！', '？', '；', '.', '!', '?', ';']);
  for (let index = 31; index < Math.min(characters.length, 96); index += 1) {
    if (punctuation.has(characters[index] ?? '')) return characters.slice(0, index + 1).join('');
  }
  return `${characters.slice(0, 95).join('')}…`;
}

function displayFieldName(field: ProductSchemaField): string {
  return field.name.trim() || field.id.trim() || '未命名字段';
}

function appendUnique<T extends string>(values: T[], value: T): void {
  if (value && !values.includes(value)) values.push(value);
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
