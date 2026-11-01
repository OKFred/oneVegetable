// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { assert, describe, expect, it } from 'vitest';
import fixture from '../../../mock/data/product-schema-price.json';
import integrityFixture from '../../../mock/data/product-maintenance-integrity.json';
import {
  assertProductSchemaPriceUpdate as preflight,
  checkProductSchemaPriceReadback as readback,
  isProductSchemaPriceGuard,
  prepareProductSchemaPrice as prepare,
  type ProductSchemaPriceGuard
} from '../src/product-schema-price';
import { productBatchTargetFingerprint } from '../src/product-batch-maintenance';
import { createProductMaintenanceBaselineFingerprint } from '../src/product-maintenance-service';
import { parseProductSchemaXml } from '../src/product-schema';
import type { ProductReference } from '../src/product-reference';

const reference = (): ProductReference => structuredClone(integrityFixture.snapshot);
const draft = () => structuredClone(fixture.draft);
const request = (preview: Awaited<ReturnType<typeof prepare>>) => ({
  productId: fixture.draft.productId,
  categoryId: 12345,
  schemaPatchXml: preview.patchXml,
  priceGuard: preview.guard
});
function desired(): ProductReference {
  const out = reference();
  out.price.tiers = structuredClone(fixture.draft.tiers);
  return out;
}
const document = (xml: string) => new DOMParser().parseFromString(xml, 'application/xml');

describe('bounded Schema price maintenance with model preservation', () => {
  it.each(['nestedXml', 'multiXml'] as const)('patches existing amounts only: %s', async (layout) => {
    const xml = fixture[layout],
      before = reference();
    const preview = await prepare(xml, draft(), before);
    expect(preview).toMatchObject({ fieldId: 'ladderPrice', unchanged: false });
    expect(isProductSchemaPriceGuard(preview.guard)).toBe(true);
    expect(preview.guard.schemaFingerprint).toBe(
      await productBatchTargetFingerprint(xml, ['ladderPrice', 'modelNumber'])
    );
    expect(preview.guard.baseline.fields).toMatchObject({
      'price/type': 'TIERED',
      'price/currency': 'USD',
      'price/tiers/1': '1',
      'price/tiers/10': '0.9'
    });
    expect(JSON.stringify(preview.guard)).not.toMatch(/Synthetic integrity|SYN-A|<itemSchema|sourceXml/);
    expect(before).toEqual(reference());
    const patch = document(preview.patchXml);
    expect(
      parseProductSchemaXml(preview.patchXml)
        .fields.map((field) => field.id)
        .sort()
    ).toEqual(['ladderPrice', 'modelNumber']);
    expect(patch.querySelector('field[id="modelNumber"] value')?.textContent).toBe(before.modelNumber);
    expect(patch.querySelector('field[id="modelNumber"]')?.outerHTML).toBe(
      document(xml).querySelector('field[id="modelNumber"]')?.outerHTML
    );
    const original = document(xml).querySelector('field[id="ladderPrice"]');
    const updated = patch.querySelector('field[id="ladderPrice"]');
    assert(original && updated);
    const sourceValues = original.querySelectorAll('field[id="price"] value');
    const targetValues = updated.querySelectorAll('field[id="price"] value');
    expect(targetValues.length).toBe(sourceValues.length);
    let index = 0;
    for (const [i, value] of Array.from(sourceValues).entries()) {
      const actual = targetValues[i];
      assert(actual);
      expect(actual.getAttribute('keep')).toBe(value.getAttribute('keep'));
      if (value.textContent === '') expect(actual.outerHTML).toBe(value.outerHTML);
      else {
        expect(actual.textContent).toBe(fixture.draft.tiers[index++]?.price);
        actual.replaceChildren(...Array.from(value.childNodes).map((node) => node.cloneNode(true)));
      }
    }
    expect(updated.outerHTML).toBe(original.outerHTML);
    expect(await preflight(request(preview), xml, reference())).toEqual(preview.guard);
    expect(await readback(preview.guard, desired())).toEqual({
      status: 'matched',
      mismatchedFields: [],
      unavailableFields: []
    });
  });

  it.each([
    '<field id="modelNumber" type="input" keep="model"/>',
    '<field id="modelNumber" type="input" keep="model"><value/></field>',
    '<field id="modelNumber" type="input" keep="model"><values><value/></values></field>'
  ])('preserves the independently read model when Schema has an empty root: %s', async (emptyRoot) => {
    const xml = fixture.multiXml.replace(/<field id="modelNumber"[^>]*>[\s\S]*?<\/field>/u, emptyRoot);
    const preview = await prepare(xml, draft(), reference());
    expect(document(preview.patchXml).querySelector('field[id="modelNumber"] value')?.textContent).toBe(
      reference().modelNumber
    );
    expect(
      parseProductSchemaXml(preview.patchXml)
        .fields.map((field) => field.id)
        .sort()
    ).toEqual(['ladderPrice', 'modelNumber']);
    expect(await preflight(request(preview), xml, reference())).toEqual(preview.guard);
    const unchanged = await prepare(xml, { ...draft(), tiers: reference().price.tiers }, reference());
    expect(unchanged).toMatchObject({ unchanged: true, patchXml: '' });
  });

  it.each([null, '', '   '])('rejects unavailable independent model evidence: %s', async (modelNumber) => {
    await expect(prepare(fixture.multiXml, draft(), { ...reference(), modelNumber })).rejects.toThrow(
      'PRODUCT_SCHEMA_PRICE_MODEL_UNAVAILABLE'
    );
  });

  it.each([
    '',
    '<field id="modelNumber" type="label"><value>SYN-INTEGRITY-A</value></field>',
    '<field id="modelNumber" type="input"><value>SYN-INTEGRITY-A</value><value>Other</value></field>',
    '<field id="modelNumber" type="input"><value><hidden>SYN-INTEGRITY-A</hidden></value></field>',
    '<field id="modelNumber" type="input"><value>SYN-INTEGRITY-A</value><values><value>SYN-INTEGRITY-A</value></values></field>',
    '<field id="modelNumber" type="input"><fields><field id="child" type="input"/></fields></field>',
    '<field id="modelNumber" type="complex"><complex-value/></field>',
    '<field id="modelNumber" type="input"/><field id="modelNumber" type="input"/>'
  ])('rejects missing or unsafe model roots without synthesizing them: %s', async (modelRoot) => {
    const xml = fixture.multiXml.replace(/<field id="modelNumber"[^>]*>[\s\S]*?<\/field>/u, modelRoot);
    await expect(prepare(xml, draft(), reference())).rejects.toThrow('PRODUCT_SCHEMA_PRICE_SCHEMA_INVALID');
  });

  it('rejects a changed model value or changed model root fingerprint', async () => {
    const preview = await prepare(fixture.multiXml, draft(), reference());
    await expect(
      prepare(fixture.multiXml.replace('SYN-INTEGRITY-A', 'OTHER-MODEL'), draft(), reference())
    ).rejects.toThrow('PRODUCT_SCHEMA_PRICE_MODEL_REFERENCE_MISMATCH');
    await expect(
      preflight(
        request(preview),
        fixture.multiXml.replace('keep="model"', 'keep="changed-model"'),
        reference()
      )
    ).rejects.toThrow('PRODUCT_SCHEMA_PRICE_BASELINE_CHANGED');
  });

  it('supports the real multiComplex fixture without changing its empty templates', async () => {
    const xml = readFileSync(resolve('mock/data/product-schema/real-layout-minimal.xml'), 'utf8').replace(
      '</itemSchema>',
      '<field id="modelNumber" type="input"><value>SYN-INTEGRITY-A</value></field></itemSchema>'
    );
    const before = reference();
    before.price.tiers = [
      { quantity: '1', price: '10.50' },
      { quantity: '100', price: '9.50' }
    ];
    const value = {
      ...draft(),
      tiers: [
        { quantity: '1', price: '10.25' },
        { quantity: '100', price: '9.25' }
      ]
    };
    const preview = await prepare(xml, value, before);
    expect(preview.patchXml).not.toContain('superText');
    expect(document(preview.patchXml).querySelector('fields')?.outerHTML).toBe(
      document(xml).querySelector('field[id="ladderPrice"] > fields')?.outerHTML
    );
    expect(await preflight(request(preview), xml, before)).toEqual(preview.guard);
  });

  it('supports wrapped and direct complex-value instances without creating slots', async () => {
    for (const xml of [
      fixture.multiXml
        .replaceAll('<complex-values ', '<complex-value ')
        .replaceAll('</complex-values>', '</complex-value>'),
      fixture.multiXml
        .replaceAll('<complex-values ', '<complex-values><complex-value ')
        .replaceAll('</complex-values>', '</complex-value></complex-values>')
    ]) {
      const preview = await prepare(xml, draft(), reference());
      expect(await preflight(request(preview), xml, reference())).toEqual(preview.guard);
    }
  });

  it('treats equivalent decimals as unchanged, with no update patch', async () => {
    const value = {
      ...draft(),
      tiers: [
        { quantity: '1', price: '1.000' },
        { quantity: '10', price: '0.9000' }
      ]
    };
    const preview = await prepare(fixture.nestedXml, value, reference());
    expect(preview).toMatchObject({ unchanged: true, patchXml: '' });
    await expect(preflight(request(preview), fixture.nestedXml, reference())).rejects.toThrow(
      'PRODUCT_SCHEMA_PRICE_PATCH_MISMATCH'
    );
  });

  it('uses exact prices and quantities beyond Number precision and accepts unordered readback tiers', async () => {
    const before = reference(),
      value = draft();
    before.price.tiers[1] = { quantity: '9007199254740993', price: '0.900000000000000001' };
    value.tiers[1] = { quantity: '9007199254740993', price: '0.900000000000000002' };
    const xml = fixture.multiXml
      .replace('>10<', '>9007199254740993<')
      .replace('>0.90<', '>0.900000000000000001<');
    before.price.tiers.reverse();
    const preview = await prepare(xml, value, before);
    expect(preview.patchXml).toContain('0.900000000000000002');
    before.price.tiers = structuredClone(value.tiers).reverse();
    expect((await readback(preview.guard, before)).status).toBe('matched');
  });

  it.each([
    ['range', { ...fixture.draft, mode: 'range' }],
    ['currency', { ...fixture.draft, currency: 'EUR' }],
    ['extra field', { ...fixture.draft, schemaXml: '<private/>' }],
    ['duplicate quantity', { ...fixture.draft, tiers: [fixture.draft.tiers[0], fixture.draft.tiers[0]] }],
    ['float', { ...fixture.draft, tiers: [{ quantity: '1', price: 1.25 }] }],
    ['exponent', { ...fixture.draft, tiers: [{ quantity: '1', price: '1e2' }] }]
  ])('rejects invalid or unsupported draft: %s', async (_, value) => {
    await expect(prepare(fixture.nestedXml, value, reference())).rejects.toThrow(
      'PRODUCT_SCHEMA_PRICE_INPUT_INVALID'
    );
  });

  it.each([
    fixture.nestedXml.replace('>10<', '>11<'),
    fixture.nestedXml.replace('>10<', '>1<'),
    fixture.nestedXml.replace('type="complex" keep="root"', 'type="input" keep="root"'),
    fixture.nestedXml.replace(
      '<value keep="price"><![CDATA[1.00]]></value>',
      '<value>1</value><value>2</value>'
    ),
    fixture.nestedXml.replace('<values><value keep="price">', '<value>2</value><values><value keep="price">'),
    fixture.nestedXml.replace('<![CDATA[1.00]]>', '<hidden>1.00</hidden>'),
    fixture.nestedXml.replace('id="price" type="input"', 'id="price" type="label"'),
    fixture.nestedXml.replace('</itemSchema>', '<field id="ladderPrice" type="complex"/></itemSchema>'),
    '<itemSchema><field'
  ])('fails closed on changed slots or malformed XML', async (xml) => {
    await expect(prepare(xml, draft(), reference())).rejects.toThrow(/^PRODUCT_SCHEMA_PRICE_/);
  });

  it.each(['ladderPrice', 'ladderPrice_0', 'price', 'modelNumber'])(
    'rejects read-only root/slot/amount: %s',
    async (id) => {
      const xml = fixture.nestedXml.replace('id="' + id + '" type=', 'id="' + id + '" readOnly="true" type=');
      await expect(prepare(xml, draft(), reference())).rejects.toThrow('PRODUCT_SCHEMA_PRICE_READ_ONLY');
    }
  );

  it('rejects conditional, template and direct read-only rules', async () => {
    for (const rule of [
      '<rule name="readOnlyRule" value="true"/>',
      '<rule name="disableRule" value="true"><depend-group operator="and"/></rule>'
    ]) {
      const xml = fixture.multiXml.replace(
        'type="multiComplex" keep="root">',
        'type="multiComplex" keep="root"><rules>' + rule + '</rules>'
      );
      await expect(prepare(xml, draft(), reference())).rejects.toThrow('PRODUCT_SCHEMA_PRICE_READ_ONLY');
    }
    const xml = fixture.multiXml.replace(
      '<field id="price" type="input"><value/>',
      '<field id="price" type="input"><rules><rule name="readOnlyRule" value="true"/></rules><value/>'
    );
    await expect(prepare(xml, draft(), reference())).rejects.toThrow('PRODUCT_SCHEMA_PRICE_READ_ONLY');
  });

  it('requires exact XML/reference prices, complete protection, and approved online/offline state', async () => {
    const changed = reference();
    changed.price.tiers[0] = { quantity: '1', price: '1.000000000000000001' };
    await expect(prepare(fixture.nestedXml, draft(), changed)).rejects.toThrow(
      'PRODUCT_SCHEMA_PRICE_REFERENCE_MISMATCH'
    );
    const duplicate = reference();
    duplicate.price.tiers.push({ quantity: '1', price: '1.00' });
    await expect(prepare(fixture.nestedXml, draft(), duplicate)).rejects.toThrow(/^PRODUCT_SCHEMA_PRICE_/);
    const missing = reference();
    Reflect.deleteProperty(missing, 'modelNumber');
    await expect(prepare(fixture.nestedXml, draft(), missing)).rejects.toThrow(
      'PRODUCT_SCHEMA_PRICE_MODEL_UNAVAILABLE'
    );
    for (const state of [{ auditStatus: 'pending' }, { status: 'deleted' }, { auditStatus: null }])
      await expect(prepare(fixture.nestedXml, draft(), { ...reference(), ...state })).rejects.toThrow(
        'PRODUCT_SCHEMA_PRICE_STATE_UNCONFIRMED'
      );
    expect((await prepare(fixture.nestedXml, draft(), { ...reference(), status: 'offline' })).unchanged).toBe(
      false
    );
  });

  it('rejects stale hashes, changed target structure and any non-generated root/child/attribute patch', async () => {
    const preview = await prepare(fixture.nestedXml, draft(), reference());
    await expect(
      preflight(request(preview), fixture.nestedXml, { ...reference(), modelNumber: 'Changed' })
    ).rejects.toThrow('PRODUCT_SCHEMA_PRICE_MODEL_REFERENCE_MISMATCH');
    await expect(
      preflight(request(preview), fixture.nestedXml, { ...reference(), inventory: '101' })
    ).rejects.toThrow('PRODUCT_SCHEMA_PRICE_BASELINE_CHANGED');
    await expect(
      preflight(request(preview), fixture.nestedXml, { ...reference(), unit: 'Box' })
    ).rejects.toThrow('PRODUCT_SCHEMA_PRICE_REFERENCE_MISMATCH');
    await expect(
      preflight(
        request(preview),
        fixture.nestedXml.replace('type="complex" keep="root"', 'type="complex" keep="changed"'),
        reference()
      )
    ).rejects.toThrow('PRODUCT_SCHEMA_PRICE_BASELINE_CHANGED');
    for (const patch of [
      preview.patchXml + ' ',
      preview.patchXml.replace(
        '</itemSchema>',
        '<field id="inventory" type="input"><value>0</value></field></itemSchema>'
      ),
      preview.patchXml.replace('Keep SKU', 'Changed SKU'),
      preview.patchXml.replace('SYN-INTEGRITY-A', 'Changed model'),
      preview.patchXml.replace(/<field id="modelNumber"[^>]*>[\s\S]*?<\/field>/u, ''),
      preview.patchXml.replace('>USD<', '>EUR<'),
      preview.patchXml.replace('>Piece<', '>Box<'),
      preview.patchXml.replace('keep="price"', 'keep="changed"'),
      preview.patchXml.replace('<value/>', '<value>Template changed</value>')
    ])
      await expect(
        preflight({ ...request(preview), schemaPatchXml: patch }, fixture.nestedXml, reference())
      ).rejects.toThrow('PRODUCT_SCHEMA_PRICE_PATCH_MISMATCH');
    for (const identity of [{ productId: '880124' }, { categoryId: 1 }, { categoryId: 12345.5 }])
      await expect(
        preflight({ ...request(preview), ...identity }, fixture.nestedXml, reference())
      ).rejects.toThrow('PRODUCT_SCHEMA_PRICE_IDENTITY_MISMATCH');
  });

  it('validates stored guard shape, required hashes and digest without invoking accessors', async () => {
    const { guard } = await prepare(fixture.multiXml, draft(), reference());
    const bad: unknown[] = [
      null,
      {},
      { ...guard, version: 2 },
      { ...guard, xml: fixture.multiXml },
      { ...guard, schemaFingerprint: 'bad' },
      { ...guard, baseline: { ...guard.baseline, fields: {} } }
    ];
    const missing = structuredClone(guard);
    Reflect.deleteProperty(missing.baseline.fields, 'integrity/skuPrices');
    bad.push(missing);
    let accessed = false;
    const accessor = { ...guard };
    Object.defineProperty(accessor, 'draft', {
      enumerable: true,
      get: () => {
        accessed = true;
        return guard.draft;
      }
    });
    bad.push(accessor, Object.create(guard));
    for (const value of bad) expect(isProductSchemaPriceGuard(value)).toBe(false);
    expect(accessed).toBe(false);
    const corrupt = { ...guard, baseline: { ...guard.baseline, fingerprint: 'a'.repeat(64) } };
    await expect(readback(corrupt, desired())).rejects.toThrow('PRODUCT_SCHEMA_PRICE_GUARD_INVALID');
    const partial = structuredClone(guard);
    Reflect.deleteProperty(partial.baseline.fields, 'integrity/title');
    partial.baseline.fingerprint = await createProductMaintenanceBaselineFingerprint(
      partial.baseline.productId,
      partial.baseline.fields
    );
    await expect(readback(partial, desired())).rejects.toThrow('PRODUCT_SCHEMA_PRICE_GUARD_INVALID');
  });

  it('accepts readonly complete string maps, but rejects prototype/accessor/undefined field evidence', async () => {
    const { guard } = await prepare(fixture.multiXml, draft(), reference());
    const frozen = structuredClone(guard);
    Object.freeze(frozen.baseline.fields);
    Object.freeze(frozen.baseline);
    Object.freeze(frozen);
    expect(isProductSchemaPriceGuard(frozen)).toBe(true);
    expect((await readback(frozen, desired())).status).toBe('matched');
    const nullPrototype = structuredClone(guard);
    Object.setPrototypeOf(nullPrototype.baseline.fields, null);
    expect(isProductSchemaPriceGuard(nullPrototype)).toBe(true);
    expect((await readback(nullPrototype, desired())).status).toBe('matched');
    let accessed = false;
    const prototype = structuredClone(guard);
    Object.setPrototypeOf(prototype.baseline.fields, { sourceXml: fixture.multiXml });
    const accessor = structuredClone(guard);
    Object.defineProperty(accessor.baseline.fields, 'integrity/title', {
      enumerable: true,
      get: () => {
        accessed = true;
        return guard.baseline.fields['integrity/title'];
      }
    });
    const undefinedField = structuredClone(guard);
    Object.defineProperty(undefinedField.baseline.fields, 'integrity/title', {
      enumerable: true,
      value: undefined
    });
    for (const value of [prototype, accessor, undefinedField]) {
      expect(isProductSchemaPriceGuard(value)).toBe(false);
      await expect(readback(value, desired())).rejects.toThrow('PRODUCT_SCHEMA_PRICE_GUARD_INVALID');
    }
    expect(accessed).toBe(false);
    for (const path of ['attributes', 'price', 'skus'] as const) {
      const source = reference();
      const field =
        path === 'attributes' ? source.attributes[0] : path === 'price' ? source.price : source.skus[0];
      assert(field);
      Object.setPrototypeOf(field, { sourceXml: fixture.multiXml });
      await expect(prepare(fixture.multiXml, draft(), source)).rejects.toThrow(
        'PRODUCT_SCHEMA_PRICE_BASELINE_UNAVAILABLE'
      );
      expect((await readback(guard, source)).status).toBe('unavailable');
    }
  });

  it('never verifies missing/mismatched desired prices, non-target fields, SKU fields or unapproved state', async () => {
    const { guard } = await prepare(fixture.multiXml, draft(), reference());
    for (const changed of [
      reference(),
      { ...desired(), modelNumber: 'Changed' },
      { ...desired(), images: [] },
      { ...desired(), auditStatus: 'pending' },
      { ...desired(), status: 'deleted' },
      { ...desired(), skus: [] }
    ])
      expect((await readback(guard, changed)).status).not.toBe('matched');
    const changedSku = desired();
    const firstSku = changedSku.skus[0];
    assert(firstSku);
    firstSku.price = '5';
    expect((await readback(guard, changedSku)).mismatchedFields).toContain('integrity/skuPrices');
    const missing = desired();
    Reflect.deleteProperty(missing, 'modelNumber');
    expect(await readback(guard, missing)).toMatchObject({
      status: 'unavailable',
      unavailableFields: ['integrity/modelNumber']
    });
    const duplicate = desired();
    duplicate.price.tiers.push({ quantity: '1', price: '1.25' });
    expect((await readback(guard, duplicate)).status).toBe('unavailable');
    const changedScope: ProductSchemaPriceGuard = structuredClone(guard);
    const firstTier = changedScope.draft.tiers[0];
    assert(firstTier);
    firstTier.price = '1.50';
    expect((await readback(changedScope, desired())).status).not.toBe('matched');
  });

  it('does not interpret an incomplete review snapshot as confirmed model deletion', async () => {
    const { guard } = await prepare(fixture.multiXml, draft(), reference());
    const pending = { ...desired(), modelNumber: null, auditStatus: 'pending', status: 'offline' };
    expect(await readback(guard, pending)).toEqual({
      status: 'unavailable',
      mismatchedFields: [],
      unavailableFields: ['auditStatus']
    });
    expect((await readback(guard, { ...pending, auditStatus: 'approved' })).status).not.toBe('matched');
  });

  it('accepts serializer-only empty-element spacing without weakening the generated patch check', async () => {
    const preview = await prepare(fixture.nestedXml, draft(), reference());
    const compatible = preview.patchXml.replace(/\s*\/>/gu, ' />');
    await expect(
      preflight({ ...request(preview), schemaPatchXml: compatible }, fixture.nestedXml, reference())
    ).resolves.toEqual(preview.guard);
    for (const patch of [
      preview.patchXml + '<extra/>',
      preview.patchXml + 'not-xml',
      '<!DOCTYPE itemSchema>' + preview.patchXml,
      preview.patchXml.replace('keep="root"', 'keep="tampered"')
    ])
      await expect(
        preflight({ ...request(preview), schemaPatchXml: patch }, fixture.nestedXml, reference())
      ).rejects.toThrow('PRODUCT_SCHEMA_PRICE_PATCH_MISMATCH');
  });

  it.each([
    ['<!--keep/>-->', '<!--keep />-->'],
    ['<![CDATA[keep/>]]>', '<![CDATA[keep />]]>']
  ])('does not normalize markup-looking text inside %s', async (original, altered) => {
    const xml = fixture.nestedXml.replace(
      '<complex-value keep="outer">',
      original + '<complex-value keep="outer">'
    );
    const preview = await prepare(xml, draft(), reference());
    expect(preview.patchXml).toContain(original);
    await expect(
      preflight(
        { ...request(preview), schemaPatchXml: preview.patchXml.replace(original, altered) },
        xml,
        reference()
      )
    ).rejects.toThrow('PRODUCT_SCHEMA_PRICE_PATCH_MISMATCH');
  });

  it('rejects conflicting explicit currency/unit/type and invalid price rules', async () => {
    for (const xml of [
      fixture.nestedXml.replace('>USD<', '>EUR<'),
      fixture.nestedXml.replace('>Piece<', '>Box<'),
      fixture.nestedXml.replace(
        '<complex-value keep="outer">',
        '<complex-value keep="outer"><field id="priceType" type="input"><value>RANGE</value></field>'
      )
    ])
      await expect(prepare(xml, draft(), reference())).rejects.toThrow(
        'PRODUCT_SCHEMA_PRICE_REFERENCE_MISMATCH'
      );
    const xml = fixture.multiXml.replace(
      'id="price" type="input">',
      'id="price" type="input"><rules><rule name="maxValueRule" value="1.1"/></rules>'
    );
    await expect(prepare(xml, draft(), reference())).rejects.toThrow('PRODUCT_SCHEMA_PRICE_SCHEMA_INVALID');
  });

  it('rejects mixed hidden complex layouts instead of ignoring extra active tiers', async () => {
    const xml = fixture.nestedXml.replace(
      '<complex-value keep="outer">',
      '<complex-values><field id="ladderPrice_hidden" type="complex"/></complex-values><complex-value keep="outer">'
    );
    await expect(prepare(xml, draft(), reference())).rejects.toThrow('PRODUCT_SCHEMA_PRICE_SCHEMA_INVALID');
  });

  it('wraps parser errors in a static code and rejects DTDs without leaking XML', async () => {
    await expect(
      prepare(fixture.multiXml, draft(), reference(), {
        parseFromString: () => {
          throw new Error('private synthetic parser payload');
        }
      })
    ).rejects.toThrow('PRODUCT_SCHEMA_PRICE_SCHEMA_INVALID');
    await expect(prepare('<!DOCTYPE itemSchema>' + fixture.multiXml, draft(), reference())).rejects.toThrow(
      'PRODUCT_SCHEMA_PRICE_SCHEMA_INVALID'
    );
  });
});
