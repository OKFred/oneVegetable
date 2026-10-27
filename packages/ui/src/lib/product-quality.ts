import type { ProductSchemaField, ProductSchemaModel } from '@one-vegetable/core';

/** Only navigate when an official message explicitly identifies one real field. */
export function productQualityFieldReferences(model: ProductSchemaModel, text: string): string[] {
  const matches = new Set<string>();
  const normalized = text.toLocaleLowerCase();
  function visit(field: ProductSchemaField): void {
    const names = [field.id, field.name].filter((name) => name.trim().length >= 3);
    if (
      names.some((name) => {
        const escaped = name.toLocaleLowerCase().replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
        return new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, 'u').test(normalized);
      })
    )
      matches.add(field.key);
    for (const child of field.children) visit(child);
    for (const instance of field.instances) for (const child of instance.fields) visit(child);
  }
  for (const field of model.fields) visit(field);
  return matches.size === 1 ? [...matches] : [];
}
