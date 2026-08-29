import type { ProductSchemaXmlParser } from './product-schema';

export const PRODUCT_SCHEMA_JSON_FORMAT = 'one-vegetable-product-schema';
export const PRODUCT_SCHEMA_JSON_VERSION = 1;

export interface ProductSchemaJsonDocument {
  format: typeof PRODUCT_SCHEMA_JSON_FORMAT;
  schemaVersion: typeof PRODUCT_SCHEMA_JSON_VERSION;
  root: ProductSchemaJsonElement;
}

export interface ProductSchemaJsonElement {
  type: 'element';
  name: string;
  attributes: Record<string, string>;
  children: ProductSchemaJsonNode[];
}

export type ProductSchemaJsonNode =
  | ProductSchemaJsonElement
  | { type: 'text'; value: string }
  | { type: 'cdata'; value: string }
  | { type: 'comment'; value: string }
  | { type: 'processingInstruction'; target: string; data: string };

const MAX_SCHEMA_JSON_DEPTH = 128;
const MAX_SCHEMA_JSON_NODES = 100_000;
const XML_NAME = /^[A-Za-z_][A-Za-z0-9_.:-]*$/u;

export function productSchemaXmlToJson(
  xml: string,
  parser?: ProductSchemaXmlParser
): ProductSchemaJsonDocument {
  if (/<!DOCTYPE\b/iu.test(xml)) throw new Error('商品 Schema XML 不允许包含 DOCTYPE');
  const document = (parser ?? new DOMParser()).parseFromString(xml, 'application/xml');
  const parserError = document.querySelector('parsererror');
  if (parserError) throw new Error(`商品 Schema XML 无法解析：${parserError.textContent}`);
  const root = document.documentElement;
  const state = { nodes: 0 };
  return {
    format: PRODUCT_SCHEMA_JSON_FORMAT,
    schemaVersion: PRODUCT_SCHEMA_JSON_VERSION,
    root: elementToJson(root, state, 0)
  };
}

export function productSchemaJsonToXml(value: unknown): string {
  const document = normalizeProductSchemaJson(value);
  return serializeElement(document.root, 0);
}

export function normalizeProductSchemaJson(value: unknown): ProductSchemaJsonDocument {
  const parsed = parseJsonString(value);
  const record = requireRecord(parsed, '商品 Schema JSON 必须是对象');
  if (record.format !== PRODUCT_SCHEMA_JSON_FORMAT) {
    throw new Error('商品 Schema JSON 格式无效');
  }
  if (record.schemaVersion !== PRODUCT_SCHEMA_JSON_VERSION) {
    throw new Error(`不支持的商品 Schema JSON 版本：${displayValue(record.schemaVersion)}`);
  }
  const state = { nodes: 0 };
  return {
    format: PRODUCT_SCHEMA_JSON_FORMAT,
    schemaVersion: PRODUCT_SCHEMA_JSON_VERSION,
    root: normalizeElement(record.root, state, 0)
  };
}

export function resolveProductSchemaXml(value: unknown): string | null {
  return resolveProductSchemaXmlValue(value, new WeakSet<object>(), 0);
}

function resolveProductSchemaXmlValue(value: unknown, seen: WeakSet<object>, depth: number): string | null {
  if (depth > 8) return null;
  if (typeof value === 'string') return resolveStringPayload(value);
  if (!isRecord(value)) return null;
  if (seen.has(value)) return null;
  seen.add(value);

  for (const key of ['schemaXml', 'schema_xml', 'xml', 'data', 'result']) {
    const candidate = value[key];
    const resolved = resolveProductSchemaXmlValue(candidate, seen, depth + 1);
    if (resolved) return resolved;
  }

  for (const key of ['schemaJson', 'schema_json']) {
    const candidate = value[key];
    if (candidate === undefined || candidate === null || candidate === '') continue;
    return productSchemaJsonToXml(candidate);
  }

  if (value.format === PRODUCT_SCHEMA_JSON_FORMAT) return productSchemaJsonToXml(value);
  return null;
}

function elementToJson(element: Element, state: { nodes: number }, depth: number): ProductSchemaJsonElement {
  countNode(state, depth);
  const attributes = Object.fromEntries(
    Array.from(element.attributes, (attribute) => [attribute.name, attribute.value])
  );
  const children = Array.from(element.childNodes, (node) => nodeToJson(node, state, depth + 1)).filter(
    (node): node is ProductSchemaJsonNode => node !== null
  );
  return { type: 'element', name: element.tagName, attributes, children };
}

function nodeToJson(node: Node, state: { nodes: number }, depth: number): ProductSchemaJsonNode | null {
  switch (node.nodeType) {
    case 1:
      return elementToJson(node as Element, state, depth);
    case 3:
      countNode(state, depth);
      return { type: 'text', value: node.nodeValue ?? '' };
    case 4:
      countNode(state, depth);
      return { type: 'cdata', value: node.nodeValue ?? '' };
    case 7: {
      countNode(state, depth);
      const instruction = node as ProcessingInstruction;
      return { type: 'processingInstruction', target: instruction.target, data: instruction.data };
    }
    case 8:
      countNode(state, depth);
      return { type: 'comment', value: node.nodeValue ?? '' };
    default:
      return null;
  }
}

function normalizeElement(value: unknown, state: { nodes: number }, depth: number): ProductSchemaJsonElement {
  countNode(state, depth);
  const record = requireRecord(value, '商品 Schema JSON 节点必须是对象');
  if (record.type !== 'element') throw new Error('商品 Schema JSON 根节点必须是 element');
  const name = requireXmlName(record.name, '商品 Schema JSON 元素名称无效');
  const attributesRecord = requireRecord(record.attributes, '商品 Schema JSON attributes 必须是对象');
  const attributes: Record<string, string> = {};
  for (const [attributeName, attributeValue] of Object.entries(attributesRecord)) {
    const normalizedName = requireXmlName(attributeName, '商品 Schema JSON 属性名称无效');
    if (typeof attributeValue !== 'string') throw new Error('商品 Schema JSON 属性值必须是字符串');
    attributes[normalizedName] = attributeValue;
  }
  if (!Array.isArray(record.children)) throw new Error('商品 Schema JSON children 必须是数组');
  return {
    type: 'element',
    name,
    attributes,
    children: record.children.map((child) => normalizeNode(child, state, depth + 1))
  };
}

function normalizeNode(value: unknown, state: { nodes: number }, depth: number): ProductSchemaJsonNode {
  const record = requireRecord(value, '商品 Schema JSON 子节点必须是对象');
  if (record.type === 'element') return normalizeElement(record, state, depth);
  countNode(state, depth);
  if (record.type === 'text' || record.type === 'cdata' || record.type === 'comment') {
    if (typeof record.value !== 'string') throw new Error('商品 Schema JSON 节点值必须是字符串');
    if (record.type === 'comment' && (record.value.includes('--') || record.value.endsWith('-'))) {
      throw new Error('商品 Schema JSON 注释内容无效');
    }
    return { type: record.type, value: record.value };
  }
  if (record.type === 'processingInstruction') {
    const target = requireXmlName(record.target, '商品 Schema JSON 处理指令名称无效');
    if (target.toLowerCase() === 'xml') throw new Error('商品 Schema JSON 不允许 XML 处理指令');
    if (typeof record.data !== 'string' || record.data.includes('?>')) {
      throw new Error('商品 Schema JSON 处理指令内容无效');
    }
    return { type: 'processingInstruction', target, data: record.data };
  }
  throw new Error(`商品 Schema JSON 节点类型无效：${displayValue(record.type)}`);
}

function serializeElement(element: ProductSchemaJsonElement, depth: number): string {
  if (depth > MAX_SCHEMA_JSON_DEPTH) throw new Error('商品 Schema JSON 嵌套层级过深');
  const attributes = Object.entries(element.attributes)
    .map(([name, value]) => ` ${name}="${escapeXmlAttribute(value)}"`)
    .join('');
  if (element.children.length === 0) return `<${element.name}${attributes}/>`;
  return `<${element.name}${attributes}>${element.children
    .map((child) => serializeNode(child, depth + 1))
    .join('')}</${element.name}>`;
}

function serializeNode(node: ProductSchemaJsonNode, depth: number): string {
  switch (node.type) {
    case 'element':
      return serializeElement(node, depth);
    case 'text':
      return escapeXmlText(node.value);
    case 'cdata':
      return `<![CDATA[${node.value.replaceAll(']]>', ']]]]><![CDATA[>')}]]>`;
    case 'comment':
      return `<!--${node.value}-->`;
    case 'processingInstruction':
      return `<?${node.target}${node.data === '' ? '' : ` ${node.data}`}?>`;
  }
}

function resolveStringPayload(value: string): string | null {
  const normalized = value.trim();
  if (normalized === '') return null;
  if (normalized.startsWith('<')) return normalized;
  if (normalized.startsWith('{')) return productSchemaJsonToXml(normalized);
  return null;
}

function parseJsonString(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new Error('商品 Schema JSON 不是有效 JSON');
  }
}

function countNode(state: { nodes: number }, depth: number): void {
  if (depth > MAX_SCHEMA_JSON_DEPTH) throw new Error('商品 Schema JSON 嵌套层级过深');
  state.nodes += 1;
  if (state.nodes > MAX_SCHEMA_JSON_NODES) throw new Error('商品 Schema JSON 节点数量过多');
}

function requireXmlName(value: unknown, message: string): string {
  if (typeof value !== 'string' || !XML_NAME.test(value)) throw new Error(message);
  return value;
}

function requireRecord(value: unknown, message: string): Record<string, unknown> {
  if (!isRecord(value) || Array.isArray(value)) throw new Error(message);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function escapeXmlText(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function escapeXmlAttribute(value: string): string {
  return escapeXmlText(value).replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}

function displayValue(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  return '未知';
}
