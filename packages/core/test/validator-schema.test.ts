import Ajv from 'ajv/dist/2020';
import { describe, expect, it } from 'vitest';
import { validationSchema } from '../../../scripts/lib/validator-schema';

describe('standalone validation schema annotations', () => {
  it('removes only documentation and preserves business properties and literal values', () => {
    const schema = {
      type: 'object',
      description: 'Documentation only',
      required: ['title', 'description'],
      additionalProperties: false,
      properties: {
        title: { type: 'string', minLength: 1, description: 'Title help' },
        description: { type: 'object', const: { description: 'Literal business value' } },
        examples: { type: 'array', items: { type: 'integer', minimum: 2, title: 'Example help' } }
      }
    };
    const stripped = validationSchema(schema);
    expect(JSON.stringify(stripped)).not.toContain('Documentation only');
    expect(JSON.stringify(stripped)).not.toContain('Example help');
    expect(JSON.stringify(stripped)).toContain('Literal business value');
    const original = new Ajv({ allErrors: true }).compile(schema);
    const compact = new Ajv({ allErrors: true }).compile(stripped as object);
    for (const data of [
      {},
      { title: '', description: {} },
      { title: 'a', description: { description: 'Literal business value' }, examples: [2, 3] },
      { title: 'a', description: { description: 'wrong' }, examples: [0], extra: true }
    ]) {
      expect(compact(data)).toBe(original(data));
      expect(compact.errors).toEqual(original.errors);
    }
  });
});
