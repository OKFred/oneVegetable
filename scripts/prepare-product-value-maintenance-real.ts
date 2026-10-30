/** Import-safe, opt-in test-data preparation. Never executes a provider call merely by importing. */
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, lstat, realpath } from 'node:fs/promises';
import { dirname, resolve, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  inspectProductSchemaSerialization,
  markProductSchemaFieldTouched,
  parseProductSchemaXml,
  productSchemaFieldText,
  validateProductSchemaModel,
  withProductSchemaFieldText,
  type ProductSchemaField,
  type ProductSchemaModel
} from '../packages/core/src/product-schema';
import { ProductReferenceClient, type ProductReference } from '../packages/core/src/product-reference';
import { parseAlibabaOpenApiCredentialBundle } from '../packages/core/src/alibaba-credential-bundle';
import { IOP_BUSINESS_ENDPOINT } from '../packages/core/src/alibaba-iop';
import { galleryGatewayId, opaqueGalleryId } from '../packages/core/src/gallery-transfer-context';
import {
  createProductMaintenanceIntent,
  comparePriceReadback,
  compareInventoryReadback
} from '../packages/core/src/product-maintenance-api';
import { createProductMaintenanceBaseline } from '../packages/core/src/product-maintenance-service';
import {
  isProductOperationContext,
  type ProductOperationContext
} from '../packages/core/src/product-operation-context';
import type { GatewayCredentials, RequestOf } from '../packages/core/src/types';
import { AlibabaReadGatewayClient } from '../apps/api/src/gateway/alibaba-read-gateway';
import { installNodeXmlDomGlobals } from './node-xml-dom';
import { assertIgnoredFile } from './smoke-product-reference-real';
import { productReadScopedRoot } from './smoke-product-read-tools-real';
import type { ProductPriceCreationProof, ProductPricePlan } from './lib/product-price-real-types';
import { parseProductPriceCreationProof, parseProductPricePlan } from './smoke-product-price-real';
import {
  parseProductValueCreationProof,
  parseProductValuePlan,
  type ProductValueCreationProof,
  type ProductValuePlan
} from './smoke-product-value-maintenance-real';

export const PRODUCT_VALUE_SOURCE_ID = '10000050957582';
const SCHEMA_LANGUAGE = 'en_US' as const;
const OUTPUT_FILES = [
  'source-read.json',
  'schema-fields.json',
  'preparation.json',
  'value-plan.template.json',
  'preparation-source-baseline.json',
  'preparation-baseline.json',
  'creation-proof.json',
  'plan.json',
  'price-preparation-source-baseline.json',
  'price-preparation-baseline.json',
  'price-creation-proof.json',
  'price-plan.json',
  'price-resume-readonly.jsonl',
  'price-resume-readback.json',
  'creation-receipts.jsonl'
] as const;
type Kind = 'draft' | 'product';
type CreationRequest = RequestOf<'publishProduct'>;
export type ProductValuePreparationScope = 'full' | 'price-only';
export interface ProductValuePreparationOptions {
  credential: string;
  outputDir: string;
  marker: string;
  confirmCreateTestData: boolean;
  valuePlan?: string;
  scope?: ProductValuePreparationScope;
  resumeReadonly?: boolean;
}
export interface PreparedValueSchema {
  schemaVersion: 1;
  sourceProductId: string;
  categoryId: number;
  language: 'en_US';
  marker: string;
  ready: boolean;
  blockers: { fieldId: string; sourcePath: string; rule: string }[];
  warnings: { fieldId: string; sourcePath: string; rule: string }[];
  requests: Record<Kind, CreationRequest>;
  identities: Record<Kind, { title: string; modelNumber: string }>;
  bindings: { role: 'title' | 'modelNumber'; fieldId: string; sourcePath: string }[];
}
export interface PreparedProductPriceSchema extends Omit<PreparedValueSchema, 'requests' | 'identities'> {
  scope: 'price-only';
  requests: Pick<PreparedValueSchema['requests'], 'product'>;
  identities: Pick<PreparedValueSchema['identities'], 'product'>;
  sourcePriceReadable?: boolean;
}
type PreparationRunOptions = Pick<
  ProductValuePreparationOptions,
  'marker' | 'confirmCreateTestData' | 'scope' | 'resumeReadonly'
>;
interface FullPreparationResult {
  prepared: PreparedValueSchema;
  proof?: ProductValueCreationProof;
  plan?: ProductValuePlan;
}
interface PricePreparationResult {
  prepared: PreparedProductPriceSchema;
  proof?: ProductPriceCreationProof;
  plan?: ProductPricePlan;
}
export interface ProductValuePreparationIO {
  reference(id: string): Promise<ProductReference>;
  render(id: string, categoryId: number, language: 'en_US'): Promise<string>;
  create(kind: Kind, request: CreationRequest): Promise<{ success: boolean; productId: string }>;
  readCreated(kind: Kind, id: string, categoryId: number): Promise<string>;
  persist(name: string, value: unknown): Promise<void>;
  appendReceipt(value: Readonly<Record<string, unknown>>): Promise<void>;
  readReceipts(): Promise<readonly unknown[]>;
  now(): number;
  newId(): string;
}
export interface ProductPriceReadonlyResumeIO extends Pick<
  ProductValuePreparationIO,
  'reference' | 'persist' | 'readReceipts' | 'now'
> {
  assertOutputAbsent(name: string): Promise<void>;
  appendResumeReceipt(value: Readonly<Record<string, unknown>>): Promise<void>;
}
function fail(code: string): never {
  throw new Error('PRODUCT_VALUE_PREPARE_' + code);
}
function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return fail('INPUT_INVALID');
  return value as Record<string, unknown>;
}
function id(value: unknown): string {
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,18}$/u.test(value) || BigInt(value) > 9223372036854775807n)
    return fail('ID_INVALID');
  return value;
}
function marker(value: string): string {
  if (!/^[A-Za-z0-9-]{6,40}$/u.test(value)) return fail('MARKER_INVALID');
  return value;
}
function preparationScope(value: unknown): ProductValuePreparationScope {
  if (value === undefined || value === 'full') return 'full';
  if (value === 'price-only') return 'price-only';
  return fail('SCOPE_INVALID');
}
function schemaLanguage(sourceLanguage: unknown): typeof SCHEMA_LANGUAGE {
  // This fixed source is explicitly authorized as an English test product.
  // Missing native metadata is not a contrary language; never invent a source enum.
  if (sourceLanguage === undefined || sourceLanguage === null) return SCHEMA_LANGUAGE;
  // This fixed source's read-only receipt explicitly observed the native language en.
  if (sourceLanguage === 'en') return SCHEMA_LANGUAGE;
  if (
    typeof sourceLanguage === 'string' &&
    (!sourceLanguage.trim() || sourceLanguage.trim() === SCHEMA_LANGUAGE)
  )
    return SCHEMA_LANGUAGE;
  return fail('LANGUAGE_UNSUPPORTED');
}
function sourceReadReceipt(source: ProductReference, timeUtc: number) {
  const language = source.language?.trim();
  return {
    schemaVersion: 1,
    phase: 'source-read',
    protocol: 'iop',
    method: '/alibaba/icbu/product/get/v2',
    sourceProductId: PRODUCT_VALUE_SOURCE_ID,
    sourceLanguage: !language
      ? 'not-returned'
      : /^[A-Za-z][A-Za-z0-9_-]{0,31}$/u.test(language)
        ? language
        : 'unrecognized',
    targetSchemaLanguage: SCHEMA_LANGUAGE,
    hasModelNumber: Boolean(source.modelNumber?.trim()),
    hasCategory: Boolean(source.categoryId),
    hasLogistics:
      Boolean(source.shippingTemplateId) ||
      Boolean(source.weight) ||
      source.leadTimes.length > 0 ||
      Object.values(source.dimension).some((value) => value !== null),
    mutationAttempted: false,
    timeUtc
  };
}
export async function assertProductValuePreparationPaths(
  options: Pick<ProductValuePreparationOptions, 'credential' | 'outputDir' | 'valuePlan'>,
  root: string,
  guard: typeof assertIgnoredFile = assertIgnoredFile
): Promise<string> {
  const outputRoot = productReadScopedRoot(root, options.outputDir);
  if (!options.outputDir.toLowerCase().startsWith((join(outputRoot, 'artifacts') + sep).toLowerCase()))
    return fail('NEW_IGNORED_OUTPUT_REQUIRED');
  for (const input of [options.credential, ...(options.valuePlan ? [options.valuePlan] : [])]) {
    if (input.toLowerCase().startsWith((options.outputDir + sep).toLowerCase()))
      return fail('PATH_COLLISION');
    await guard(productReadScopedRoot(root, input), input);
  }
  await guard(outputRoot, options.outputDir);
  for (const name of OUTPUT_FILES) await guard(outputRoot, join(options.outputDir, name));
  return outputRoot;
}
export function parseProductValuePreparationOptions(args: readonly string[]): ProductValuePreparationOptions {
  const values = new Map<string, string>();
  let confirmed = false;
  let resumeReadonly = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? '';
    if (arg === '--resume-readonly') {
      if (resumeReadonly) return fail('OPTIONS_INVALID');
      resumeReadonly = true;
      continue;
    }
    if (arg === '--confirm-create-test-data') {
      if (confirmed) return fail('OPTIONS_INVALID');
      confirmed = true;
      continue;
    }
    const match = /^--(credential|output-dir|marker|value-plan|scope)(?:=(.*))?$/u.exec(arg);
    const key = match?.[1];
    if (!key || values.has(key)) return fail('OPTIONS_INVALID');
    const value = match[2] ?? args[++i];
    if (!value || value.startsWith('--')) return fail('OPTIONS_INVALID');
    values.set(key, value);
  }
  if (!values.has('credential') || !values.has('output-dir')) return fail('OPTIONS_INVALID');
  const credential = resolve(values.get('credential') ?? '');
  const outputDir = resolve(values.get('output-dir') ?? '');
  const valuePlan = values.get('value-plan');
  const scope = preparationScope(values.get('scope'));
  if (resumeReadonly && (confirmed || scope !== 'price-only' || !valuePlan))
    return fail('RESUME_OPTIONS_INVALID');
  if (
    credential.toLowerCase() === outputDir.toLowerCase() ||
    (valuePlan && resolve(valuePlan).toLowerCase() === credential.toLowerCase())
  )
    return fail('PATH_COLLISION');
  return {
    credential,
    outputDir,
    marker:
      resumeReadonly && !values.has('marker')
        ? ''
        : marker(values.get('marker') ?? 'OVVM-' + randomUUID().slice(0, 8)),
    confirmCreateTestData: confirmed,
    scope,
    resumeReadonly,
    ...(valuePlan ? { valuePlan: resolve(valuePlan) } : {})
  };
}
function walk(field: ProductSchemaField): ProductSchemaField[] {
  // Match validateProductSchemaModel: definitions are not instantiated business data.
  const nested = field.instances.flatMap((item) => item.fields);
  return [field, ...nested.flatMap(walk)];
}
function catalog(field: ProductSchemaField): ProductSchemaField[] {
  // Metadata only: retain uninstantiated definitions for read-only diagnostics.
  const nested = field.instances.length ? field.instances.flatMap((item) => item.fields) : field.children;
  return [field, ...nested.flatMap(catalog)];
}
function binding(model: ProductSchemaModel, role: 'title' | 'modelNumber') {
  const names =
    role === 'title'
      ? new Set(['subject', 'productsubject', 'producttitle', 'productname', '商品标题', '产品名称'])
      : new Set(['modelnumber', 'modelno', '型号', '产品型号']);
  const matches = model.fields
    .flatMap((root) => walk(root).map((field) => ({ root, field })))
    .filter(
      ({ field }) =>
        field.type === 'input' &&
        [field.id, field.name].some((value) => names.has(value.toLowerCase().replace(/[\s_.-]/gu, '')))
    );
  if (matches.length !== 1)
    return fail(role === 'title' ? 'TITLE_FIELD_UNRESOLVED' : 'MODEL_FIELD_UNRESOLVED');
  return matches[0] ?? fail('SCHEMA_INVALID');
}
function replace(field: ProductSchemaField, key: string, value: string): ProductSchemaField {
  if (field.key === key) return withProductSchemaFieldText(field, value);
  return {
    ...field,
    children: field.children.map((child) => replace(child, key, value)),
    instances: field.instances.map((item) => ({
      ...item,
      fields: item.fields.map((child) => replace(child, key, value))
    }))
  };
}
export function prepareProductValueSchemas(
  source: ProductReference,
  xml: string,
  uniqueMarker: string,
  scope?: 'full'
): PreparedValueSchema;
export function prepareProductValueSchemas(
  source: ProductReference,
  xml: string,
  uniqueMarker: string,
  scope: 'price-only'
): PreparedProductPriceSchema;
export function prepareProductValueSchemas(
  source: ProductReference,
  xml: string,
  uniqueMarker: string,
  scope: ProductValuePreparationScope = 'full'
): PreparedValueSchema | PreparedProductPriceSchema {
  preparationScope(scope);
  if (source.productId !== PRODUCT_VALUE_SOURCE_ID) return fail('SOURCE_SCOPE_MISMATCH');
  id(source.productId);
  const categoryId = Number(id(source.categoryId));
  if (!Number.isSafeInteger(categoryId)) return fail('CATEGORY_INVALID');
  const language = schemaLanguage(source.language);
  const token = marker(uniqueMarker);
  const base = parseProductSchemaXml(xml);
  if (!inspectProductSchemaSerialization(base).safe) return fail('UNSAFE_SCHEMA');
  const title = binding(base, 'title');
  const model = binding(base, 'modelNumber');
  const requests = {} as Record<Kind, CreationRequest>;
  const identities = {} as PreparedValueSchema['identities'];
  const blockers: PreparedValueSchema['blockers'] = [];
  const warnings: PreparedValueSchema['warnings'] = [];
  const kinds: readonly Kind[] = scope === 'price-only' ? ['product'] : ['draft', 'product'];
  for (const kind of kinds) {
    const identity = {
      title: 'Unbranded product value test ' + token + ' ' + kind,
      modelNumber: token + (kind === 'draft' ? '-D' : '-P')
    };
    let changed = base;
    for (const [target, value] of [
      [title, identity.title],
      [model, identity.modelNumber]
    ] as const) {
      changed = markProductSchemaFieldTouched(
        {
          ...changed,
          fields: changed.fields.map((field) => replace(field, target.field.key, value))
        },
        target.root.key
      );
    }
    const inspection = inspectProductSchemaSerialization(changed);
    if (!inspection.safe || inspection.changedFieldKeys.length > 2) return fail('UNSAFE_SCHEMA');
    const fields = changed.fields.flatMap(walk);
    for (const issue of validateProductSchemaModel(changed)) {
      const field = fields.find((field) => field.key === issue.fieldKey);
      const notice = {
        fieldId: field?.id ?? '',
        sourcePath: field?.sourcePath ?? issue.fieldKey,
        rule: issue.rule
      };
      const notices = issue.severity === 'error' ? blockers : warnings;
      if (
        !notices.some(
          (item) =>
            item.fieldId === notice.fieldId &&
            item.sourcePath === notice.sourcePath &&
            item.rule === notice.rule
        )
      )
        notices.push(notice);
    }
    requests[kind] = { categoryId, language, schemaXml: inspection.xml };
    identities[kind] = identity;
  }
  const prepared: PreparedValueSchema = {
    schemaVersion: 1,
    sourceProductId: source.productId,
    categoryId,
    language,
    marker: token,
    ready: blockers.length === 0,
    blockers,
    warnings,
    requests,
    identities,
    bindings: [
      { role: 'title', fieldId: title.field.id, sourcePath: title.field.sourcePath },
      { role: 'modelNumber', fieldId: model.field.id, sourcePath: model.field.sourcePath }
    ]
  };
  return scope === 'price-only'
    ? {
        ...prepared,
        scope,
        requests: { product: requests.product },
        identities: { product: identities.product }
      }
    : prepared;
}
function matchesCreated(xml: string, expected: { title: string; modelNumber: string }): boolean {
  const model = parseProductSchemaXml(xml);
  return (
    productSchemaFieldText(binding(model, 'title').field) === expected.title &&
    productSchemaFieldText(binding(model, 'modelNumber').field) === expected.modelNumber
  );
}
export async function bindPreparedProductPricePlan(
  value: unknown,
  productId: string
): Promise<ProductPricePlan> {
  const row = object(value);
  if (row.schemaVersion !== 1 || Object.keys(row).some((key) => !['schemaVersion', 'price'].includes(key)))
    return fail('VALUE_PLAN_INVALID');
  const priceDraft = object(row.price);
  if (priceDraft.productId !== 'NEW_PRODUCT_ID') return fail('VALUE_PLAN_SCOPE_MISMATCH');
  const price = (await createProductMaintenanceIntent({ ...priceDraft, productId: id(productId) })).draft;
  if (price.operation !== 'setPrice') return fail('VALUE_PLAN_INVALID');
  if (price.mode === 'sku') return fail('SKU_PLAN_REQUIRES_NEW_IDS');
  return { schemaVersion: 1, price };
}
async function createPreparedObject(
  kind: Kind,
  request: CreationRequest,
  identity: { title: string; modelNumber: string },
  context: ProductOperationContext,
  io: ProductValuePreparationIO,
  existingIds: readonly string[] = []
): Promise<{ id: string; receiptId: string }> {
  const receiptId = io.newId();
  if (!/^[A-Za-z0-9_.:-]{1,128}$/u.test(receiptId)) return fail('RECEIPT_INVALID');
  const event = {
    schemaVersion: 1,
    phase: 'dispatching',
    kind,
    receiptId,
    context,
    method: kind === 'draft' ? '/icbu/product/schema/add/draft' : '/icbu/product/schema/add',
    sourceProductId: PRODUCT_VALUE_SOURCE_ID,
    fingerprint: createHash('sha256').update(JSON.stringify(request)).digest('hex'),
    timeUtc: io.now()
  };
  await io.appendReceipt(event);
  if (!(await io.readReceipts()).some((item) => JSON.stringify(item) === JSON.stringify(event)))
    return fail('RECEIPT_NOT_DURABLE');
  let accepted: { success: boolean; productId: string };
  try {
    accepted = await io.create(kind, request);
  } catch {
    await io.appendReceipt({ phase: 'unknown', receiptId, noResend: true });
    return fail('UNKNOWN_OUTCOME_NO_RESEND');
  }
  if (object(accepted).success !== true) {
    await io.appendReceipt({ phase: 'unknown', receiptId, noResend: true });
    return fail('UNKNOWN_OUTCOME_NO_RESEND');
  }
  const newId = id(accepted.productId);
  if (newId === PRODUCT_VALUE_SOURCE_ID || existingIds.includes(newId))
    return fail('CREATED_ID_SCOPE_INVALID');
  await io.appendReceipt({ phase: 'accepted', kind, receiptId, productId: newId, timeUtc: io.now() });
  try {
    if (!matchesCreated(await io.readCreated(kind, newId, request.categoryId), identity))
      return fail('READBACK_REQUIRED_NO_RESEND');
  } catch {
    return fail('READBACK_REQUIRED_NO_RESEND');
  }
  await io.appendReceipt({ phase: 'verified', kind, receiptId, productId: newId, timeUtc: io.now() });
  return { id: newId, receiptId };
}
export async function bindPreparedProductValuePlan(
  value: unknown,
  productId: string,
  draftId: string
): Promise<ProductValuePlan> {
  const row = object(value);
  if (
    row.schemaVersion !== 1 ||
    Object.keys(row).some((key) => !['schemaVersion', 'price', 'inventory'].includes(key))
  )
    return fail('VALUE_PLAN_INVALID');
  const bind = (value: unknown) => {
    const draft = object(value);
    if (draft.productId !== 'NEW_PRODUCT_ID') return fail('VALUE_PLAN_SCOPE_MISMATCH');
    return { ...draft, productId: id(productId) };
  };
  const price = (await createProductMaintenanceIntent(bind(row.price))).draft;
  const inventory = (await createProductMaintenanceIntent(bind(row.inventory))).draft;
  if (price.operation !== 'setPrice' || inventory.operation !== 'setInventory')
    return fail('VALUE_PLAN_INVALID');
  return {
    schemaVersion: 1,
    price,
    inventory,
    deleteDraft: {
      operation: 'deleteDraft',
      draftIds: [id(draftId)],
      knownDrafts: [{ kind: 'draft', draftId: id(draftId), source: 'draft-create' }]
    }
  };
}
function readonlyResumePreparation(value: unknown, expectedMarker: string): PreparedProductPriceSchema {
  const row = object(value);
  if (
    row.schemaVersion !== 1 ||
    row.scope !== 'price-only' ||
    row.ready !== true ||
    row.sourcePriceReadable !== true ||
    row.sourceProductId !== PRODUCT_VALUE_SOURCE_ID ||
    row.language !== SCHEMA_LANGUAGE ||
    !Array.isArray(row.blockers) ||
    row.blockers.length
  )
    return fail('RESUME_RECORD_INVALID');
  if (typeof row.marker !== 'string') return fail('RESUME_RECORD_INVALID');
  const token = marker(row.marker);
  if (expectedMarker && expectedMarker !== token) return fail('RESUME_MARKER_MISMATCH');
  const requests = object(row.requests);
  const identities = object(row.identities);
  if (Object.keys(requests).join(',') !== 'product' || Object.keys(identities).join(',') !== 'product')
    return fail('RESUME_RECORD_INVALID');
  const savedRequest = object(requests.product);
  const savedIdentity = object(identities.product);
  if (
    Object.keys(savedRequest).some((key) => !['categoryId', 'language', 'schemaXml'].includes(key)) ||
    typeof savedRequest.categoryId !== 'number' ||
    !Number.isSafeInteger(savedRequest.categoryId) ||
    savedRequest.categoryId < 1 ||
    row.categoryId !== savedRequest.categoryId ||
    savedRequest.language !== SCHEMA_LANGUAGE ||
    typeof savedRequest.schemaXml !== 'string' ||
    savedRequest.schemaXml.length > 2_000_000
  )
    return fail('RESUME_RECORD_INVALID');
  const identity = {
    title: 'Unbranded product value test ' + token + ' product',
    modelNumber: token + '-P'
  };
  if (
    savedIdentity.title !== identity.title ||
    savedIdentity.modelNumber !== identity.modelNumber ||
    !matchesCreated(savedRequest.schemaXml, identity)
  )
    return fail('RESUME_IDENTITY_MISMATCH');
  const model = parseProductSchemaXml(savedRequest.schemaXml);
  if (!inspectProductSchemaSerialization(model).safe) return fail('UNSAFE_SCHEMA');
  const issues = validateProductSchemaModel(model);
  if (issues.some((issue) => issue.severity === 'error')) return fail('RESUME_RECORD_INVALID');
  const fields = model.fields.flatMap(walk);
  const warnings = issues.map((issue) => {
    const field = fields.find((field) => field.key === issue.fieldKey);
    return { fieldId: field?.id ?? '', sourcePath: field?.sourcePath ?? issue.fieldKey, rule: issue.rule };
  });
  return {
    schemaVersion: 1,
    scope: 'price-only',
    sourceProductId: PRODUCT_VALUE_SOURCE_ID,
    categoryId: savedRequest.categoryId,
    language: SCHEMA_LANGUAGE,
    marker: token,
    ready: true,
    sourcePriceReadable: true,
    blockers: [],
    warnings,
    requests: {
      product: {
        categoryId: savedRequest.categoryId,
        language: SCHEMA_LANGUAGE,
        schemaXml: savedRequest.schemaXml
      }
    },
    identities: { product: identity },
    bindings: (['title', 'modelNumber'] as const).map((role) => {
      const field = binding(model, role).field;
      return { role, fieldId: field.id, sourcePath: field.sourcePath };
    })
  };
}
function readonlyResumeAccepted(
  prepared: PreparedProductPriceSchema,
  receipts: readonly unknown[],
  context: ProductOperationContext,
  now: number
): { id: string; receiptId: string; createdTimeUtc: number; fingerprint: string } {
  if (receipts.length < 2 || receipts.length > 32) return fail('RESUME_RECEIPT_INVALID');
  const rows = receipts.map(object);
  const dispatch = rows[0];
  const accepted = rows[1];
  if (
    !dispatch ||
    !accepted ||
    dispatch.phase !== 'dispatching' ||
    accepted.phase !== 'accepted' ||
    dispatch.schemaVersion !== 1 ||
    dispatch.kind !== 'product' ||
    accepted.kind !== 'product' ||
    dispatch.method !== '/icbu/product/schema/add' ||
    dispatch.sourceProductId !== PRODUCT_VALUE_SOURCE_ID ||
    typeof dispatch.receiptId !== 'string' ||
    accepted.receiptId !== dispatch.receiptId ||
    !isProductOperationContext(dispatch.context) ||
    dispatch.context.identity !== context.identity ||
    dispatch.context.gateway !== context.gateway ||
    typeof dispatch.timeUtc !== 'number' ||
    !Number.isSafeInteger(dispatch.timeUtc) ||
    typeof accepted.timeUtc !== 'number' ||
    !Number.isSafeInteger(accepted.timeUtc) ||
    accepted.timeUtc < dispatch.timeUtc
  )
    return fail('RESUME_RECEIPT_INVALID');
  const productId = id(accepted.productId);
  const fingerprint = createHash('sha256').update(JSON.stringify(prepared.requests.product)).digest('hex');
  if (dispatch.fingerprint !== fingerprint) return fail('RESUME_FINGERPRINT_MISMATCH');
  for (const row of rows.slice(2)) {
    if (
      row.productId !== productId ||
      !(
        (row.phase === 'verified' && row.kind === 'product' && row.receiptId === dispatch.receiptId) ||
        (row.phase === 'price-readback-unresolved' && row.noResend === true)
      )
    )
      return fail('RESUME_RECEIPT_INVALID');
  }
  parseProductPriceCreationProof(
    {
      schemaVersion: 1,
      purpose: 'product-price-maintenance-test',
      context,
      createdTimeUtc: accepted.timeUtc,
      product: { id: productId, creationReceiptId: dispatch.receiptId, unbranded: true }
    },
    productId,
    now
  );
  return { id: productId, receiptId: dispatch.receiptId, createdTimeUtc: accepted.timeUtc, fingerprint };
}
export async function resumeProductPricePreparation(
  savedPreparation: unknown,
  context: ProductOperationContext,
  io: ProductPriceReadonlyResumeIO,
  valuePlan: unknown,
  expectedMarker = ''
): Promise<PricePreparationResult> {
  if (!isProductOperationContext(context)) return fail('CONTEXT_INVALID');
  const prepared = readonlyResumePreparation(savedPreparation, expectedMarker);
  const receipts = await io.readReceipts();
  const original = JSON.stringify(receipts);
  const created = readonlyResumeAccepted(prepared, receipts, context, io.now());
  await bindPreparedProductPricePlan(valuePlan, created.id);
  for (const name of [
    'price-preparation-baseline.json',
    'price-creation-proof.json',
    'price-plan.json',
    'price-resume-readback.json'
  ])
    await io.assertOutputAbsent(name);
  const evidence = {
    productId: created.id,
    receiptId: created.receiptId,
    requestFingerprint: created.fingerprint,
    marker: prepared.marker,
    mutationAttempted: false
  };
  await io.appendResumeReceipt({ phase: 'resume-readonly-started', ...evidence, timeUtc: io.now() });
  try {
    const fresh = await io.reference(created.id);
    if (
      fresh.productId !== created.id ||
      fresh.categoryId !== String(prepared.categoryId) ||
      fresh.title !== prepared.identities.product.title ||
      fresh.modelNumber !== prepared.identities.product.modelNumber
    )
      return fail('RESUME_NATIVE_IDENTITY_MISMATCH');
    const result = await finishProductPricePreparation(
      prepared,
      created,
      context,
      {
        reference: (productId) => {
          if (productId !== created.id) return fail('RESUME_TARGET_INVALID');
          return Promise.resolve(fresh);
        },
        now: () => io.now(),
        appendReceipt: (event) => io.appendResumeReceipt({ ...event, mutationAttempted: false }),
        persist: async (name, value) => {
          if (JSON.stringify(await io.readReceipts()) !== original) return fail('RESUME_RECEIPT_CHANGED');
          if (name === 'price-preparation-baseline.json')
            await io.persist('price-resume-readback.json', {
              schemaVersion: 1,
              ...evidence,
              categoryId: prepared.categoryId,
              verifiedBy: '/alibaba/icbu/product/get/v2',
              platformStatus: fresh.status,
              auditStatus: fresh.auditStatus,
              publishedOrOnlineConfirmed: false,
              capturedTimeUtc: io.now()
            });
          await io.persist(name, value);
        }
      },
      valuePlan
    );
    await io.appendResumeReceipt({ phase: 'resume-readonly-verified', ...evidence, timeUtc: io.now() });
    return result;
  } catch (cause: unknown) {
    await io.appendResumeReceipt({
      phase: 'resume-readonly-unresolved',
      ...evidence,
      timeUtc: io.now(),
      noResend: true
    });
    throw cause;
  }
}
async function finishProductPricePreparation(
  prepared: PreparedProductPriceSchema,
  created: { id: string; receiptId: string; createdTimeUtc?: number },
  context: ProductOperationContext,
  io: Pick<ProductValuePreparationIO, 'reference' | 'persist' | 'appendReceipt' | 'now'>,
  valuePlan: unknown
): Promise<PricePreparationResult> {
  const proof = parseProductPriceCreationProof(
    {
      schemaVersion: 1,
      purpose: 'product-price-maintenance-test',
      context,
      createdTimeUtc: created.createdTimeUtc ?? io.now(),
      product: { id: created.id, creationReceiptId: created.receiptId, unbranded: true }
    },
    created.id,
    io.now()
  );
  const plan = await parseProductPricePlan(await bindPreparedProductPricePlan(valuePlan, created.id), proof);
  let price: Awaited<ReturnType<typeof createProductMaintenanceBaseline>>;
  try {
    const fresh = await io.reference(created.id);
    price = await createProductMaintenanceBaseline(plan.price, fresh);
    if (comparePriceReadback(plan.price, fresh).status === 'matched') return fail('VALUE_PLAN_UNCHANGED');
  } catch (cause: unknown) {
    await io.appendReceipt({ phase: 'price-readback-unresolved', productId: created.id, noResend: true });
    if (cause instanceof Error && cause.message === 'PRODUCT_VALUE_PREPARE_VALUE_PLAN_UNCHANGED') throw cause;
    return fail('PRICE_READBACK_REQUIRED_NO_RESEND');
  }
  const intent = await createProductMaintenanceIntent(plan.price);
  await io.persist('price-preparation-baseline.json', {
    schemaVersion: 1,
    productId: created.id,
    context,
    capturedTimeUtc: io.now(),
    price,
    requestedFingerprints: [intent.fingerprint]
  });
  await io.persist('price-creation-proof.json', proof);
  await io.persist('price-plan.json', plan);
  return { prepared, proof, plan };
}
async function runProductPricePreparation(
  options: PreparationRunOptions,
  context: ProductOperationContext,
  io: ProductValuePreparationIO,
  valuePlan?: unknown
): Promise<PricePreparationResult> {
  if ((await io.readReceipts()).length) return fail('PREVIOUS_ATTEMPT_NO_RESEND');
  const source = await io.reference(PRODUCT_VALUE_SOURCE_ID);
  if (source.productId !== PRODUCT_VALUE_SOURCE_ID) return fail('SOURCE_SCOPE_MISMATCH');
  await io.persist('source-read.json', sourceReadReceipt(source, io.now()));
  const language = schemaLanguage(source.language);
  const category = Number(id(source.categoryId));
  if (!Number.isSafeInteger(category)) return fail('CATEGORY_INVALID');
  const xml = await io.render(PRODUCT_VALUE_SOURCE_ID, category, language);
  await io.persist(
    'schema-fields.json',
    parseProductSchemaXml(xml)
      .fields.flatMap(catalog)
      .map((field) => ({
        id: field.id,
        name: field.name,
        type: field.type,
        sourcePath: field.sourcePath,
        hasValue: field.values.some((value) => value.text.trim() !== ''),
        rules: field.rules,
        options: field.options
      }))
  );
  const prepared = prepareProductValueSchemas(source, xml, options.marker, 'price-only');
  const preliminary =
    valuePlan === undefined
      ? undefined
      : await bindPreparedProductPricePlan(valuePlan, PRODUCT_VALUE_SOURCE_ID);
  // This probe establishes readability only. It is never dispatched or used as the new product's proof.
  const probe = preliminary?.price ?? {
    operation: 'setPrice',
    productId: PRODUCT_VALUE_SOURCE_ID,
    currency: source.price.currency,
    ...(source.price.type === 'TIERED'
      ? { mode: 'tiered', tiers: source.price.tiers }
      : source.price.type === 'RANGE'
        ? { mode: 'range', minPrice: source.price.min, maxPrice: source.price.max }
        : { mode: 'unavailable' })
  };
  try {
    await createProductMaintenanceBaseline(probe, source);
    prepared.sourcePriceReadable = true;
  } catch {
    prepared.sourcePriceReadable = false;
    prepared.blockers.push({
      fieldId: 'price',
      sourcePath: 'source:price',
      rule: 'priceBaselineUnavailable'
    });
    prepared.ready = false;
  }
  await io.persist('preparation.json', prepared);
  await io.persist('value-plan.template.json', { schemaVersion: 1, price: null });
  await io.persist('price-preparation-source-baseline.json', {
    schemaVersion: 1,
    scope: 'price-only',
    sourceProductId: source.productId,
    sourceReadabilityOnly: true,
    context,
    capturedTimeUtc: io.now(),
    price: source.price
  });
  if (!options.confirmCreateTestData) return { prepared };
  if (!prepared.ready) return fail('SCHEMA_BLOCKED_NO_CREATE');
  if (!preliminary) return fail('EXPLICIT_VALUE_PLAN_REQUIRED');
  const created = await createPreparedObject(
    'product',
    prepared.requests.product,
    prepared.identities.product,
    context,
    io
  );
  return finishProductPricePreparation(prepared, created, context, io, valuePlan);
}
export function runProductValuePreparation(
  options: PreparationRunOptions & { scope: 'price-only' },
  context: ProductOperationContext,
  io: ProductValuePreparationIO,
  valuePlan?: unknown
): Promise<PricePreparationResult>;
export function runProductValuePreparation(
  options: PreparationRunOptions & { scope?: 'full' },
  context: ProductOperationContext,
  io: ProductValuePreparationIO,
  valuePlan?: unknown
): Promise<FullPreparationResult>;
export function runProductValuePreparation(
  options: PreparationRunOptions,
  context: ProductOperationContext,
  io: ProductValuePreparationIO,
  valuePlan?: unknown
): Promise<FullPreparationResult | PricePreparationResult>;
export async function runProductValuePreparation(
  options: PreparationRunOptions,
  context: ProductOperationContext,
  io: ProductValuePreparationIO,
  valuePlan?: unknown
): Promise<FullPreparationResult | PricePreparationResult> {
  if (!isProductOperationContext(context)) return fail('CONTEXT_INVALID');
  if (options.resumeReadonly) return fail('RESUME_USE_READONLY_ENTRY');
  if (preparationScope(options.scope) === 'price-only')
    return runProductPricePreparation(options, context, io, valuePlan);
  if ((await io.readReceipts()).length) return fail('PREVIOUS_ATTEMPT_NO_RESEND');
  const source = await io.reference(PRODUCT_VALUE_SOURCE_ID);
  if (source.productId !== PRODUCT_VALUE_SOURCE_ID) return fail('SOURCE_SCOPE_MISMATCH');
  await io.persist('source-read.json', sourceReadReceipt(source, io.now()));
  const language = schemaLanguage(source.language);
  const category = Number(id(source.categoryId));
  if (!Number.isSafeInteger(category)) return fail('CATEGORY_INVALID');
  const xml = await io.render(PRODUCT_VALUE_SOURCE_ID, category, language);
  await io.persist(
    'schema-fields.json',
    parseProductSchemaXml(xml)
      .fields.flatMap(catalog)
      .map((field) => ({
        id: field.id,
        name: field.name,
        type: field.type,
        sourcePath: field.sourcePath,
        hasValue: field.values.some((value) => value.text.trim() !== ''),
        rules: field.rules,
        options: field.options
      }))
  );
  const prepared = prepareProductValueSchemas(source, xml, options.marker);
  await io.persist('preparation.json', prepared);
  await io.persist('value-plan.template.json', { schemaVersion: 1, price: null, inventory: null });
  await io.persist('preparation-source-baseline.json', {
    schemaVersion: 1,
    sourceProductId: source.productId,
    context,
    capturedTimeUtc: io.now(),
    price: source.price,
    inventory: source.inventory,
    skus: source.skus.map((sku) => ({
      id: sku.id,
      price: sku.price,
      currency: sku.currency,
      inventory: sku.inventory
    }))
  });
  if (!options.confirmCreateTestData) return { prepared };
  if (!prepared.ready) return fail('SCHEMA_BLOCKED_NO_CREATE');
  if (valuePlan === undefined) return fail('EXPLICIT_VALUE_PLAN_REQUIRED');
  // Validate operator-entered prices, currency and stock BEFORE creating anything.
  const preliminary = await bindPreparedProductValuePlan(
    valuePlan,
    PRODUCT_VALUE_SOURCE_ID,
    PRODUCT_VALUE_SOURCE_ID
  );
  if (preliminary.price.mode === 'sku' || preliminary.inventory.mode === 'sku')
    return fail('SKU_PLAN_REQUIRES_NEW_IDS');
  await createProductMaintenanceBaseline(preliminary.price, source);
  await createProductMaintenanceBaseline(preliminary.inventory, source);
  if (
    comparePriceReadback(preliminary.price, source).status === 'matched' ||
    compareInventoryReadback(preliminary.inventory, source).status === 'matched'
  )
    return fail('VALUE_PLAN_UNCHANGED');
  const created = {} as Record<Kind, { id: string; receiptId: string }>;
  for (const kind of ['draft', 'product'] as const) {
    const request = prepared.requests[kind];
    const receiptId = io.newId();
    if (!/^[A-Za-z0-9_.:-]{1,128}$/u.test(receiptId)) return fail('RECEIPT_INVALID');
    const event = {
      schemaVersion: 1,
      phase: 'dispatching',
      kind,
      receiptId,
      context,
      method: kind === 'draft' ? '/icbu/product/schema/add/draft' : '/icbu/product/schema/add',
      sourceProductId: PRODUCT_VALUE_SOURCE_ID,
      fingerprint: createHash('sha256').update(JSON.stringify(request)).digest('hex'),
      timeUtc: io.now()
    };
    await io.appendReceipt(event);
    if (!(await io.readReceipts()).some((item) => JSON.stringify(item) === JSON.stringify(event)))
      return fail('RECEIPT_NOT_DURABLE');
    let accepted: { success: boolean; productId: string };
    try {
      accepted = await io.create(kind, request);
    } catch {
      await io.appendReceipt({ phase: 'unknown', receiptId, noResend: true });
      return fail('UNKNOWN_OUTCOME_NO_RESEND');
    }
    if (object(accepted).success !== true) {
      await io.appendReceipt({ phase: 'unknown', receiptId, noResend: true });
      return fail('UNKNOWN_OUTCOME_NO_RESEND');
    }
    const newId = id(accepted.productId);
    if (newId === PRODUCT_VALUE_SOURCE_ID || Object.values(created).some((item) => item.id === newId))
      return fail('CREATED_ID_SCOPE_INVALID');
    created[kind] = { id: newId, receiptId };
    await io.appendReceipt({ phase: 'accepted', kind, receiptId, productId: newId, timeUtc: io.now() });
    try {
      if (!matchesCreated(await io.readCreated(kind, newId, category), prepared.identities[kind]))
        return fail('READBACK_REQUIRED_NO_RESEND');
    } catch {
      return fail('READBACK_REQUIRED_NO_RESEND');
    }
    await io.appendReceipt({ phase: 'verified', kind, receiptId, productId: newId, timeUtc: io.now() });
  }
  const proof = parseProductValueCreationProof(
    {
      schemaVersion: 1,
      purpose: 'product-value-maintenance-test',
      context,
      createdTimeUtc: io.now(),
      product: { id: created.product.id, creationReceiptId: created.product.receiptId, unbranded: true },
      draft: { id: created.draft.id, creationReceiptId: created.draft.receiptId }
    },
    created.product.id,
    io.now()
  );
  const plan = await parseProductValuePlan(
    await bindPreparedProductValuePlan(valuePlan, created.product.id, created.draft.id),
    proof
  );
  const fresh = await io.reference(created.product.id);
  const price = await createProductMaintenanceBaseline(plan.price, fresh);
  const inventory = await createProductMaintenanceBaseline(plan.inventory, fresh);
  if (
    comparePriceReadback(plan.price, fresh).status === 'matched' ||
    compareInventoryReadback(plan.inventory, fresh).status === 'matched'
  )
    return fail('VALUE_PLAN_UNCHANGED');
  const priceMatch = await createProductMaintenanceIntent(plan.price);
  const inventoryMatch = await createProductMaintenanceIntent(plan.inventory);
  await io.persist('preparation-baseline.json', {
    schemaVersion: 1,
    productId: fresh.productId,
    context,
    capturedTimeUtc: io.now(),
    price,
    inventory,
    requestedFingerprints: [priceMatch.fingerprint, inventoryMatch.fingerprint]
  });
  await io.persist('creation-proof.json', proof);
  await io.persist('plan.json', plan);
  return { prepared, proof, plan };
}
async function newJson(path: string, value: unknown): Promise<void> {
  const text = JSON.stringify(value, null, 2) + '\n';
  const handle = await open(path, 'wx', 0o600);
  try {
    await handle.writeFile(text);
    await handle.sync();
  } finally {
    await handle.close();
  }
  if ((await readFile(path, 'utf8')) !== text) return fail('OUTPUT_READBACK_FAILED');
}
async function runPriceReadonlyResumeCli(
  options: ProductValuePreparationOptions,
  outputRoot: string,
  context: ProductOperationContext,
  reference: ProductReferenceClient,
  valuePlan: unknown
): Promise<void> {
  const directory = await lstat(options.outputDir);
  if (!directory.isDirectory() || directory.isSymbolicLink()) return fail('RESUME_DIRECTORY_INVALID');
  const readSaved = async (name: string, maxBytes = 2_000_000): Promise<string> => {
    const path = join(options.outputDir, name);
    await assertIgnoredFile(outputRoot, path);
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size > maxBytes) return fail('RESUME_RECORD_INVALID');
    return readFile(path, 'utf8');
  };
  const preparationText = await readSaved('preparation.json');
  const receiptText = await readSaved('creation-receipts.jsonl', 1_000_000);
  const unchanged = async (): Promise<void> => {
    if (
      (await readSaved('preparation.json')) !== preparationText ||
      (await readSaved('creation-receipts.jsonl', 1_000_000)) !== receiptText
    )
      return fail('RESUME_RECEIPT_CHANGED');
  };
  const result = await resumeProductPricePreparation(
    JSON.parse(preparationText) as unknown,
    context,
    {
      reference: (productId) => reference.getProduct(productId),
      now: Date.now,
      readReceipts: async () => {
        await unchanged();
        return receiptText
          .split(/\r?\n/u)
          .filter(Boolean)
          .map((line) => JSON.parse(line) as unknown);
      },
      assertOutputAbsent: async (name) => {
        const path = join(options.outputDir, name);
        await assertIgnoredFile(outputRoot, path);
        try {
          await lstat(path);
        } catch (cause: unknown) {
          if (typeof cause === 'object' && cause !== null && 'code' in cause && cause.code === 'ENOENT')
            return;
          throw cause;
        }
        return fail('RESUME_OUTPUT_EXISTS');
      },
      persist: async (name, value) => {
        if (
          ![
            'price-preparation-baseline.json',
            'price-creation-proof.json',
            'price-plan.json',
            'price-resume-readback.json'
          ].includes(name)
        )
          return fail('RESUME_TARGET_INVALID');
        await unchanged();
        const path = join(options.outputDir, name);
        await assertIgnoredFile(outputRoot, path);
        await newJson(path, value);
      },
      appendResumeReceipt: async (event) => {
        const path = join(options.outputDir, 'price-resume-readonly.jsonl');
        await assertIgnoredFile(outputRoot, path);
        const handle = await open(path, 'a', 0o600);
        const line = JSON.stringify(event) + '\n';
        try {
          await handle.writeFile(line);
          await handle.sync();
        } finally {
          await handle.close();
        }
        if (!(await readFile(path, 'utf8')).endsWith(line)) return fail('RECEIPT_NOT_DURABLE');
      }
    },
    valuePlan,
    options.marker
  );
  console.log(
    JSON.stringify({
      scope: 'price-only',
      status: 'read-only-resumed-and-verified',
      productId: result.proof?.product.id,
      outputDir: options.outputDir,
      mutationAttempted: false,
      noAutomaticRetry: true
    })
  );
}
export async function runProductValuePreparationCli(args: readonly string[]): Promise<void> {
  const options = parseProductValuePreparationOptions(args);
  const root = await realpath(resolve(import.meta.dirname, '..'));
  const outputRoot = await assertProductValuePreparationPaths(options, root);
  const file = await lstat(options.credential);
  if (!file.isFile() || file.isSymbolicLink() || file.size > 100_000) return fail('CREDENTIAL_FILE_INVALID');
  const bundle = parseAlibabaOpenApiCredentialBundle(
    JSON.parse(await readFile(options.credential, 'utf8')) as unknown
  );
  if (bundle.protocol !== 'iop') return fail('IOP_CREDENTIAL_REQUIRED');
  const credentials: GatewayCredentials = {
    protocol: 'iop',
    appKey: bundle.application.appKey,
    appSecret: bundle.application.appSecret,
    accessToken: bundle.oauth.accessToken,
    endpoint: IOP_BUSINESS_ENDPOINT,
    signMethod: 'hmac-sha256'
  };
  const context = {
    identity: await opaqueGalleryId('product-value-maintenance-preparation'),
    gateway: await galleryGatewayId(credentials)
  };
  const gateway = new AlibabaReadGatewayClient(credentials, { maxAttempts: 1 });
  const reference = new ProductReferenceClient(gateway);
  if (options.valuePlan) {
    const planFile = await lstat(options.valuePlan);
    if (!planFile.isFile() || planFile.isSymbolicLink() || planFile.size > 100_000)
      return fail('VALUE_PLAN_INVALID');
  }
  const valuePlan: unknown = options.valuePlan
    ? (JSON.parse(await readFile(options.valuePlan, 'utf8')) as unknown)
    : undefined;
  if (options.resumeReadonly) {
    const restore = installNodeXmlDomGlobals();
    try {
      await runPriceReadonlyResumeCli(options, outputRoot, context, reference, valuePlan);
    } finally {
      restore();
    }
    return;
  }
  await mkdir(dirname(options.outputDir), { recursive: true });
  await assertProductValuePreparationPaths(options, root);
  await mkdir(options.outputDir, { recursive: false, mode: 0o700 }); // Existing output is never resumed or overwritten.
  await assertProductValuePreparationPaths(options, root);
  const restore = installNodeXmlDomGlobals();
  const receiptPath = join(options.outputDir, 'creation-receipts.jsonl');
  let receipt: Awaited<ReturnType<typeof open>> | undefined;
  try {
    const result = await runProductValuePreparation(
      options,
      context,
      {
        reference: (id) => reference.getProduct(id),
        render: async (productId, categoryId, language) =>
          (await gateway.request('renderProductSchema', { productId, categoryId, language })).xml,
        create: (kind, request) =>
          gateway.request(kind === 'draft' ? 'saveProductDraft' : 'publishProduct', request),
        readCreated: async (kind, productId, categoryId) =>
          kind === 'draft'
            ? (await gateway.request('getProductDraft', { productId, categoryId, language: 'en_US' }))
                .schemaXml
            : (await gateway.request('renderProductSchema', { productId, categoryId, language: 'en_US' }))
                .xml,
        persist: async (name, value) => {
          if (!OUTPUT_FILES.some((allowed) => allowed === name)) return fail('NEW_IGNORED_OUTPUT_REQUIRED');
          const path = join(options.outputDir, name);
          await assertIgnoredFile(outputRoot, path);
          await newJson(path, value);
        },
        appendReceipt: async (event) => {
          await assertIgnoredFile(outputRoot, receiptPath);
          receipt ??= await open(receiptPath, 'wx', 0o600);
          await receipt.writeFile(JSON.stringify(event) + '\n');
          await receipt.sync();
        },
        readReceipts: async () => {
          await assertIgnoredFile(outputRoot, receiptPath);
          try {
            return (await readFile(receiptPath, 'utf8'))
              .split(/\r?\n/u)
              .filter(Boolean)
              .map((line) => JSON.parse(line) as unknown);
          } catch (cause: unknown) {
            if (typeof cause === 'object' && cause !== null && 'code' in cause && cause.code === 'ENOENT')
              return [];
            return fail('RECEIPT_INVALID');
          }
        },
        now: Date.now,
        newId: randomUUID
      },
      valuePlan
    );
    console.log(
      JSON.stringify({
        scope: options.scope ?? 'full',
        status: result.proof
          ? 'created-and-verified'
          : result.prepared.ready
            ? 'read-only-prepared'
            : 'blocked',
        outputDir: options.outputDir,
        blockers: result.prepared.blockers,
        warningCount: result.prepared.warnings.length,
        noAutomaticRetry: true
      })
    );
  } finally {
    await receipt?.close();
    restore();
  }
}
if (
  process.argv[1] &&
  resolve(fileURLToPath(import.meta.url)).toLowerCase() === resolve(process.argv[1]).toLowerCase()
) {
  try {
    await runProductValuePreparationCli(process.argv.slice(2));
  } catch (cause: unknown) {
    console.error(
      cause instanceof Error && /^PRODUCT_VALUE_PREPARE_[A-Z_]+$/u.test(cause.message)
        ? cause.message
        : 'PRODUCT_VALUE_PREPARE_STOPPED'
    );
    process.exitCode = 1;
  }
}
