import { describe, expect, it } from 'vitest';
import { validateProductSchemaUpdateRequest } from '../src/generated/validators-core';

const validate = validateProductSchemaUpdateRequest as {
  (value: unknown): boolean;
  errors?: { keyword: string; params: Record<string, unknown> }[] | null;
};
const valid = { productId: '1000000', categoryId: 123, language: 'en_US', schemaPatchXml: '<itemSchema />' };
const entries = Object.entries(valid);

describe('compact standalone required loops', () => {
  it.each(Array.from({ length: 16 }, (_, mask) => mask))(
    'retains all missing-field errors for subset %s',
    (mask) => {
      const input = Object.fromEntries(entries.filter((_, index) => mask & (1 << index)));
      const missing = entries.filter((_, index) => !(mask & (1 << index))).map(([key]) => key);
      expect(validate(input)).toBe(missing.length === 0);
      expect(
        (validate.errors ?? [])
          .filter((error) => error.keyword === 'required')
          .map((error) => error.params.missingProperty)
      ).toEqual(missing);
    }
  );
});
