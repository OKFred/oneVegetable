export type JsonSchema = Record<string, unknown>;

export function withAlibabaResponseMetadata(schema: JsonSchema): JsonSchema {
  const properties = isRecord(schema.properties) ? schema.properties : {};
  return {
    ...schema,
    properties: {
      ...properties,
      request_id: {
        type: 'string',
        description: 'Alibaba 网关返回的请求追踪 ID'
      }
    }
  };
}

export function applySchemaPatches(
  schema: JsonSchema,
  patches: Record<string, JsonSchema> | undefined
): JsonSchema {
  if (!patches) return schema;
  const result = structuredClone(schema);
  for (const [pointer, patch] of Object.entries(patches)) {
    const segments = parseJsonPointer(pointer);
    let parent: JsonSchema = result;
    for (const segment of segments.slice(0, -1)) {
      const child = parent[segment];
      if (!isRecord(child)) throw new Error(`Schema patch path does not exist: ${pointer}`);
      parent = child;
    }
    const key = segments.at(-1);
    if (!key || !Object.hasOwn(parent, key)) {
      throw new Error(`Schema patch path does not exist: ${pointer}`);
    }
    parent[key] = patch;
  }
  return result;
}

function parseJsonPointer(pointer: string): string[] {
  if (!pointer.startsWith('/')) throw new Error(`Schema patch must be a JSON Pointer: ${pointer}`);
  return pointer
    .slice(1)
    .split('/')
    .map((segment) => segment.replaceAll('~1', '/').replaceAll('~0', '~'));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
