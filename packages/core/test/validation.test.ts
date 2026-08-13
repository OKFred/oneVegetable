import { readFile, readdir } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import {
  validateCapabilityCallInput,
  validateProductSchemaInput,
  validateSchemaPublishInput
} from '../src/validation';

describe('standalone OpenAPI validators', () => {
  it('contains no CSP-unsafe runtime code', async () => {
    const directory = new URL('../src/generated/', import.meta.url);
    const files = (await readdir(directory)).filter((file) => file.startsWith('validators-'));
    expect(files).toHaveLength(8);
    for (const file of files) {
      const source = await readFile(new URL(file, directory), 'utf8');
      expect(source, file).not.toMatch(/\brequire\(|\beval\(|new Function/);
    }
  });

  it('accepts a valid Schema publishing payload', () => {
    expect(
      validateSchemaPublishInput({ categoryId: 1, language: 'en_US', schemaXml: '<itemSchema />' }).valid
    ).toBe(true);
  });

  it('rejects empty Schema XML without runtime code generation', () => {
    const result = validateSchemaPublishInput({ categoryId: 1, language: 'en_US', schemaXml: '' });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('requires a known product market', () => {
    expect(
      validateProductSchemaInput({ categoryId: 1, language: 'en_US', market: 'unsupported' }).valid
    ).toBe(false);
  });

  it('requires capability parameters to be an object', () => {
    expect(validateCapabilityCallInput({ method: 'example', parameters: [] }).valid).toBe(false);
  });
});
