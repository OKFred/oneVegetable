import {
  cloneProductSchemaInstance,
  inspectProductSchemaPatchSerialization,
  isProductSchemaFieldReadOnly,
  parseProductSchemaXml,
  validateProductSchemaModel,
  withProductSchemaFieldText,
  type ProductSchemaField,
  type ProductSchemaInstance,
  type ProductSchemaModel
} from './product-schema';
import { isProductSchemaGroupField, productSchemaGroupLevel } from './product-editor';
import type { UiLocale } from './preferences';

export interface ProductBatchMaintenanceRules {
  groupPath: { id: number; name: string }[] | null;
  keywords: { action: 'append' | 'remove' | 'replace'; values: string[] } | null;
}
export interface ProductBatchMaintenancePreview {
  status: 'ready' | 'unchanged' | 'unsupported';
  baseline: string;
  rootIds: string[];
  before: { groups: string[]; keywords: string[] };
  after: { groups: string[]; keywords: string[] };
  patchXml: string;
  warnings: string[];
  reason: string | null;
}
export class ProductBatchMaintenanceError extends Error {}
const fail = (reason: string): never => {
  throw new ProductBatchMaintenanceError(reason);
};
const normalize = (value: string): string => value.trim().toLowerCase();
const keywordRoot = (field: ProductSchemaField): boolean =>
  /^(?:product)?keywords?$/iu.test(field.id.replace(/[_-]/gu, ''));
const effectiveChildren = (field: ProductSchemaField): ProductSchemaField[] =>
  field.instances[0]?.fields ?? field.children;

export function maintainKeywords(
  existing: string[],
  rule: NonNullable<ProductBatchMaintenanceRules['keywords']>
): string[] {
  const values: string[] = [];
  const seen = new Set<string>();
  for (const value of rule.values) {
    const text = value.trim();
    if (text && !seen.has(normalize(text))) {
      values.push(text);
      seen.add(normalize(text));
    }
  }
  if (values.length === 0) return fail('keywordsRequired');
  if (rule.action === 'replace') return values;
  if (rule.action === 'remove') return existing.filter((value) => !seen.has(normalize(value)));
  const original = new Set(existing.map(normalize));
  return [...existing, ...values.filter((value) => !original.has(normalize(value)))];
}

function editable(field: ProductSchemaField): void {
  if (isProductSchemaFieldReadOnly(field)) fail('readOnly');
}
function leaves(field: ProductSchemaField): ProductSchemaField[] {
  editable(field);
  if (field.type === 'input') return [field];
  if (field.type !== 'complex' || field.instances.length > 1 || !effectiveChildren(field).length)
    return fail('structure');
  return effectiveChildren(field).flatMap(leaves);
}
function readKeywords(field: ProductSchemaField): string[] {
  if (field.type === 'input' || field.type === 'multiInput')
    return field.values.map((v) => v.text).filter((v) => v.trim());
  const fields =
    field.type === 'multiComplex'
      ? field.instances.flatMap((item) => item.fields.flatMap(leaves))
      : leaves(field);
  if (fields.some((item) => item.values.length > 1)) fail('structure');
  return fields.flatMap((item) => item.values.map((v) => v.text)).filter((v) => v.trim());
}
function fillSlots(field: ProductSchemaField, next: () => string): ProductSchemaField {
  editable(field);
  if (field.type === 'input') return withProductSchemaFieldText(field, next());
  if (field.type !== 'complex' || field.instances.length > 1) return fail('structure');
  const instance = field.instances[0] ?? cloneProductSchemaInstance(field);
  return {
    ...field,
    instances: [{ ...instance, fields: instance.fields.map((child) => fillSlots(child, next)) }]
  };
}
function setKeywords(field: ProductSchemaField, texts: string[]): ProductSchemaField {
  editable(field);
  if (field.type === 'input' || field.type === 'multiInput') {
    if (field.type === 'input' && texts.length > 1) return fail('slots');
    // Keep value attributes with their original text when deleting/reordering values.
    const remaining = [...field.values];
    return {
      ...field,
      values: texts.map((text) => {
        const index = remaining.findIndex((v) => v.text === text);
        return (
          (index >= 0 ? remaining.splice(index, 1)[0] : undefined) ?? { text, attributes: {}, metadata: {} }
        );
      })
    };
  }
  if (field.type === 'multiComplex') {
    const template = field.instances[0]?.fields ?? field.children;
    if (template.flatMap(leaves).length !== 1) return fail('structure');
    const instances: ProductSchemaInstance[] = [];
    for (const [index, text] of texts.entries()) {
      const instance = field.instances[index] ?? cloneProductSchemaInstance({ ...field, instances });
      instances.push({ ...instance, fields: instance.fields.map((child) => fillSlots(child, () => text)) });
    }
    return { ...field, instances };
  }
  const slots = leaves(field);
  if (texts.length > slots.length) return fail('slots');
  let index = 0;
  return fillSlots(field, () => texts[index++] ?? '');
}
function readGroups(field: ProductSchemaField): string[] {
  if (field.type !== 'complex') return field.values.map((v) => v.text).filter(Boolean);
  return effectiveChildren(field)
    .filter((child) => productSchemaGroupLevel(child) !== null)
    .sort((a, b) => (productSchemaGroupLevel(a) ?? 0) - (productSchemaGroupLevel(b) ?? 0))
    .flatMap((child) => child.values.map((v) => v.text))
    .filter(Boolean);
}
function setGroups(
  field: ProductSchemaField,
  path: NonNullable<ProductBatchMaintenanceRules['groupPath']>
): ProductSchemaField {
  editable(field);
  if (!path.length || path.length > 3 || path.some((g) => !Number.isSafeInteger(g.id) || g.id <= 0))
    return fail('groupRequired');
  if (field.type === 'input' || field.type === 'singleCheck')
    return withProductSchemaFieldText(field, String(path.at(-1)?.id ?? fail('groupRequired')));
  if (field.type !== 'complex' || field.instances.length > 1) return fail('structure');
  const instance = field.instances[0] ?? cloneProductSchemaInstance(field);
  const levels = instance.fields.map(productSchemaGroupLevel);
  if (path.some((_, i) => !levels.includes((i + 1) as 1 | 2 | 3))) return fail('structure');
  return {
    ...field,
    instances: [
      {
        ...instance,
        fields: instance.fields.map((child) => {
          const level = productSchemaGroupLevel(child);
          if (level === null) return child;
          editable(child);
          const group = path[level - 1];
          return withProductSchemaFieldText(child, group ? String(group.id) : '');
        })
      }
    ]
  };
}
function semantic(field: ProductSchemaField): unknown {
  return {
    id: field.id,
    type: field.type,
    attributes: field.attributes,
    values: field.values,
    rules: field.rules,
    options: field.options,
    children: field.children.map(semantic),
    instances: field.instances.map((v) => v.fields.map(semantic)),
    valueLayout: field.valueLayout,
    complexLayout: field.complexLayout
  };
}
export async function productBatchTargetFingerprint(xml: string, rootIds: string[]): Promise<string> {
  const model = parseProductSchemaXml(xml);
  const fields = rootIds.map((id) => model.fields.filter((f) => f.id === id).map(semantic));
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(fields)));
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('');
}
export async function previewProductBatchMaintenance(
  xml: string,
  rules: ProductBatchMaintenanceRules,
  locale: UiLocale = 'zh-CN'
): Promise<ProductBatchMaintenancePreview> {
  const result: ProductBatchMaintenancePreview = {
    status: 'unsupported',
    baseline: '',
    rootIds: [],
    before: { groups: [], keywords: [] },
    after: { groups: [], keywords: [] },
    patchXml: '',
    warnings: [],
    reason: null
  };
  try {
    if (!rules.groupPath && !rules.keywords) fail('rulesRequired');
    const model = parseProductSchemaXml(xml, undefined, locale);
    const groups = model.fields.filter(isProductSchemaGroupField);
    const keywords = model.fields.filter(keywordRoot);
    if ((rules.groupPath && groups.length !== 1) || (rules.keywords && keywords.length !== 1))
      fail('missingField');
    const selected = [...(rules.groupPath ? groups : []), ...(rules.keywords ? keywords : [])];
    selected.forEach(editable);
    result.rootIds = selected.map((f) => f.id);
    if (new Set(result.rootIds).size !== selected.length) fail('structure');
    result.baseline = await productBatchTargetFingerprint(xml, result.rootIds);
    const updates = new Map<string, ProductSchemaField>();
    if (rules.groupPath && groups[0]) {
      result.before.groups = readGroups(groups[0]);
      const updated = setGroups(groups[0], rules.groupPath);
      result.after.groups = readGroups(updated);
      if (JSON.stringify(result.before.groups) !== JSON.stringify(result.after.groups))
        updates.set(groups[0].key, updated);
    }
    if (rules.keywords && keywords[0]) {
      result.before.keywords = readKeywords(keywords[0]);
      result.after.keywords = maintainKeywords(result.before.keywords, rules.keywords);
      if (JSON.stringify(result.before.keywords) !== JSON.stringify(result.after.keywords))
        updates.set(keywords[0].key, setKeywords(keywords[0], result.after.keywords));
    }
    const next: ProductSchemaModel = {
      ...model,
      fields: model.fields.map((f) => updates.get(f.key) ?? f),
      touchedFieldKeys: [...updates.keys()]
    };
    const inspection = inspectProductSchemaPatchSerialization(next, locale);
    if (!inspection.safe || inspection.changedFieldKeys.some((key) => !updates.has(key))) fail('unsafeXml');
    result.warnings = validateProductSchemaModel(next, locale)
      .filter((issue) => selected.some((f) => issue.fieldKey.startsWith(f.key)))
      .map((issue) => issue.message);
    result.patchXml = inspection.xml;
    result.status = inspection.noOp ? 'unchanged' : 'ready';
  } catch (error) {
    result.reason = error instanceof ProductBatchMaintenanceError ? error.message : 'unsafeXml';
    result.patchXml = '';
  }
  return result;
}
