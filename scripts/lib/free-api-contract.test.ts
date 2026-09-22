import { describe, expect, it } from 'vitest';
import {
  freeApiExample,
  freeApiNodeSchema,
  freeApiObjectSchema,
  freeApiSchemaName,
  shareFreeApiSchemas,
  type FreeApiParam
} from './free-api-contract';

const node: FreeApiParam = {
  name: 'items',
  type: 'InventoryDTO []',
  required: true,
  description: 'Items',
  subParams: [
    { name: 'quantity', type: 'Number', required: true, description: '', minValue: 1, demoValue: 'invalid' }
  ]
};
describe('free API document conversion', () => {
  it('shares identical nested array items deterministically across method schemas', () => {
    const schemas: Record<string, Record<string, unknown>> = {
      AlibabaFreeApiTestResponse: freeApiObjectSchema([node], true),
      AlibabaFreeApiSecondResponse: freeApiObjectSchema([node], true)
    };
    shareFreeApiSchemas(schemas);
    const values = Object.values(schemas);
    expect(
      values.filter((schema) => JSON.stringify(schema.properties ?? {}).includes('"quantity"'))
    ).toHaveLength(1);
    expect(values.some((schema) => schema.type === 'array')).toBe(true);
    const before = JSON.stringify(schemas);
    const fresh: Record<string, Record<string, unknown>> = {
      AlibabaFreeApiTestResponse: freeApiObjectSchema([node], true),
      AlibabaFreeApiSecondResponse: freeApiObjectSchema([node], true)
    };
    shareFreeApiSchemas(fresh);
    expect(JSON.stringify(fresh)).toBe(before);
  });
  it('keeps strict required nested arrays and deterministic valid examples', () => {
    expect(freeApiObjectSchema([node])).toMatchObject({
      required: ['items'],
      additionalProperties: false,
      properties: {
        items: {
          type: 'array',
          items: { required: ['quantity'], properties: { quantity: { type: 'number', minimum: 1 } } }
        }
      }
    });
    expect(freeApiExample([node])).toEqual({ items: [{ quantity: 1 }] });
  });
  it('models the configured simplify=true transport rather than guessing DTO wrapper names', () => {
    expect(freeApiNodeSchema(node, true)).toMatchObject({ type: 'array' });
    expect(freeApiNodeSchema(node)).not.toHaveProperty('anyOf');
  });
  it('does not put string length constraints on numbers', () => {
    expect(
      freeApiNodeSchema({ name: 'count', type: 'Number', required: false, description: '', maxLength: 10 })
    ).toEqual({ type: 'number' });
  });
  it('preserves booleans, dates, primitive arrays and rejects magic placeholders as numbers', () => {
    expect(
      freeApiExample([
        { name: 'ids', type: 'Number[]', required: true, description: '', demoValue: '[1,2]' },
        { name: 'enabled', type: 'Boolean', required: false, description: '', demoValue: 'true' }
      ])
    ).toEqual({ ids: [1, 2], enabled: true });
    expect(freeApiNodeSchema({ name: 'time', type: 'Date', required: false, description: '' })).toEqual({
      type: ['integer', 'string']
    });
    expect(freeApiSchemaName('alibaba.icbu.product.id.encrypt')).toBe(
      'AlibabaFreeApiAlibabaIcbuProductIdEncrypt'
    );
  });
});
