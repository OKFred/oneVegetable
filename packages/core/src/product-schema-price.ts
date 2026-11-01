import {
  canonicalizeProductMaintenanceDraft,
  comparePriceReadback,
  type ProductMaintenanceReadback
} from './product-maintenance-api';
import { compareProductMaintenanceIntegrityFields } from './product-maintenance-integrity';
import {
  createProductMaintenanceBaselineFingerprint,
  createProductMaintenanceGuardedBaseline,
  type ProductMaintenanceBaseline
} from './product-maintenance-service';
import { productBatchTargetFingerprint } from './product-batch-maintenance';
import type { ProductReference } from './product-reference';
import { GatewayException } from './errors';
import {
  inspectProductSchemaPatchSerialization,
  isProductSchemaFieldReadOnly,
  parseProductSchemaXml,
  validateProductSchemaModel,
  withProductSchemaFieldText,
  type ProductSchemaField,
  type ProductSchemaXmlParser
} from './product-schema';

import {
  isProductSchemaPriceDraft as tiered,
  isProductSchemaPriceGuard,
  type ProductSchemaPriceGuard
} from './product-schema-price-guard';
export { isProductSchemaPriceGuard, type ProductSchemaPriceGuard } from './product-schema-price-guard';

function fail(reason: string): never {
  const code = 'PRODUCT_SCHEMA_PRICE_' + reason;
  throw new GatewayException({ code, message: code, retryable: false });
}
async function validatedGuard(value: unknown): Promise<ProductSchemaPriceGuard> {
  if (!isProductSchemaPriceGuard(value)) return fail('GUARD_INVALID');
  const guard = JSON.parse(JSON.stringify(value)) as ProductSchemaPriceGuard;
  if (
    guard.baseline.fingerprint !==
    (await createProductMaintenanceBaselineFingerprint(guard.baseline.productId, guard.baseline.fields))
  )
    return fail('GUARD_INVALID');
  return guard;
}
function editable(field: ProductSchemaField): void {
  if (
    isProductSchemaFieldReadOnly(field) ||
    field.rules.some(
      (rule) => ['readOnlyRule', 'disableRule'].includes(rule.name) && !['false', '0'].includes(rule.value)
    ) ||
    ['readOnly', 'readonly', 'disabled', 'disable'].some(
      (key) => field.attributes[key] !== undefined && !['false', '0'].includes(field.attributes[key] ?? '')
    )
  )
    fail('READ_ONLY');
}
function scalar(field: ProductSchemaField): string {
  editable(field);
  if (
    field.type !== 'input' ||
    field.values.length !== 1 ||
    field.instances.length ||
    field.children.length ||
    field.valueLayout === 'none'
  )
    return fail('SCHEMA_INVALID');
  return field.values[0]?.text ?? fail('SCHEMA_INVALID');
}
function rows(root: ProductSchemaField): ProductSchemaField[][] {
  editable(root);
  if (root.values.length) return fail('SCHEMA_INVALID');
  if (root.type === 'multiComplex' && root.instances.length)
    return root.instances.map((instance) => instance.fields);
  if (root.type !== 'complex' || root.instances.length !== 1) return fail('SCHEMA_INVALID');
  const slots = root.instances[0]?.fields.filter((field) => /^ladderPrice_[0-9]+$/u.test(field.id)) ?? [];
  if (!slots.length || new Set(slots.map((field) => field.id)).size !== slots.length)
    return fail('SCHEMA_INVALID');
  return slots.map((slot) => {
    editable(slot);
    if (slot.type !== 'complex' || slot.values.length || slot.instances.length !== 1)
      return fail('SCHEMA_INVALID');
    return slot.instances[0]?.fields ?? fail('SCHEMA_INVALID');
  });
}
function approved(reference: ProductReference): void {
  if (reference.auditStatus !== 'approved' || !['online', 'offline'].includes(reference.status ?? ''))
    fail('STATE_UNCONFIRMED');
}
function priceShape(reference: ProductReference): boolean {
  const price = reference.price;
  return price.type === 'TIERED' && price.currency === 'USD' && price.min === null && price.max === null;
}

/** Local-only TOP/IOP-neutral preparation. Never authorizes or dispatches a native mutation. */
export async function prepareProductSchemaPrice(
  xml: string,
  draft: unknown,
  reference: ProductReference,
  parser?: ProductSchemaXmlParser
): Promise<{ patchXml: string; fieldId: string; guard: ProductSchemaPriceGuard; unchanged: boolean }> {
  if (!tiered(draft)) return fail('INPUT_INVALID');
  const desired = JSON.parse(canonicalizeProductMaintenanceDraft(draft)) as ProductSchemaPriceGuard['draft'];
  approved(reference);
  if (!priceShape(reference)) return fail('PRICE_UNSUPPORTED');
  const modelNumber = reference.modelNumber;
  if (!modelNumber?.trim()) return fail('MODEL_UNAVAILABLE');
  let baseline: ProductMaintenanceBaseline;
  try {
    baseline = await createProductMaintenanceGuardedBaseline(desired, reference);
  } catch {
    return fail('BASELINE_UNAVAILABLE');
  }
  try {
    if (typeof xml !== 'string' || xml.length > 2_000_000 || /<!DOCTYPE\b/iu.test(xml))
      return fail('SCHEMA_INVALID');
    const document = (parser ?? new DOMParser()).parseFromString(xml, 'application/xml');
    const model = parseProductSchemaXml(xml, { parseFromString: () => document });
    // The model intentionally tolerates unknown XML; scalar values must not hide a second layout or nodes.
    const children = (node: Element, name: string) =>
      Array.from(node.children).filter((child) => child.localName === name);
    for (const field of Array.from(
      document.querySelectorAll(
        'field[id="ladderPrice"], field[id="ladderPrice"] field, field[id="modelNumber"]'
      )
    )) {
      const single = children(field, 'complex-value'),
        plural = children(field, 'complex-values');
      const wrappedInstances = plural.flatMap((node) => children(node, 'complex-value'));
      if (
        (single.length && plural.length) ||
        (wrappedInstances.length &&
          plural.some((node) => children(node, 'field').length || children(node, 'fields').length)) ||
        children(field, 'fields').length > 1 ||
        (children(field, 'fields').length && children(field, 'field').length)
      )
        return fail('SCHEMA_INVALID');
      if (!['quantity', 'price', 'modelNumber'].includes(field.getAttribute('id') ?? '')) continue;
      const direct = children(field, 'value'),
        wrappers = children(field, 'values');
      const wrapped = wrappers.flatMap((node) => children(node, 'value'));
      if (
        wrappers.length > 1 ||
        (direct.length && wrappers.length) ||
        [...direct, ...wrapped].some((node) =>
          Array.from(node.childNodes).some((child) => ![3, 4].includes(child.nodeType))
        )
      )
        return fail('SCHEMA_INVALID');
    }
    const roots = model.fields.filter((field) => field.id === 'ladderPrice');
    const root = roots[0];
    if (roots.length !== 1 || !root) return fail('SCHEMA_INVALID');
    const modelRoots = model.fields.filter((field) => field.id === 'modelNumber');
    const modelRoot = modelRoots[0];
    if (
      modelRoots.length !== 1 ||
      modelRoot?.type !== 'input' ||
      modelRoot.values.length > 1 ||
      modelRoot.children.length ||
      modelRoot.instances.length
    )
      return fail('SCHEMA_INVALID');
    editable(modelRoot);
    const renderedModel = modelRoot.values[0]?.text;
    if (renderedModel && renderedModel !== modelNumber) return fail('MODEL_REFERENCE_MISMATCH');
    // Templates are never edited; their read-only constraints still apply to instance values.
    const templates = (field: ProductSchemaField): void => {
      editable(field);
      field.children.forEach(templates);
    };
    templates(root);
    const slots = rows(root).map((fields) => {
      const quantities = fields.filter((field) => field.id === 'quantity');
      const prices = fields.filter((field) => field.id === 'price');
      const quantity = quantities[0],
        price = prices[0];
      if (quantities.length !== 1 || prices.length !== 1 || !quantity || !price)
        return fail('SCHEMA_INVALID');
      return { quantity: scalar(quantity), price: scalar(price), field: price };
    });
    if (slots.some((slot) => !/^[1-9][0-9]{0,18}$/u.test(slot.quantity))) return fail('SCHEMA_INVALID');
    const current = {
      ...desired,
      tiers: slots
        .map(({ quantity, price }) => ({ quantity, price }))
        .sort((a, b) =>
          BigInt(a.quantity) < BigInt(b.quantity) ? -1 : BigInt(a.quantity) > BigInt(b.quantity) ? 1 : 0
        )
    };
    if (!tiered(current)) return fail('SCHEMA_INVALID');
    if (
      current.tiers.length !== desired.tiers.length ||
      current.tiers.some((row, i) => row.quantity !== desired.tiers[i]?.quantity)
    )
      return fail('QUANTITIES_CHANGED');
    if (comparePriceReadback(current, reference).status !== 'matched') return fail('REFERENCE_MISMATCH');
    const updates = new Map<string, string>();
    for (const slot of slots) {
      const price =
        desired.tiers.find((row) => row.quantity === slot.quantity)?.price ?? fail('QUANTITIES_CHANGED');
      // Reuse exact decimal normalization in the baseline; equivalent spellings are a no-op.
      if (
        baseline.fields['price/tiers/' + slot.quantity] !==
        price.replace(/(\.[0-9]*?)0+$/u, '$1').replace(/\.$/u, '')
      )
        updates.set(slot.field.key, price);
    }
    const update = (field: ProductSchemaField): ProductSchemaField => {
      const expected =
        field.id === 'currency'
          ? desired.currency
          : field.id === 'unit'
            ? reference.unit
            : field.id === 'priceType'
              ? 'TIERED'
              : undefined;
      if (expected !== undefined && (field.values.length !== 1 || field.values[0]?.text !== expected))
        return fail('REFERENCE_MISMATCH');
      const price = updates.get(field.key);
      if (price !== undefined) return withProductSchemaFieldText(field, price);
      return {
        ...field,
        instances: field.instances.map((instance) => ({
          ...instance,
          fields: instance.fields.map(update)
        }))
      };
    };
    const next = {
      ...model,
      fields: model.fields.map((field) =>
        field === root
          ? update(field)
          : field === modelRoot && updates.size
            ? withProductSchemaFieldText(field, modelNumber)
            : field
      ),
      touchedFieldKeys: updates.size ? [root.key, modelRoot.key] : []
    };
    if (
      validateProductSchemaModel(next).some(
        (issue) => updates.has(issue.fieldKey) || issue.fieldKey === modelRoot.key
      )
    )
      return fail('SCHEMA_INVALID');
    const inspection = inspectProductSchemaPatchSerialization(next, undefined, ['modelNumber']);
    if (
      !inspection.safe ||
      inspection.changedFieldKeys.some((key) => key !== root.key && key !== modelRoot.key)
    )
      return fail('PATCH_UNSAFE');
    return {
      patchXml: inspection.xml,
      fieldId: 'ladderPrice',
      unchanged: inspection.noOp,
      guard: {
        version: 1,
        draft: desired,
        baseline,
        schemaFingerprint: await productBatchTargetFingerprint(xml, ['ladderPrice', 'modelNumber'])
      }
    };
  } catch (error) {
    if (error instanceof Error && /^PRODUCT_SCHEMA_PRICE_[A-Z_]+$/u.test(error.message)) throw error;
    return fail('SCHEMA_INVALID');
  }
}

export async function assertProductSchemaPriceUpdate(
  request: { productId: string; categoryId: number; schemaPatchXml: string; priceGuard?: unknown },
  xml: string,
  reference: ProductReference,
  parser?: ProductSchemaXmlParser
): Promise<ProductSchemaPriceGuard> {
  const { productId, categoryId, schemaPatchXml, priceGuard } = request;
  const guard = await validatedGuard(priceGuard);
  if (
    productId !== guard.draft.productId ||
    !Number.isSafeInteger(categoryId) ||
    categoryId <= 0 ||
    String(categoryId) !== reference.categoryId
  )
    return fail('IDENTITY_MISMATCH');
  const preview = await prepareProductSchemaPrice(xml, guard.draft, reference, parser);
  if (
    preview.guard.baseline.fingerprint !== guard.baseline.fingerprint ||
    preview.guard.schemaFingerprint !== guard.schemaFingerprint
  )
    return fail('BASELINE_CHANGED');
  const submitted = canonicalPatchXml(schemaPatchXml);
  if (preview.unchanged || !submitted || submitted !== canonicalPatchXml(preview.patchXml))
    return fail('PATCH_MISMATCH');
  return preview.guard;
}

function canonicalPatchXml(xml: string): string | null {
  if (typeof xml !== 'string' || xml.length > 2_000_000 || /<!DOCTYPE\b/iu.test(xml)) return null;
  // Normalize only empty-tag spacing outside quoted values, comments and CDATA.
  // Everything else must still exactly match the freshly generated safe patch.
  let result = '',
    offset = 0;
  while (offset < xml.length) {
    const start = xml.indexOf('<', offset);
    if (start < 0) return result + xml.slice(offset);
    result += xml.slice(offset, start);
    const terminator = xml.startsWith('<!--', start)
      ? '-->'
      : xml.startsWith('<![CDATA[', start)
        ? ']]>'
        : null;
    if (terminator) {
      const end = xml.indexOf(terminator, start + 4);
      if (end < 0) return null;
      offset = end + terminator.length;
      result += xml.slice(start, offset);
      continue;
    }
    let quote: string | null = null,
      end = start + 1;
    for (; end < xml.length; end++) {
      const char = xml[end];
      if (quote) {
        if (char === quote) quote = null;
      } else if (char === '"' || char === "'") quote = char;
      else if (char === '>') break;
    }
    if (end >= xml.length) return null;
    result += xml.slice(start, end + 1).replace(/[ \t\r\n]+\/>$/u, '/>');
    offset = end + 1;
  }
  return result;
}

export async function checkProductSchemaPriceReadback(
  guard: unknown,
  reference: ProductReference
): Promise<ProductMaintenanceReadback> {
  const valid = await validatedGuard(guard);
  try {
    // Review snapshots can omit otherwise populated fields; wait for an approved
    // snapshot before classifying those omissions as non-target changes.
    const state = [];
    if (reference.auditStatus !== 'approved') state.push('auditStatus');
    if (!['online', 'offline'].includes(reference.status ?? '')) state.push('productStatus');
    if (state.length) return { status: 'unavailable', mismatchedFields: [], unavailableFields: state };
    const price = comparePriceReadback(valid.draft, reference);
    const integrity = await compareProductMaintenanceIntegrityFields(
      valid.baseline.fields,
      valid.draft,
      reference
    );
    const mismatchedFields = [...price.mismatchedFields, ...integrity.mismatchedFields];
    const unavailableFields = [...price.unavailableFields, ...integrity.unavailableFields];
    if (!priceShape(reference)) unavailableFields.push('price');
    return {
      status: unavailableFields.length ? 'unavailable' : mismatchedFields.length ? 'mismatched' : 'matched',
      mismatchedFields,
      unavailableFields
    };
  } catch {
    return { status: 'unavailable', mismatchedFields: [], unavailableFields: ['readback'] };
  }
}
