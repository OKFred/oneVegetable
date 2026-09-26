/** Reject accidental CommonJS barrel imports that bundle every AJV language. */
export function unsupportedValidationLocaleModule(id: string): boolean {
  const path = id.replaceAll('\\', '/').split('?')[0] ?? '';
  const marker = '/ajv-i18n/localize/';
  const index = path.lastIndexOf(marker);
  if (index < 0) return false;
  const localePath = path.slice(index + marker.length);
  return !/^(?:en|zh)\/index\.js$/.test(localePath);
}

export function extensionValidationLocalesPlugin() {
  return {
    name: 'one-vegetable-validation-locales',
    apply: 'build' as const,
    moduleParsed(module: { id: string }) {
      if (unsupportedValidationLocaleModule(module.id)) {
        throw new Error('Import AJV error translations directly from localize/en or localize/zh only.');
      }
    }
  };
}
