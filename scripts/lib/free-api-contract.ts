import type { JsonSchema } from './alibaba-response-contract';
import { createHash } from 'node:crypto';

export interface FreeApiParam {
  name: string;
  type: string;
  required: boolean;
  description: string;
  demoValue?: string;
  defaultValue?: string;
  minValue?: number;
  maxValue?: number;
  maxLength?: number;
  maxListSize?: number;
  subParams?: FreeApiParam[];
}

export function freeApiSchemaName(method: string): string {
  return `AlibabaFreeApi${method
    .split('.')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')}`;
}

export function freeApiObjectSchema(nodes: FreeApiParam[], response = false): JsonSchema {
  const required = nodes.filter((node) => node.required).map((node) => node.name);
  return {
    type: 'object',
    additionalProperties: false,
    ...(required.length ? { required } : {}),
    properties: Object.fromEntries(nodes.map((node) => [node.name, freeApiNodeSchema(node, response)]))
  };
}

export function freeApiNodeSchema(node: FreeApiParam, response = false): JsonSchema {
  const rawType = node.type.replaceAll(' ', '');
  const base = rawType.replace(/\[\]$/, '');
  const type = base.toLowerCase();
  const children = node.subParams ?? [];
  let schema: JsonSchema = children.length
    ? freeApiObjectSchema(children, response)
    : ['number', 'long', 'integer', 'double', 'float'].includes(type)
      ? { type: 'number' }
      : type === 'boolean'
        ? { type: 'boolean' }
        : type === 'date'
          ? { type: ['integer', 'string'] }
          : ['json', 'object', 'map'].includes(type)
            ? { type: 'object', additionalProperties: true }
            : { type: 'string' };
  if (schema.type === 'number') {
    if (node.minValue !== undefined) schema.minimum = node.minValue;
    if (node.maxValue !== undefined) schema.maximum = node.maxValue;
  }
  if (schema.type === 'string' && node.maxLength !== undefined) schema.maxLength = node.maxLength;
  if (rawType.endsWith('[]')) {
    const array = {
      type: 'array',
      items: schema,
      ...(node.maxListSize !== undefined ? { maxItems: node.maxListSize } : {})
    };
    // Network signing always requests simplify=true. Do not guess wrapper names
    // from Java DTO names; provider deviations belong in documented overrides.
    schema = array;
  }
  return { ...schema, ...(node.description ? { description: node.description } : {}) };
}

export function freeApiExample(nodes: FreeApiParam[]): Record<string, unknown> {
  return Object.fromEntries(nodes.map((node) => [node.name, example(node)]));
}

/** Share nested response structures without weakening their validation assertions. */
export function shareFreeApiSchemas(schemas: Record<string, JsonSchema>): void {
  const shared = new Map<string, JsonSchema>();
  function visit(schema: JsonSchema, root = false): JsonSchema {
    const result: JsonSchema = { ...schema };
    if (schema.properties && typeof schema.properties === 'object') {
      result.properties = Object.fromEntries(
        Object.entries(schema.properties).map(([name, child]) => [name, visit(child as JsonSchema)])
      );
    }
    if (schema.items && typeof schema.items === 'object') result.items = visit(schema.items as JsonSchema);
    for (const key of ['anyOf', 'oneOf', 'allOf']) {
      if (Array.isArray(schema[key]))
        result[key] = (schema[key] as JsonSchema[]).map((child) => visit(child));
    }
    if (!root && (result.properties || result.items || result.anyOf)) {
      const name = `AlibabaFreeApiShared${createHash('sha256').update(JSON.stringify(result)).digest('hex').slice(0, 20)}`;
      shared.set(name, result);
      return { $ref: `#/components/schemas/${name}` };
    }
    return result;
  }
  for (const name of Object.keys(schemas).filter((name) => name.startsWith('AlibabaFreeApi'))) {
    const schema = schemas[name];
    if (schema) schemas[name] = visit(schema, true);
  }
  for (const [name, schema] of shared) schemas[name] = schema;
}

function example(node: FreeApiParam): unknown {
  const type = node.type.replaceAll(' ', '').replace(/\[\]$/, '').toLowerCase();
  const array = /\[\]\s*$/.test(node.type);
  if (node.subParams?.length) {
    const value = freeApiExample(node.subParams);
    return array ? [value] : value;
  }
  const text = node.demoValue ?? node.defaultValue ?? '';
  const scalar = (input: string): unknown => {
    if (['number', 'long', 'integer', 'double', 'float'].includes(type)) {
      const number = input.trim() ? Number(input) : NaN;
      return Math.min(
        node.maxValue ?? Number.MAX_SAFE_INTEGER,
        Math.max(node.minValue ?? 0, Number.isFinite(number) ? number : 1)
      );
    }
    if (type === 'boolean') return input === 'true';
    if (['json', 'object', 'map'].includes(type)) return {};
    return (input || 'example').slice(0, node.maxLength ?? Number.MAX_SAFE_INTEGER);
  };
  if (!array) return scalar(text);
  try {
    const parsed: unknown = JSON.parse(text);
    if (Array.isArray(parsed))
      return parsed.map((value: unknown) => scalar(String(value))).slice(0, node.maxListSize);
  } catch {
    /* Invalid official examples are replaced by deterministic contract examples, never real requests. */
  }
  return [scalar(text)].slice(0, node.maxListSize);
}
