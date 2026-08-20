import { describe, expect, it } from 'vitest';

import { applySchemaPatches, withAlibabaResponseMetadata } from './alibaba-response-contract';

describe('Alibaba response contract helpers', () => {
  it('adds optional gateway request metadata without weakening the schema', () => {
    expect(
      withAlibabaResponseMetadata({
        type: 'object',
        additionalProperties: false,
        required: ['data'],
        properties: { data: { type: 'string' } }
      })
    ).toEqual({
      type: 'object',
      additionalProperties: false,
      required: ['data'],
      properties: {
        data: { type: 'string' },
        request_id: { type: 'string', description: 'Alibaba 网关返回的请求追踪 ID' }
      }
    });
  });

  it('applies explicit real-response schema corrections by JSON Pointer', () => {
    const source = {
      type: 'object',
      properties: {
        category: {
          type: 'object',
          properties: { child_ids: { type: 'array', items: { type: 'string' } } }
        }
      }
    };
    const result = applySchemaPatches(source, {
      '/properties/category/properties/child_ids/items': { type: ['number', 'string'] }
    });

    expect(result).not.toBe(source);
    expect(((result.properties as JsonSchema).category as JsonSchema).properties).toEqual({
      child_ids: { type: 'array', items: { type: ['number', 'string'] } }
    });
  });
});

type JsonSchema = Record<string, unknown>;
