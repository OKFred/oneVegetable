import { existsSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import fixture from '../../mock/data/product-value-preparation.json';
import priceFixture from '../../mock/data/product-price-preparation.json';
import resumeFixture from '../../mock/data/product-price-resume.json';
import repositoryFixture from '../../mock/data/product-maintenance-repository.json';
import type { ProductReference } from '../../packages/core/src/product-reference';
import * as productSchema from '../../packages/core/src/product-schema';
import { installNodeXmlDomGlobals } from '../node-xml-dom';
import {
  PRODUCT_VALUE_SOURCE_ID,
  parseProductValuePreparationOptions,
  prepareProductValueSchemas,
  bindPreparedProductValuePlan,
  bindPreparedProductPricePlan,
  resumeProductPricePreparation,
  runProductValuePreparation,
  runProductValuePreparationCli,
  assertProductValuePreparationPaths,
  type ProductValuePreparationIO,
  type ProductPriceReadonlyResumeIO
} from '../prepare-product-value-maintenance-real';
import {
  parseProductValueCreationProof,
  parseProductValuePlan
} from '../smoke-product-value-maintenance-real';
import { parseProductPriceCreationProof, parseProductPricePlan } from '../smoke-product-price-real';

const schema = readFileSync(
  new URL('../../mock/data/product-value-preparation.xml', import.meta.url),
  'utf8'
);
const templates = readFileSync(
  new URL('../../mock/data/product-value-preparation-templates.xml', import.meta.url),
  'utf8'
);
const schemaWithTemplates = schema.replace(
  '</itemSchema>',
  templates.replace('<itemSchema>', '').replace('</itemSchema>', '') + '</itemSchema>'
);
const inventoryDefinition = readFileSync(
  new URL('../../mock/data/product-price-preparation.xml', import.meta.url),
  'utf8'
);
const priceSchema = schema.replace(
  '</itemSchema>',
  inventoryDefinition.replace('<itemSchema>', '').replace('</itemSchema>', '') + '</itemSchema>'
);
let restore: () => void;
beforeEach(() => {
  restore = installNodeXmlDomGlobals();
});
afterEach(() => {
  restore();
  vi.restoreAllMocks();
});
function harness(xml = schema) {
  const source: ProductReference = structuredClone(fixture.source);
  const saved = new Map<string, unknown>();
  const receipts: unknown[] = [];
  const trace: string[] = [];
  const requests = new Map<string, { schemaXml: string }>();
  let sequence = 0;
  const io = {
    reference: vi.fn((id: string) =>
      Promise.resolve(
        id === PRODUCT_VALUE_SOURCE_ID
          ? structuredClone(source)
          : {
              ...structuredClone(source),
              productId: fixture.productId,
              title: 'Unbranded product value test ' + fixture.marker + ' product',
              modelNumber: fixture.marker + '-P'
            }
      )
    ),
    render: vi.fn<ProductValuePreparationIO['render']>((_id, _category, _language) => Promise.resolve(xml)),
    create: vi.fn<ProductValuePreparationIO['create']>((kind, request) => {
      trace.push('create:' + kind);
      requests.set(kind, request);
      return Promise.resolve({
        success: true,
        productId: kind === 'draft' ? fixture.draftId : fixture.productId
      });
    }),
    readCreated: vi.fn<ProductValuePreparationIO['readCreated']>((kind) =>
      Promise.resolve(requests.get(kind)?.schemaXml ?? xml)
    ),
    persist: vi.fn<ProductValuePreparationIO['persist']>((name, value) => {
      trace.push('persist:' + name);
      saved.set(name, structuredClone(value));
      return Promise.resolve();
    }),
    appendReceipt: vi.fn<ProductValuePreparationIO['appendReceipt']>((event) => {
      trace.push('receipt:' + String(event.phase));
      receipts.push(structuredClone(event));
      return Promise.resolve();
    }),
    readReceipts: vi.fn(() => Promise.resolve(structuredClone(receipts))),
    now: () => repositoryFixture.now,
    newId: () => fixture.marker + '-' + String(++sequence)
  } satisfies ProductValuePreparationIO;
  return { io, source, saved, receipts, trace };
}
const readonlyOptions = { marker: fixture.marker, confirmCreateTestData: false };
const confirmedOptions = { ...readonlyOptions, confirmCreateTestData: true };
const priceOptions = { ...readonlyOptions, scope: 'price-only' as const };
const confirmedPriceOptions = { ...priceOptions, confirmCreateTestData: true };
function priceHarness() {
  const test = harness(priceSchema);
  test.source.inventory = null;
  test.source.skus = [];
  return test;
}

describe('product value test-data preparation (offline only)', () => {
  it('defaults to read-only and requires a separate exact creation opt-in', () => {
    const parsed = parseProductValuePreparationOptions([
      '--credential=fixture.json',
      '--output-dir=out',
      '--marker=' + fixture.marker
    ]);
    expect(parsed.confirmCreateTestData).toBe(false);
    expect(
      parseProductValuePreparationOptions([
        '--credential=fixture.json',
        '--output-dir=out',
        '--confirm-create-test-data'
      ]).confirmCreateTestData
    ).toBe(true);
  });
  it.each(
    [
      [],
      ['--confirm-real-write'],
      ['--credential=x'],
      ['--credential=x', '--output-dir=x'],
      ['--credential=x', '--output-dir=y', '--confirm-create-test-data', '--confirm-create-test-data'],
      ['--credential=x', '--output-dir=y', '--unknown=z']
    ].map((args) => ({ args }))
  )('rejects incomplete, colliding or unrecognized CLI options %#', ({ args }) => {
    expect(() => parseProductValuePreparationOptions(args)).toThrow('PRODUCT_VALUE_PREPARE_');
  });
  it.each(['', 'bad marker', '../unsafe', 'a'.repeat(41)])('rejects unsafe unique marker %s', (marker) => {
    expect(() => prepareProductValueSchemas(fixture.source, schema, marker)).toThrow('MARKER_INVALID');
  });
  it('binds model by actual semantic metadata, not a fixed ID/slot, without changing source data', () => {
    const before = structuredClone(fixture.source);
    const prepared = prepareProductValueSchemas(fixture.source, schema, fixture.marker);
    expect(prepared.ready).toBe(true);
    expect(prepared.bindings).toContainEqual(
      expect.objectContaining({ role: 'modelNumber', fieldId: 'attribute-dynamic-42' })
    );
    expect(prepared.requests.product).toMatchObject({
      categoryId: Number(fixture.source.categoryId),
      language: 'en_US'
    });
    expect(prepared.requests.product).not.toHaveProperty('productId');
    expect(prepared.requests.product.schemaXml).toContain(fixture.marker + '-P');
    expect(prepared.requests.draft.schemaXml).toContain(fixture.marker + '-D');
    expect(prepared.requests.product.schemaXml).toContain('keep="yes"');
    expect(prepared.requests.product.schemaXml).toContain('Freight');
    expect(fixture.source).toEqual(before);
  });
  it('does not scan stores or create anything during default preparation', async () => {
    const { io, saved, receipts } = harness();
    const result = await runProductValuePreparation(readonlyOptions, repositoryFixture.context, io);
    expect(result.prepared.ready).toBe(true);
    expect(result.proof).toBeUndefined();
    expect(io.reference).toHaveBeenCalledExactlyOnceWith(PRODUCT_VALUE_SOURCE_ID);
    expect(io.render).toHaveBeenCalledExactlyOnceWith(
      PRODUCT_VALUE_SOURCE_ID,
      Number(fixture.source.categoryId),
      'en_US'
    );
    expect(io.create).not.toHaveBeenCalled();
    expect(io.readCreated).not.toHaveBeenCalled();
    expect(receipts).toEqual([]);
    expect(saved.has('schema-fields.json')).toBe(true);
    expect(saved.has('preparation-source-baseline.json')).toBe(true);
    expect(saved.has('baseline.json')).toBe(false);
  });
  it.each([null, '', '  '])(
    'keeps missing source language %j distinct from explicit en_US rendering',
    async (language) => {
      const { io, source, saved, trace } = harness();
      source.language = language;
      source.leadTimes = [];
      const before = structuredClone(source);
      const result = await runProductValuePreparation(readonlyOptions, repositoryFixture.context, io);
      expect(saved.get('source-read.json')).toEqual({
        schemaVersion: 1,
        phase: 'source-read',
        protocol: 'iop',
        method: '/alibaba/icbu/product/get/v2',
        sourceProductId: PRODUCT_VALUE_SOURCE_ID,
        sourceLanguage: 'not-returned',
        targetSchemaLanguage: 'en_US',
        hasModelNumber: false,
        hasCategory: true,
        hasLogistics: false,
        mutationAttempted: false,
        timeUtc: repositoryFixture.now
      });
      expect(trace[0]).toBe('persist:source-read.json');
      expect(io.render).toHaveBeenCalledExactlyOnceWith(
        PRODUCT_VALUE_SOURCE_ID,
        Number(fixture.source.categoryId),
        'en_US'
      );
      expect(result.prepared.language).toBe('en_US');
      expect(result.prepared.requests.product.language).toBe('en_US');
      expect(result.prepared.ready).toBe(true);
      expect(source).toEqual(before);
      expect(io.create).not.toHaveBeenCalled();
    }
  );
  it('maps observed native en to the en_US target without altering source metadata', () => {
    const source = { ...structuredClone(fixture.source), language: 'en' };
    const before = structuredClone(source);
    const prepared = prepareProductValueSchemas(source, schema, fixture.marker);
    expect(prepared.language).toBe('en_US');
    expect(prepared.requests.product.language).toBe('en_US');
    expect(prepared.requests.draft.language).toBe('en_US');
    expect(prepared.ready).toBe(true);
    expect(source).toEqual(before);
  });
  it('preserves observed en in the receipt while rendering en_US without creation', async () => {
    const { io, source, saved } = harness();
    source.language = 'en';
    const result = await runProductValuePreparation(readonlyOptions, repositoryFixture.context, io);
    expect(saved.get('source-read.json')).toMatchObject({
      sourceLanguage: 'en',
      targetSchemaLanguage: 'en_US',
      hasModelNumber: false,
      hasCategory: true,
      hasLogistics: true,
      mutationAttempted: false
    });
    expect(io.render).toHaveBeenCalledExactlyOnceWith(
      PRODUCT_VALUE_SOURCE_ID,
      Number(fixture.source.categoryId),
      'en_US'
    );
    expect(result.prepared.ready).toBe(true);
    expect(source.language).toBe('en');
    expect(io.create).not.toHaveBeenCalled();
    expect(io.appendReceipt).not.toHaveBeenCalled();
  });
  it.each(['zh_CN', 'fr_FR', 'ENGLISH', 'future-code'])(
    'records and stops unknown nonempty source language %s without guessing an enum',
    async (language) => {
      const { io, source, saved } = harness();
      source.language = language;
      await expect(
        runProductValuePreparation(readonlyOptions, repositoryFixture.context, io)
      ).rejects.toThrow('LANGUAGE_UNSUPPORTED');
      expect(saved.get('source-read.json')).toMatchObject({
        sourceLanguage: language,
        targetSchemaLanguage: 'en_US',
        mutationAttempted: false
      });
      expect(io.render).not.toHaveBeenCalled();
      expect(io.create).not.toHaveBeenCalled();
    }
  );
  it('does not persist native product bodies, title/model text or malformed language payloads in the source receipt', async () => {
    const { io, source, saved } = harness();
    source.language = 'malformed\nlanguage: ' + fixture.source.title;
    source.modelNumber = fixture.marker;
    await expect(runProductValuePreparation(readonlyOptions, repositoryFixture.context, io)).rejects.toThrow(
      'LANGUAGE_UNSUPPORTED'
    );
    const receipt: unknown = saved.get('source-read.json');
    expect(receipt).toMatchObject({ sourceLanguage: 'unrecognized', hasModelNumber: true });
    const encoded = JSON.stringify(receipt);
    for (const text of [
      fixture.source.title,
      fixture.marker,
      'product_info',
      'description',
      'inventory',
      'price'
    ])
      expect(encoded).not.toContain(text);
    expect(io.create).not.toHaveBeenCalled();
  });
  it('does not continue to render if the diagnostic source-read receipt cannot be saved', async () => {
    const { io, source } = harness();
    source.language = null;
    io.persist.mockRejectedValueOnce(new Error('synthetic diagnostic disk failure'));
    await expect(runProductValuePreparation(readonlyOptions, repositoryFixture.context, io)).rejects.toThrow(
      'synthetic diagnostic disk failure'
    );
    expect(io.render).not.toHaveBeenCalled();
    expect(io.create).not.toHaveBeenCalled();
  });
  it('refuses missing and ambiguous model metadata instead of inventing a slot', () => {
    const node = /<field id="attribute-dynamic-42"[\s\S]*?<\/field>/u.exec(schema)?.[0];
    if (!node) throw new Error('Missing model fixture');
    for (const xml of [
      schema.replace(node, ''),
      schema.replace('</itemSchema>', node.replace('dynamic-42', 'dynamic-99') + '</itemSchema>')
    ])
      expect(() => prepareProductValueSchemas(fixture.source, xml, fixture.marker)).toThrow(
        'MODEL_FIELD_UNRESOLVED'
      );
  });
  it('keeps category-specific required logistics advisory without inventing values', async () => {
    const { io } = harness(schema.replace('<value>Freight</value>', '<value/>'));
    const result = await runProductValuePreparation(readonlyOptions, repositoryFixture.context, io);
    expect(result.prepared.ready).toBe(true);
    expect(result.prepared.blockers).toEqual([]);
    expect(result.prepared.warnings).toContainEqual(
      expect.objectContaining({ fieldId: 'logisticsDynamic', rule: 'requiredRule' })
    );
    expect(result.prepared.requests.product.schemaXml).not.toContain('Freight');
    expect(io.create).not.toHaveBeenCalled();
  });
  it('ignores uninstantiated SKU, property, range and model definitions without materializing fake values', () => {
    const before = productSchema.parseProductSchemaXml(schemaWithTemplates);
    const prepared = prepareProductValueSchemas(fixture.source, schemaWithTemplates, fixture.marker);
    expect(prepared.ready).toBe(true);
    expect(prepared.blockers).toEqual([]);
    expect(prepared.warnings.some((issue) => issue.sourcePath.includes(':template:'))).toBe(false);
    expect(prepared.bindings).toContainEqual(
      expect.objectContaining({ role: 'modelNumber', fieldId: 'attribute-dynamic-42' })
    );
    for (const request of Object.values(prepared.requests)) {
      const after = productSchema.parseProductSchemaXml(request.schemaXml);
      for (const id of ['unusedSkuPricing', 'unusedProperties', 'unusedRange', 'unusedModelPrototype']) {
        const field = after.fields.find((item) => item.id === id);
        expect(field?.instances).toEqual([]);
        expect(field).toEqual(before.fields.find((item) => item.id === id));
      }
      expect(after.fields.find((item) => item.id === 'selectedPricing')?.instances).toHaveLength(1);
    }
  });
  it('respects selected-price dependencies and disabled-field rules from the core validator', () => {
    const prepared = prepareProductValueSchemas(fixture.source, schemaWithTemplates, fixture.marker);
    for (const fieldId of ['inactiveRangeAmount', 'disabledRequiredValue']) {
      expect(prepared.warnings).not.toContainEqual(
        expect.objectContaining({ fieldId, rule: 'requiredRule' })
      );
      expect(prepared.blockers).not.toContainEqual(expect.objectContaining({ fieldId }));
    }
  });
  it('retains an applicable instantiated required-field warning with its real instance path', () => {
    const xml = schemaWithTemplates.replace('<value>10.00</value>', '<value/>');
    const prepared = prepareProductValueSchemas(fixture.source, xml, fixture.marker);
    expect(prepared.ready).toBe(true);
    expect(prepared.blockers).toEqual([]);
    const warning = prepared.warnings.find((issue) => issue.fieldId === 'activePrice');
    expect(warning).toMatchObject({ fieldId: 'activePrice', rule: 'requiredRule' });
    expect(warning?.sourcePath).toContain(':instance:');
    expect(prepared.warnings.some((issue) => issue.sourcePath.includes(':template:'))).toBe(false);
  });
  it('still blocks missing main images before any opt-in create', async () => {
    const xml = schemaWithTemplates.replace(
      /(<field id="scImages"[^>]*>)[\s\S]*?(<\/field>)/u,
      '$1<value/>$2'
    );
    const { io } = harness(xml);
    const result = await runProductValuePreparation(readonlyOptions, repositoryFixture.context, io);
    expect(result.prepared.ready).toBe(false);
    expect(result.prepared.blockers).toContainEqual(
      expect.objectContaining({ fieldId: 'scImages', rule: 'publishMinimumMainImage' })
    );
    await expect(
      runProductValuePreparation(confirmedOptions, repositoryFixture.context, io, fixture.valuePlan)
    ).rejects.toThrow('SCHEMA_BLOCKED_NO_CREATE');
    expect(io.create).not.toHaveBeenCalled();
  });
  it('still requires a real title binding instead of accepting an absent title', () => {
    const xml = schemaWithTemplates.replace(/<field id="subject"[\s\S]*?<\/field>/u, '');
    expect(() => prepareProductValueSchemas(fixture.source, xml, fixture.marker)).toThrow(
      'TITLE_FIELD_UNRESOLVED'
    );
  });
  it.each(['source', 'edited'] as const)('retains the %s serialization safety hard gate', (phase) => {
    const inspect = productSchema.inspectProductSchemaSerialization;
    const spy = vi.spyOn(productSchema, 'inspectProductSchemaSerialization');
    if (phase === 'edited') spy.mockImplementationOnce(inspect);
    spy.mockImplementation((model) => ({ ...inspect(model), safe: false }));
    expect(() => prepareProductValueSchemas(fixture.source, schemaWithTemplates, fixture.marker)).toThrow(
      'UNSAFE_SCHEMA'
    );
  });
  it('requires an explicit valid value plan before either create operation', async () => {
    const { io } = harness();
    await expect(runProductValuePreparation(confirmedOptions, repositoryFixture.context, io)).rejects.toThrow(
      'EXPLICIT_VALUE_PLAN_REQUIRED'
    );
    expect(io.create).not.toHaveBeenCalled();
    const stale = structuredClone(fixture.valuePlan);
    stale.price.productId = PRODUCT_VALUE_SOURCE_ID;
    await expect(
      runProductValuePreparation(confirmedOptions, repositoryFixture.context, io, stale)
    ).rejects.toThrow('VALUE_PLAN_SCOPE_MISMATCH');
    expect(io.create).not.toHaveBeenCalled();
  });
  it('refuses unchanged value settings before creating test data', async () => {
    const { io, source } = harness();
    const plan = structuredClone(fixture.valuePlan);
    if (source.inventory === null) throw new Error('Missing inventory fixture');
    plan.inventory.inventory = source.inventory;
    await expect(
      runProductValuePreparation(confirmedOptions, repositoryFixture.context, io, plan)
    ).rejects.toThrow('VALUE_PLAN_UNCHANGED');
    expect(io.create).not.toHaveBeenCalled();
  });
  it('fsync/readback-gates each create and emits C-compatible proof, plan and a separate preparation baseline', async () => {
    const { io, trace, saved } = harness();
    const result = await runProductValuePreparation(
      confirmedOptions,
      repositoryFixture.context,
      io,
      fixture.valuePlan
    );
    expect(io.create.mock.calls.map((call) => call[0])).toEqual(['draft', 'product']);
    expect(trace.indexOf('receipt:dispatching')).toBeLessThan(trace.indexOf('create:draft'));
    const secondDispatch = trace.lastIndexOf('receipt:dispatching');
    expect(secondDispatch).toBeLessThan(trace.indexOf('create:product'));
    expect(trace.indexOf('receipt:verified')).toBeLessThan(secondDispatch);
    expect(result.proof?.product.id).toBe(fixture.productId);
    expect(result.proof?.draft.id).toBe(fixture.draftId);
    const proof = parseProductValueCreationProof(
      saved.get('creation-proof.json'),
      fixture.productId,
      repositoryFixture.now
    );
    await expect(parseProductValuePlan(saved.get('plan.json'), proof)).resolves.toEqual(result.plan);
    expect(saved.has('preparation-baseline.json')).toBe(true);
    expect(saved.has('baseline.json')).toBe(false);
    expect(result.plan?.price.productId).toBe(fixture.productId);
    expect(result.plan?.deleteDraft.draftIds).toEqual([fixture.draftId]);
  });
  it('never dispatches if the pre-send receipt cannot be persisted/read back', async () => {
    const { io } = harness();
    io.appendReceipt.mockResolvedValueOnce();
    await expect(
      runProductValuePreparation(confirmedOptions, repositoryFixture.context, io, fixture.valuePlan)
    ).rejects.toThrow('RECEIPT_NOT_DURABLE');
    expect(io.create).not.toHaveBeenCalled();
    const next = harness();
    next.io.appendReceipt.mockRejectedValueOnce(new Error('synthetic disk failure'));
    await expect(
      runProductValuePreparation(confirmedOptions, repositoryFixture.context, next.io, fixture.valuePlan)
    ).rejects.toThrow('synthetic disk failure');
    expect(next.io.create).not.toHaveBeenCalled();
  });
  it('records unknown outcomes and rejects every later attempt without retry or compensation', async () => {
    const { io, receipts } = harness();
    io.create.mockRejectedValueOnce(new Error('synthetic network ambiguity'));
    await expect(
      runProductValuePreparation(confirmedOptions, repositoryFixture.context, io, fixture.valuePlan)
    ).rejects.toThrow('UNKNOWN_OUTCOME_NO_RESEND');
    expect(receipts).toContainEqual(expect.objectContaining({ phase: 'unknown', noResend: true }));
    await expect(
      runProductValuePreparation(confirmedOptions, repositoryFixture.context, io, fixture.valuePlan)
    ).rejects.toThrow('PREVIOUS_ATTEMPT_NO_RESEND');
    expect(io.create).toHaveBeenCalledOnce();
  });
  it('requires positive business success rather than an ID or successful transport alone', async () => {
    const { io } = harness();
    io.create.mockResolvedValueOnce({ success: false, productId: fixture.draftId });
    await expect(
      runProductValuePreparation(confirmedOptions, repositoryFixture.context, io, fixture.valuePlan)
    ).rejects.toThrow('UNKNOWN_OUTCOME_NO_RESEND');
    expect(io.create).toHaveBeenCalledOnce();
  });
  it('stops after accepted-but-unverified creation and retains the receipt without creating the second object', async () => {
    const { io, receipts, saved } = harness();
    io.readCreated.mockRejectedValueOnce(new Error('synthetic readback unavailable'));
    await expect(
      runProductValuePreparation(confirmedOptions, repositoryFixture.context, io, fixture.valuePlan)
    ).rejects.toThrow('READBACK_REQUIRED_NO_RESEND');
    expect(io.create).toHaveBeenCalledOnce();
    expect(receipts).toContainEqual(
      expect.objectContaining({ phase: 'accepted', productId: fixture.draftId })
    );
    expect(saved.has('creation-proof.json')).toBe(false);
  });
  it('rejects returning the source ID or reusing the formal/draft ID', async () => {
    const first = harness();
    first.io.create.mockResolvedValueOnce({ success: true, productId: PRODUCT_VALUE_SOURCE_ID });
    await expect(
      runProductValuePreparation(confirmedOptions, repositoryFixture.context, first.io, fixture.valuePlan)
    ).rejects.toThrow('CREATED_ID_SCOPE_INVALID');
    const second = harness();
    second.io.create.mockResolvedValue({ success: true, productId: fixture.draftId });
    const prepared = prepareProductValueSchemas(fixture.source, schema, fixture.marker);
    second.io.readCreated.mockImplementation((kind) => Promise.resolve(prepared.requests[kind].schemaXml));
    await expect(
      runProductValuePreparation(confirmedOptions, repositoryFixture.context, second.io, fixture.valuePlan)
    ).rejects.toThrow('CREATED_ID_SCOPE_INVALID');
    expect(second.saved.has('creation-proof.json')).toBe(false);
  });
  it('binds every maintenance operation only to newly created IDs', async () => {
    const plan = await bindPreparedProductValuePlan(fixture.valuePlan, fixture.productId, fixture.draftId);
    expect(plan.price.productId).toBe(fixture.productId);
    expect(plan.inventory.productId).toBe(fixture.productId);
    expect(plan.deleteDraft.knownDrafts).toEqual([
      { kind: 'draft', draftId: fixture.draftId, source: 'draft-create' }
    ]);
    expect(JSON.stringify(plan)).not.toContain(PRODUCT_VALUE_SOURCE_ID);
  });
});

describe('explicit price-only preparation (offline only)', () => {
  it('keeps full as default and requires the exact explicit price-only CLI scope', () => {
    const args = ['--credential=fixture.json', '--output-dir=out'];
    expect(parseProductValuePreparationOptions(args).scope).toBe('full');
    expect(parseProductValuePreparationOptions([...args, '--scope=full']).scope).toBe('full');
    const parsed = parseProductValuePreparationOptions([...args, '--scope', 'price-only']);
    expect(parsed.scope).toBe('price-only');
    expect(parsed.confirmCreateTestData).toBe(false);
  });
  it.each(['price', 'PRICE-ONLY', 'price-inventory', ''])('rejects unsupported scope %j', (scope) => {
    expect(() =>
      parseProductValuePreparationOptions([
        '--credential=fixture.json',
        '--output-dir=out',
        '--scope=' + scope
      ])
    ).toThrow('PRODUCT_VALUE_PREPARE_');
  });
  it('rejects duplicate scopes rather than downgrading or taking the last value', () => {
    expect(() =>
      parseProductValuePreparationOptions([
        '--credential=fixture.json',
        '--output-dir=out',
        '--scope=full',
        '--scope=price-only'
      ])
    ).toThrow('OPTIONS_INVALID');
  });
  it('prepares only the formal product and keeps inventory empty without guessing a warehouse', async () => {
    const { io, source, saved } = priceHarness();
    const before = structuredClone(source);
    const result = await runProductValuePreparation(priceOptions, repositoryFixture.context, io);
    expect(result.prepared).toMatchObject({ scope: 'price-only', ready: true, sourcePriceReadable: true });
    expect(Object.keys(result.prepared.requests)).toEqual(['product']);
    expect(Object.keys(result.prepared.identities)).toEqual(['product']);
    const model = productSchema.parseProductSchemaXml(result.prepared.requests.product.schemaXml);
    const original = productSchema.parseProductSchemaXml(priceSchema);
    expect(model.fields.find((field) => field.id === 'inventory')).toEqual(
      original.fields.find((field) => field.id === 'inventory')
    );
    expect(saved.get('value-plan.template.json')).toEqual({ schemaVersion: 1, price: null });
    expect(saved.get('price-preparation-source-baseline.json')).toMatchObject({
      sourceProductId: PRODUCT_VALUE_SOURCE_ID,
      sourceReadabilityOnly: true,
      scope: 'price-only'
    });
    expect(saved.has('preparation-source-baseline.json')).toBe(false);
    expect(result.proof).toBeUndefined();
    expect(io.create).not.toHaveBeenCalled();
    expect(io.readCreated).not.toHaveBeenCalled();
    expect(source).toEqual(before);
  });
  it('blocks price-only creation when the source price cannot be read exactly', async () => {
    const { io, source } = priceHarness();
    source.price.currency = null;
    const result = await runProductValuePreparation(priceOptions, repositoryFixture.context, io);
    expect(result.prepared).toMatchObject({ ready: false, sourcePriceReadable: false });
    expect(result.prepared.blockers).toContainEqual({
      fieldId: 'price',
      sourcePath: 'source:price',
      rule: 'priceBaselineUnavailable'
    });
    await expect(
      runProductValuePreparation(confirmedPriceOptions, repositoryFixture.context, io, priceFixture.valuePlan)
    ).rejects.toThrow('SCHEMA_BLOCKED_NO_CREATE');
    expect(io.create).not.toHaveBeenCalled();
  });
  it('creates exactly one new formal product behind its durable receipt and emits only price artifacts', async () => {
    const { io, saved, trace, source } = priceHarness();
    const before = structuredClone(source);
    const result = await runProductValuePreparation(
      confirmedPriceOptions,
      repositoryFixture.context,
      io,
      priceFixture.valuePlan
    );
    expect(io.create.mock.calls.map(([kind]) => kind)).toEqual(['product']);
    expect(io.create.mock.calls[0]?.[1]).not.toHaveProperty('productId');
    expect(io.readCreated).toHaveBeenCalledExactlyOnceWith(
      'product',
      fixture.productId,
      Number(fixture.source.categoryId)
    );
    expect(trace.indexOf('receipt:dispatching')).toBeLessThan(trace.indexOf('create:product'));
    expect(io.reference.mock.calls.map(([id]) => id)).toEqual([PRODUCT_VALUE_SOURCE_ID, fixture.productId]);
    const proof = parseProductPriceCreationProof(
      saved.get('price-creation-proof.json'),
      fixture.productId,
      repositoryFixture.now
    );
    expect(proof.product.id).not.toBe(PRODUCT_VALUE_SOURCE_ID);
    expect(proof).not.toHaveProperty('draft');
    expect(proof.purpose).toBe('product-price-maintenance-test');
    await expect(parseProductPricePlan(saved.get('price-plan.json'), proof)).resolves.toEqual(result.plan);
    expect(result.plan?.price.productId).toBe(fixture.productId);
    expect(saved.get('price-preparation-baseline.json')).toMatchObject({
      productId: fixture.productId,
      context: repositoryFixture.context,
      price: { productId: fixture.productId }
    });
    for (const name of ['price-plan.json', 'price-creation-proof.json', 'price-preparation-baseline.json']) {
      const value = saved.get(name);
      expect(value).not.toHaveProperty('inventory');
      expect(value).not.toHaveProperty('deleteDraft');
      expect(value).not.toHaveProperty('draft');
    }
    for (const name of ['creation-proof.json', 'plan.json', 'preparation-baseline.json', 'baseline.json'])
      expect(saved.has(name)).toBe(false);
    expect(source).toEqual(before);
  });
  it.each([
    { name: 'missing plan', plan: undefined, error: 'EXPLICIT_VALUE_PLAN_REQUIRED' },
    { name: 'full plan', plan: fixture.valuePlan, error: 'VALUE_PLAN_INVALID' },
    { name: 'missing price', plan: { schemaVersion: 1 }, error: 'INPUT_INVALID' },
    { name: 'SKU from source', plan: priceFixture.skuValuePlan, error: 'SKU_PLAN_REQUIRES_NEW_IDS' }
  ])('rejects $name before creating any data', async ({ plan, error }) => {
    const { io } = priceHarness();
    await expect(
      runProductValuePreparation(confirmedPriceOptions, repositoryFixture.context, io, plan)
    ).rejects.toThrow(error);
    expect(io.create).not.toHaveBeenCalled();
  });
  it('refuses a real source ID in the operator plan instead of a new-product placeholder', async () => {
    const { io } = priceHarness();
    const plan = structuredClone(priceFixture.valuePlan);
    plan.price.productId = PRODUCT_VALUE_SOURCE_ID;
    await expect(
      runProductValuePreparation(confirmedPriceOptions, repositoryFixture.context, io, plan)
    ).rejects.toThrow('VALUE_PLAN_SCOPE_MISMATCH');
    expect(io.create).not.toHaveBeenCalled();
  });
  it('binds price only to the explicitly supplied new ID', async () => {
    const plan = await bindPreparedProductPricePlan(priceFixture.valuePlan, fixture.productId);
    expect(plan.price.productId).toBe(fixture.productId);
    expect(Object.keys(plan)).toEqual(['schemaVersion', 'price']);
  });
  it('never creates without a persisted and read-back dispatch receipt', async () => {
    const { io } = priceHarness();
    io.appendReceipt.mockResolvedValueOnce();
    await expect(
      runProductValuePreparation(confirmedPriceOptions, repositoryFixture.context, io, priceFixture.valuePlan)
    ).rejects.toThrow('RECEIPT_NOT_DURABLE');
    expect(io.create).not.toHaveBeenCalled();
  });
  it.each(['network', 'business-false'] as const)(
    'retains %s ambiguity and never resends',
    async (failure) => {
      const { io, receipts, saved } = priceHarness();
      if (failure === 'network') io.create.mockRejectedValueOnce(new Error('synthetic network ambiguity'));
      else io.create.mockResolvedValueOnce({ success: false, productId: fixture.productId });
      await expect(
        runProductValuePreparation(
          confirmedPriceOptions,
          repositoryFixture.context,
          io,
          priceFixture.valuePlan
        )
      ).rejects.toThrow('UNKNOWN_OUTCOME_NO_RESEND');
      expect(receipts).toContainEqual(expect.objectContaining({ phase: 'unknown', noResend: true }));
      await expect(
        runProductValuePreparation(
          confirmedPriceOptions,
          repositoryFixture.context,
          io,
          priceFixture.valuePlan
        )
      ).rejects.toThrow('PREVIOUS_ATTEMPT_NO_RESEND');
      expect(io.create).toHaveBeenCalledOnce();
      expect(saved.has('price-creation-proof.json')).toBe(false);
    }
  );
  it('refuses a source ID returned by creation without issuing any follow-up create', async () => {
    const { io, saved } = priceHarness();
    io.create.mockResolvedValueOnce({ success: true, productId: PRODUCT_VALUE_SOURCE_ID });
    await expect(
      runProductValuePreparation(confirmedPriceOptions, repositoryFixture.context, io, priceFixture.valuePlan)
    ).rejects.toThrow('CREATED_ID_SCOPE_INVALID');
    expect(io.create).toHaveBeenCalledOnce();
    expect(io.readCreated).not.toHaveBeenCalled();
    expect(saved.has('price-creation-proof.json')).toBe(false);
  });
  it('requires exact new title/model readback before issuing a price creation proof', async () => {
    const { io, saved } = priceHarness();
    io.readCreated.mockResolvedValueOnce(priceSchema);
    await expect(
      runProductValuePreparation(confirmedPriceOptions, repositoryFixture.context, io, priceFixture.valuePlan)
    ).rejects.toThrow('READBACK_REQUIRED_NO_RESEND');
    expect(io.create).toHaveBeenCalledOnce();
    expect(saved.has('price-creation-proof.json')).toBe(false);
  });
  it('never substitutes source prices for a missing new-product price baseline', async () => {
    const { io, source, saved, receipts } = priceHarness();
    io.reference.mockImplementation((id) =>
      Promise.resolve(
        id === PRODUCT_VALUE_SOURCE_ID
          ? structuredClone(source)
          : {
              ...structuredClone(source),
              productId: fixture.productId,
              price: { ...structuredClone(source.price), currency: null }
            }
      )
    );
    await expect(
      runProductValuePreparation(confirmedPriceOptions, repositoryFixture.context, io, priceFixture.valuePlan)
    ).rejects.toThrow('PRICE_READBACK_REQUIRED_NO_RESEND');
    expect(receipts).toContainEqual(
      expect.objectContaining({ phase: 'price-readback-unresolved', noResend: true })
    );
    expect(saved.has('price-preparation-baseline.json')).toBe(false);
    expect(saved.has('price-creation-proof.json')).toBe(false);
    expect(io.create).toHaveBeenCalledOnce();
  });
  it('can preflight exact range-price readability without a plan or stock data', async () => {
    const { io, source } = priceHarness();
    source.price = structuredClone(priceFixture.rangePrice);
    const result = await runProductValuePreparation(priceOptions, repositoryFixture.context, io);
    expect(result.prepared).toMatchObject({ ready: true, sourcePriceReadable: true });
    expect(io.create).not.toHaveBeenCalled();
  });
  it('binds an explicit range price plan only to the new formal ID', async () => {
    const { io, source } = priceHarness();
    source.price = structuredClone(priceFixture.rangePrice);
    const result = await runProductValuePreparation(
      confirmedPriceOptions,
      repositoryFixture.context,
      io,
      priceFixture.rangeValuePlan
    );
    expect(result.plan?.price).toMatchObject({ productId: fixture.productId, mode: 'range' });
    expect(io.create.mock.calls.map(([kind]) => kind)).toEqual(['product']);
  });
  it('refuses a no-change plan against the new baseline without certifying source prices instead', async () => {
    const { io, source, saved } = priceHarness();
    const plan = structuredClone(priceFixture.valuePlan);
    source.price.tiers = structuredClone(plan.price.tiers);
    await expect(
      runProductValuePreparation(confirmedPriceOptions, repositoryFixture.context, io, plan)
    ).rejects.toThrow('VALUE_PLAN_UNCHANGED');
    expect(io.create).toHaveBeenCalledOnce();
    expect(saved.has('price-creation-proof.json')).toBe(false);
    expect(saved.has('price-plan.json')).toBe(false);
  });
  it('does not auto-downgrade full mode when the inventory baseline is unavailable', async () => {
    const { io } = priceHarness();
    await expect(
      runProductValuePreparation(confirmedOptions, repositoryFixture.context, io, fixture.valuePlan)
    ).rejects.toThrow('PRODUCT_MAINTENANCE_BASELINE_UNAVAILABLE');
    expect(io.create).not.toHaveBeenCalled();
  });
});

async function resumeHarness() {
  const test = priceHarness();
  test.source.status = resumeFixture.pendingStatus;
  test.source.auditStatus = resumeFixture.pendingAuditStatus;
  test.io.now = () => repositoryFixture.now - resumeFixture.ageMs;
  test.io.readCreated.mockRejectedValueOnce(new Error('synthetic pending Schema render'));
  await expect(
    runProductValuePreparation(
      confirmedPriceOptions,
      repositoryFixture.context,
      test.io,
      priceFixture.valuePlan
    )
  ).rejects.toThrow('READBACK_REQUIRED_NO_RESEND');
  const prepared = prepareProductValueSchemas(test.source, priceSchema, fixture.marker, 'price-only');
  prepared.sourcePriceReadable = true;
  expect(test.saved.get('preparation.json')).toEqual(prepared);
  test.io.now = () => repositoryFixture.now;
  test.io.reference.mockClear();
  test.io.readCreated.mockClear();
  test.io.render.mockClear();
  test.io.appendReceipt.mockClear();
  const newId = vi.spyOn(test.io, 'newId');
  const resumeEvents: unknown[] = [];
  const resume: ProductPriceReadonlyResumeIO = {
    reference: test.io.reference,
    persist: test.io.persist,
    readReceipts: test.io.readReceipts,
    now: test.io.now,
    assertOutputAbsent: vi.fn((name: string) =>
      test.saved.has(name)
        ? Promise.reject(new Error('PRODUCT_VALUE_PREPARE_RESUME_OUTPUT_EXISTS'))
        : Promise.resolve()
    ),
    appendResumeReceipt: vi.fn((event) => {
      resumeEvents.push(structuredClone(event));
      return Promise.resolve();
    })
  };
  const changeReceipt = (index: number, key: string, value: unknown) => {
    const row = test.receipts[index];
    if (typeof row !== 'object' || row === null) throw new Error('Missing fixture receipt');
    Reflect.set(row, key, value);
  };
  return { ...test, prepared, resume, resumeEvents, newId, changeReceipt };
}
describe('accepted price-only readonly resume (offline only)', () => {
  it('does not issue proof without a readable price baseline on the accepted new product', async () => {
    const test = await resumeHarness();
    const read = test.io.reference.getMockImplementation();
    if (!read) throw new Error('Missing fixture reader');
    test.io.reference.mockImplementationOnce(async (id) => {
      const fresh = await read(id);
      fresh.price.currency = null;
      return fresh;
    });
    await expect(
      resumeProductPricePreparation(
        test.prepared,
        repositoryFixture.context,
        test.resume,
        priceFixture.valuePlan
      )
    ).rejects.toThrow('PRICE_READBACK_REQUIRED_NO_RESEND');
    expect(test.io.create).toHaveBeenCalledOnce();
    expect(test.saved.has('price-creation-proof.json')).toBe(false);
    expect(test.saved.has('price-preparation-baseline.json')).toBe(false);
  });
  it('stops if original receipts change while reading the accepted product', async () => {
    const test = await resumeHarness();
    const read = test.io.reference.getMockImplementation();
    if (!read) throw new Error('Missing fixture reader');
    test.io.reference.mockImplementationOnce(async (id) => {
      const fresh = await read(id);
      test.receipts.push({ phase: 'unknown' });
      return fresh;
    });
    await expect(
      resumeProductPricePreparation(
        test.prepared,
        repositoryFixture.context,
        test.resume,
        priceFixture.valuePlan
      )
    ).rejects.toThrow('RESUME_RECEIPT_CHANGED');
    expect(test.saved.has('price-creation-proof.json')).toBe(false);
    expect(test.saved.has('price-preparation-baseline.json')).toBe(false);
  });
  it('requires explicit price-only, original plan, no confirmation and no generated marker', () => {
    const args = [
      '--credential=fixture.json',
      '--output-dir=out',
      '--scope=price-only',
      '--value-plan=plan.json',
      '--resume-readonly'
    ];
    const options = parseProductValuePreparationOptions(args);
    expect(options).toMatchObject({ resumeReadonly: true, marker: '', confirmCreateTestData: false });
    expect(() => parseProductValuePreparationOptions([...args, '--confirm-create-test-data'])).toThrow(
      'RESUME_OPTIONS_INVALID'
    );
    expect(() => parseProductValuePreparationOptions([...args, '--resume-readonly'])).toThrow(
      'OPTIONS_INVALID'
    );
    expect(() =>
      parseProductValuePreparationOptions(args.filter((arg) => arg !== '--scope=price-only'))
    ).toThrow('RESUME_OPTIONS_INVALID');
    expect(() =>
      parseProductValuePreparationOptions(args.filter((arg) => arg !== '--value-plan=plan.json'))
    ).toThrow('RESUME_OPTIONS_INVALID');
  });
  it('recovers only the accepted ID through exact native identity, preserving Pending and original creation time', async () => {
    const test = await resumeHarness();
    const original = JSON.stringify(test.receipts);
    const result = await resumeProductPricePreparation(
      test.prepared,
      repositoryFixture.context,
      test.resume,
      priceFixture.valuePlan,
      fixture.marker
    );
    expect(result.proof?.product.id).toBe(fixture.productId);
    expect(result.proof?.createdTimeUtc).toBe(repositoryFixture.now - resumeFixture.ageMs);
    expect(test.io.reference).toHaveBeenCalledExactlyOnceWith(fixture.productId);
    expect(test.io.create).toHaveBeenCalledOnce();
    expect(test.newId).not.toHaveBeenCalled();
    expect(test.io.render).not.toHaveBeenCalled();
    expect(test.io.readCreated).not.toHaveBeenCalled();
    expect(test.io.appendReceipt).not.toHaveBeenCalled();
    expect(JSON.stringify(test.receipts)).toBe(original);
    expect(test.saved.get('price-resume-readback.json')).toMatchObject({
      productId: fixture.productId,
      verifiedBy: '/alibaba/icbu/product/get/v2',
      platformStatus: resumeFixture.pendingStatus,
      auditStatus: resumeFixture.pendingAuditStatus,
      publishedOrOnlineConfirmed: false,
      mutationAttempted: false
    });
    expect(result.proof).not.toHaveProperty('draft');
    expect(test.resumeEvents).toContainEqual(
      expect.objectContaining({
        phase: 'resume-readonly-verified',
        productId: fixture.productId,
        mutationAttempted: false
      })
    );
  });
  it('refuses programmatic use of the creation entry for resume options', async () => {
    const { io } = priceHarness();
    await expect(
      runProductValuePreparation(
        { ...priceOptions, resumeReadonly: true },
        repositoryFixture.context,
        io,
        priceFixture.valuePlan
      )
    ).rejects.toThrow('RESUME_USE_READONLY_ENTRY');
    expect(io.reference).not.toHaveBeenCalled();
    expect(io.create).not.toHaveBeenCalled();
  });
  it.each([
    'missing-accepted',
    'duplicate-accepted',
    'unknown',
    'receipt-id',
    'source-id',
    'fingerprint',
    'context',
    'stale',
    'marker',
    'request',
    'full',
    'output'
  ] as const)(
    'rejects %s before any new-product GET without creating or replacing evidence',
    async (failure) => {
      const test = await resumeHarness();
      let expectedMarker = fixture.marker;
      if (failure === 'missing-accepted') test.receipts.splice(1, 1);
      if (failure === 'duplicate-accepted') test.receipts.push(structuredClone(test.receipts[1]));
      if (failure === 'unknown') test.receipts.push({ phase: 'unknown' });
      if (failure === 'receipt-id') test.changeReceipt(1, 'receiptId', resumeFixture.wrongReceiptId);
      if (failure === 'source-id') test.changeReceipt(1, 'productId', PRODUCT_VALUE_SOURCE_ID);
      if (failure === 'fingerprint') test.changeReceipt(0, 'fingerprint', '0'.repeat(64));
      if (failure === 'context')
        test.changeReceipt(0, 'context', { ...repositoryFixture.context, gateway: 'other' });
      if (failure === 'stale') test.resume.now = () => repositoryFixture.now + 24 * 60 * 60 * 1000;
      if (failure === 'marker') expectedMarker += '-other';
      if (failure === 'request')
        test.prepared.requests.product.schemaXml = test.prepared.requests.product.schemaXml.replace(
          'keep="yes"',
          'keep="no"'
        );
      if (failure === 'full') Reflect.set(test.prepared, 'scope', 'full');
      if (failure === 'output') test.saved.set('price-plan.json', {});
      await expect(
        resumeProductPricePreparation(
          test.prepared,
          repositoryFixture.context,
          test.resume,
          priceFixture.valuePlan,
          expectedMarker
        )
      ).rejects.toThrow();
      expect(test.io.reference).not.toHaveBeenCalled();
      expect(test.io.create).toHaveBeenCalledOnce();
      expect(test.newId).not.toHaveBeenCalled();
      expect(test.io.appendReceipt).not.toHaveBeenCalled();
      expect(test.saved.has('price-creation-proof.json')).toBe(false);
    }
  );
  it.each(['productId', 'categoryId', 'title', 'modelNumber'] as const)(
    'requires exact native %s without using Schema or source fallback',
    async (field) => {
      const test = await resumeHarness();
      const fresh = {
        ...structuredClone(test.source),
        productId: fixture.productId,
        title: test.prepared.identities.product.title,
        modelNumber: test.prepared.identities.product.modelNumber
      };
      Reflect.set(
        fresh,
        field,
        field === 'modelNumber' ? null : field === 'title' ? test.source.title : resumeFixture.otherProductId
      );
      test.io.reference.mockResolvedValueOnce(fresh);
      await expect(
        resumeProductPricePreparation(
          test.prepared,
          repositoryFixture.context,
          test.resume,
          priceFixture.valuePlan
        )
      ).rejects.toThrow('RESUME_NATIVE_IDENTITY_MISMATCH');
      expect(test.io.reference).toHaveBeenCalledExactlyOnceWith(fixture.productId);
      expect(test.io.create).toHaveBeenCalledOnce();
      expect(test.io.readCreated).not.toHaveBeenCalled();
      expect(test.io.render).not.toHaveBeenCalled();
      expect(test.saved.has('price-creation-proof.json')).toBe(false);
    }
  );
});

describe('product value preparation ignored-path safeguards', () => {
  const root = resolve('guard-fixtures', 'oneVegetable-score-recovery');
  const primary = resolve(root, '..', 'oneVegetable');
  const paths = (outputRoot = root) => ({
    credential: join(primary, 'artifacts', 'inputs', 'iop.json'),
    valuePlan: join(primary, 'artifacts', 'inputs', 'value-plan.json'),
    outputDir: join(outputRoot, 'artifacts', 'new-preparation')
  });
  type Guard = (root: string, path: string) => Promise<void>;
  it.each([
    { name: 'source worktree', outputRoot: root },
    { name: 'remote primary repo', outputRoot: primary }
  ])('checks inputs and every output through the existing guard in $name', async ({ outputRoot }) => {
    const options = paths(outputRoot);
    const guard = vi.fn<Guard>(() => Promise.resolve());
    expect(await assertProductValuePreparationPaths(options, root, guard)).toBe(outputRoot);
    expect(guard).toHaveBeenCalledWith(primary, options.credential);
    expect(guard).toHaveBeenCalledWith(primary, options.valuePlan);
    expect(guard).toHaveBeenCalledWith(outputRoot, options.outputDir);
    for (const name of [
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
    ])
      expect(guard).toHaveBeenCalledWith(outputRoot, join(options.outputDir, name));
  });
  it.each(['credential', 'valuePlan', 'outputDir'] as const)(
    'rejects $0 outside the two remote roots',
    async (key) => {
      const options = paths();
      Reflect.set(options, key, resolve(root, '..', 'unrelated-checkout', 'artifacts', 'fixture.json'));
      const guard = vi.fn<Guard>(() => Promise.resolve());
      await expect(assertProductValuePreparationPaths(options, root, guard)).rejects.toThrow(
        'IGNORED_PATHS_REQUIRED'
      );
    }
  );
  it('requires an artifacts output even if an injected guard would accept a source path', async () => {
    const options = { ...paths(), outputDir: join(root, 'scripts', 'unsafe-output') };
    const guard = vi.fn<Guard>(() => Promise.resolve());
    await expect(assertProductValuePreparationPaths(options, root, guard)).rejects.toThrow(
      'NEW_IGNORED_OUTPUT_REQUIRED'
    );
    expect(guard).not.toHaveBeenCalled();
  });
  it.each([
    'source-read.json',
    'creation-proof.json',
    'creation-receipts.jsonl',
    'price-preparation-source-baseline.json',
    'price-preparation-baseline.json',
    'price-creation-proof.json',
    'price-plan.json',
    'price-resume-readonly.jsonl',
    'price-resume-readback.json'
  ])('rejects a tracked/unsafe %s despite an otherwise ignored output directory', async (blocked) => {
    const options = paths();
    const guard = vi.fn<Guard>((_root, path) =>
      path === join(options.outputDir, blocked)
        ? Promise.reject(new Error('IGNORED_PATHS_REQUIRED'))
        : Promise.resolve()
    );
    await expect(assertProductValuePreparationPaths(options, root, guard)).rejects.toThrow(
      'IGNORED_PATHS_REQUIRED'
    );
  });
  it('does not allow either input to live inside the new output directory', async () => {
    const options = paths();
    options.credential = join(options.outputDir, 'source-read.json');
    await expect(assertProductValuePreparationPaths(options, root, () => Promise.resolve())).rejects.toThrow(
      'PATH_COLLISION'
    );
  });
  it('uses the actual assertIgnoredFile implementation to reject a tracked credential input', async () => {
    const actualRoot = resolve(import.meta.dirname, '..', '..');
    await expect(
      assertProductValuePreparationPaths(
        {
          credential: join(actualRoot, 'package.json'),
          outputDir: join(actualRoot, 'artifacts', 'prepare-guard-' + crypto.randomUUID())
        },
        actualRoot
      )
    ).rejects.toThrow('IGNORED_PATHS_REQUIRED');
  });
  it('fails CLI path preflight before parsing a tracked input or creating an output directory', async () => {
    const actualRoot = resolve(import.meta.dirname, '..', '..');
    const outputDir = join(actualRoot, 'artifacts', 'prepare-guard-' + crypto.randomUUID());
    expect(existsSync(outputDir)).toBe(false);
    await expect(
      runProductValuePreparationCli([
        '--credential=' + join(actualRoot, 'package.json'),
        '--output-dir=' + outputDir
      ])
    ).rejects.toThrow('IGNORED_PATHS_REQUIRED');
    expect(existsSync(outputDir)).toBe(false);
  });
});
