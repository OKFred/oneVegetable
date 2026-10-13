import { parseProductSchemaXml } from './product-schema';

import type { ProductMutationFieldExpectation } from './product-mutation-job';
import type {
  ProductSchemaField,
  ProductSchemaInstance,
  ProductSchemaValue,
  ProductSchemaXmlParser
} from './product-schema';

export interface ProductMutationFingerprintSet {
  payloadFingerprint: string;
  fieldExpectations: ProductMutationFieldExpectation[];
}

export interface ProductMutationFingerprintComparison {
  matched: boolean;
  missingFieldIds: string[];
  mismatchedFieldIds: string[];
}

export async function createProductMutationFingerprints(
  schemaPatchXml: string,
  parser?: ProductSchemaXmlParser
): Promise<ProductMutationFingerprintSet> {
  const model = parseProductSchemaXml(schemaPatchXml, parser);
  if (model.fields.length === 0) throw new Error('商品增量 XML 不包含字段');
  const fieldIds = new Set<string>();
  const fieldExpectations: ProductMutationFieldExpectation[] = [];
  for (const field of model.fields) {
    const fieldId = field.id.trim();
    if (!fieldId || fieldIds.has(fieldId)) throw new Error('商品增量 XML 的根字段 ID 无效或重复');
    fieldIds.add(fieldId);
    fieldExpectations.push({
      fieldId,
      fingerprint: await digest(canonicalFieldValue(field))
    });
  }
  return {
    payloadFingerprint: await createProductMutationPayloadFingerprint(schemaPatchXml),
    fieldExpectations
  };
}

export function createProductMutationPayloadFingerprint(schemaPatchXml: string): Promise<string> {
  return digest(schemaPatchXml);
}

export async function compareProductMutationFingerprints(
  renderedSchemaXml: string,
  expectations: readonly ProductMutationFieldExpectation[],
  parser?: ProductSchemaXmlParser
): Promise<ProductMutationFingerprintComparison> {
  const model = parseProductSchemaXml(renderedSchemaXml, parser);
  const renderedFields = new Map(model.fields.map((field) => [field.id, field] as const));
  const missingFieldIds: string[] = [];
  const mismatchedFieldIds: string[] = [];
  for (const expectation of expectations) {
    const field = renderedFields.get(expectation.fieldId);
    if (!field) {
      missingFieldIds.push(expectation.fieldId);
      continue;
    }
    if (!(await fieldFingerprintMatches(field, expectation.fingerprint))) {
      mismatchedFieldIds.push(expectation.fieldId);
    }
  }
  return {
    matched: missingFieldIds.length === 0 && mismatchedFieldIds.length === 0,
    missingFieldIds,
    mismatchedFieldIds
  };
}

async function fieldFingerprintMatches(field: ProductSchemaField, expected: string): Promise<boolean> {
  if ((await digest(canonicalFieldValue(field))) === expected) return true;
  // Alibaba omits unused declared group-path slots in its rendered complex value.
  // Keep existing receipts/hashes compatible without accepting a changed nonempty ID.
  const ids = ['first_group_id', 'second_group_id', 'third_group_id'];
  const empty = (item: ProductSchemaField): boolean =>
    item.type === 'input' &&
    item.children.length === 0 &&
    item.instances.length === 0 &&
    item.values.every((value) => value.text === '' && Object.keys(value.attributes).length === 0);
  if (
    field.id !== 'productGroup' ||
    field.type !== 'complex' ||
    field.instances.length > 1 ||
    field.children.length !== 3 ||
    field.children.some((item, index) => item.id !== ids[index] || !empty(item))
  )
    return false;
  const actual = field.instances[0]?.fields ?? [];
  if (
    new Set(actual.map((item) => item.id)).size !== actual.length ||
    actual.some(
      (item) =>
        !ids.includes(item.id) ||
        item.type !== 'input' ||
        item.children.length !== 0 ||
        item.instances.length !== 0
    )
  )
    return false;
  if (
    actual
      .map((item) => ids.indexOf(item.id))
      .some((index, position, order) => position > 0 && index <= (order[position - 1] ?? -1))
  )
    return false;
  const slots = field.children.map((template) => actual.find((item) => item.id === template.id) ?? template);
  const optional = slots.flatMap((item, index) => (empty(item) ? [index] : []));
  for (let mask = 0; mask < 3 ** optional.length; mask++) {
    const fields = slots.flatMap((item, index) => {
      const bit = optional.indexOf(index);
      if (bit < 0) return [item];
      const representation = Math.floor(mask / 3 ** bit) % 3;
      return representation === 0
        ? []
        : [{ ...item, values: representation === 1 ? [] : [{ text: '', attributes: {}, metadata: {} }] }];
    });
    const candidate = {
      ...field,
      instances: [{ key: field.instances[0]?.key ?? '', sourcePath: null, sourceIndex: null, fields }]
    };
    if ((await digest(canonicalFieldValue(candidate))) === expected) return true;
  }
  return actual.every(empty) && (await digest(canonicalFieldValue({ ...field, instances: [] }))) === expected;
}

function canonicalFieldValue(field: ProductSchemaField): string {
  return JSON.stringify({
    id: field.id,
    type: field.type,
    values: field.values.map(canonicalValue),
    children: field.children.map(canonicalFieldObject),
    instances: field.instances.map(canonicalInstance)
  });
}

function canonicalFieldObject(field: ProductSchemaField): object {
  return {
    id: field.id,
    type: field.type,
    values: field.values.map(canonicalValue),
    children: field.children.map(canonicalFieldObject),
    instances: field.instances.map(canonicalInstance)
  };
}

function canonicalInstance(instance: ProductSchemaInstance): object {
  return { fields: instance.fields.map(canonicalFieldObject) };
}

function canonicalValue(value: ProductSchemaValue): object {
  return {
    text: value.text,
    attributes: Object.fromEntries(
      Object.entries(value.attributes).toSorted(([left], [right]) => left.localeCompare(right))
    )
  };
}

async function digest(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...hash].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
