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
    payloadFingerprint: await digest(schemaPatchXml),
    fieldExpectations
  };
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
    if ((await digest(canonicalFieldValue(field))) !== expectation.fingerprint) {
      mismatchedFieldIds.push(expectation.fieldId);
    }
  }
  return {
    matched: missingFieldIds.length === 0 && mismatchedFieldIds.length === 0,
    missingFieldIds,
    mismatchedFieldIds
  };
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
