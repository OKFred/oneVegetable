import { describe, expect, it } from 'vitest';
import {
  extensionValidationLocalesPlugin,
  unsupportedValidationLocaleModule
} from './extension-validation-locales';

describe('extension validation locale budget guard', () => {
  it.each([
    '/repo/node_modules/ajv-i18n/localize/index.js',
    'D:\\repo\\node_modules\\ajv-i18n\\localize\\de\\index.js',
    '\0/repo/node_modules/.pnpm/ajv-i18n@4.2.0/node_modules/ajv-i18n/localize/fr/index.js?commonjs-proxy',
    '/repo/node_modules/ajv-i18n/localize/en/jtd.js'
  ])('rejects unneeded locale entry: %s', (id) => {
    expect(unsupportedValidationLocaleModule(id)).toBe(true);
    expect(() => {
      extensionValidationLocalesPlugin().moduleParsed({ id });
    }).toThrow('directly');
  });

  it.each([
    '/repo/node_modules/ajv-i18n/localize/en/index.js',
    'D:\\repo\\node_modules\\ajv-i18n\\localize\\zh\\index.js?commonjs-proxy',
    '/repo/packages/core/src/validation/index.ts',
    '/repo/node_modules/another-package/localize/index.js'
  ])('permits the supported locales and unrelated modules: %s', (id) => {
    expect(unsupportedValidationLocaleModule(id)).toBe(false);
    expect(() => {
      extensionValidationLocalesPlugin().moduleParsed({ id });
    }).not.toThrow();
  });
});
