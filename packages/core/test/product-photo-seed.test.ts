// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  applyProductPhotoSeed,
  ProductPhotoSeedError,
  snapshotProductPhotoSeed,
  type ProductPhotoSeedReasonCode
} from '../src/product-photo-seed';
import {
  inspectProductSchemaPatchSerialization,
  inspectProductSchemaSerialization,
  parseProductSchemaXml,
  serializeProductSchemaXml,
  type ProductSchemaField,
  type ProductSchemaModel,
  type ProductSchemaRule,
  type ProductSchemaValue
} from '../src/product-schema';
import type { Photo } from '../src/types';

interface Fixture {
  fixedSlotsXml: string;
  fixedSlotsDirectXml: string;
  fixedSlotsWrappedXml: string;
  photos: Photo[];
  schemaXml: string;
  scalarXml: string;
  unsafeUrls: string[];
  invalidIds: string[];
  invalidLimits: string[];
  unknownRootIds: string[];
  existingValues: ProductSchemaValue[];
  malformedPhotos: Record<string, unknown>[];
}

const fixture = JSON.parse(
  readFileSync(resolve(process.cwd(), 'mock/data/product-photo-seed.json'), 'utf8')
) as Fixture;

function at<T>(values: readonly T[], index: number): T {
  const value = values[index];
  if (value === undefined) throw new Error('Missing mock value');
  return value;
}

function model(): ProductSchemaModel {
  return parseProductSchemaXml(fixture.schemaXml);
}

function images(schema: ProductSchemaModel): ProductSchemaField {
  return at(schema.fields, 1);
}

function photo(overrides: Partial<Photo> = {}): Photo {
  return { ...at(fixture.photos, 0), ...overrides };
}

function rule(name: string, value: string): ProductSchemaRule {
  return { name, value, attributes: { name, value }, dependGroups: [] };
}

function expectFailure(
  schema: ProductSchemaModel,
  photos: readonly Photo[],
  reasonCode: ProductPhotoSeedReasonCode,
  capacity?: number
): void {
  const original = structuredClone(schema);
  const originalPhotos = structuredClone(photos);
  let caught: unknown;
  try {
    applyProductPhotoSeed(schema, photos);
  } catch (error: unknown) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(ProductPhotoSeedError);
  expect(caught).toMatchObject({ name: 'ProductPhotoSeedError', reasonCode });
  expect((caught as ProductPhotoSeedError).capacity).toBe(capacity);
  expect(schema).toEqual(original);
  expect(photos).toEqual(originalPhotos);
}

describe('applyProductPhotoSeed', () => {
  it('clones atomically, preserves order and writes the same attributes/metadata as the image picker', () => {
    const schema = model();
    schema.touchedFieldKeys.push(at(schema.fields, 0).key);
    const original = structuredClone(schema);
    const photos = fixture.photos.toReversed();
    const originalPhotos = structuredClone(photos);

    const result = applyProductPhotoSeed(schema, photos);
    expect(result).not.toBe(schema);
    expect(result.fields).not.toBe(schema.fields);
    expect(images(result).values).toEqual([
      {
        text: at(photos, 0).url,
        attributes: { fileId: at(photos, 0).id },
        metadata: {
          fileName: at(photos, 0).name,
          groupId: '-1',
          fileSize: '0',
          referenceCount: '0',
          modifiedAt: at(photos, 0).modifiedAt
        }
      },
      {
        text: at(photos, 1).url,
        attributes: { fileId: at(photos, 1).id },
        metadata: {
          fileName: at(photos, 1).name,
          groupId: 'mock-group',
          width: '1200',
          height: '900',
          fileSize: '1024',
          referenceCount: '3',
          modifiedAt: at(photos, 1).modifiedAt
        }
      }
    ]);
    expect(result.touchedFieldKeys).toEqual([at(schema.fields, 0).key, images(schema).key]);
    expect(result.sourceXml).toBe(schema.sourceXml);
    expect(result.warnings).toEqual(schema.warnings);
    expect(result.fields.filter((field) => field.key !== images(result).key)).toEqual(
      schema.fields.filter((field) => field.key !== images(schema).key)
    );
    expect(schema).toEqual(original);
    expect(photos).toEqual(originalPhotos);

    // Every mutable branch is detached, including unrelated nested SKU values and schema templates.
    at(at(result.fields, 0).values, 0).text = 'changed after seeding';
    at(images(result).rules, 0).attributes.value = 'changed after seeding';
    at(at(at(at(result.fields, 2).instances, 0).fields, 0).values, 0).attributes.fileId = 'changed';
    at(at(result.fields, 2).children, 0).values.push({ text: 'changed', attributes: {}, metadata: {} });
    at(at(result.fields, 4).options, 0).attributes.value = 'changed';
    result.warnings.push('changed');
    result.touchedFieldKeys.push('changed');
    expect(schema).toEqual(original);
  });

  it('supports reactive-style model proxies without requiring a UI-specific unwrap', () => {
    const schema = model();
    const reactiveLike = new Proxy(schema, {});
    const result = applyProductPhotoSeed(reactiveLike, fixture.photos);
    expect(images(result).values.map((value) => value.text)).toEqual(fixture.photos.map((item) => item.url));
    expect(images(schema).values).toEqual([]);
  });

  it.each(['scImages', 'SC_IMAGES', 'sc-images', 'mainImages', 'MAIN-IMAGES', 'm.a.i.n_I.m.a.g.e.s'])(
    'recognizes only the normalized known main-image root %s',
    (id) => {
      const schema = model();
      images(schema).id = id;
      const result = applyProductPhotoSeed(schema, fixture.photos);
      expect(images(result).id).toBe(id);
      expect(images(result).values).toHaveLength(2);
    }
  );

  it.each(fixture.unknownRootIds)('never guesses the image-like root %s', (id) => {
    const schema = model();
    images(schema).id = id;
    expectFailure(schema, fixture.photos, 'unsupported-field');
  });

  it('does not select a known ID nested in SKU fields or templates', () => {
    const schema = model();
    images(schema).id = 'mockOther';
    const variants = at(schema.fields, 2);
    at(variants.children, 0).id = 'scImages';
    at(at(variants.instances, 0).fields, 0).id = 'mainImages';
    expectFailure(schema, fixture.photos, 'unsupported-field');
  });

  it.each(['input', 'multiInput', 'label'] as const)(
    'refuses ambiguous roots even when the second is %s',
    (type) => {
      const schema = model();
      schema.fields.push({ ...structuredClone(images(schema)), id: 'mainImages', type, key: 'mock-extra' });
      expectFailure(schema, fixture.photos, 'unsupported-field');
    }
  );

  it('refuses two known roots even if one is read-only', () => {
    const schema = model();
    schema.fields.push({
      ...structuredClone(images(schema)),
      id: 'mainImages',
      key: 'mock-read-only',
      rules: [rule('readOnlyRule', 'true')]
    });
    expectFailure(schema, fixture.photos, 'unsupported-field');
  });

  it.each(['readOnlyRule', 'disableRule'])('honors %s and leaves the model untouched', (name) => {
    const schema = model();
    images(schema).rules.push(rule(name, 'true'));
    expectFailure(schema, fixture.photos, 'unsupported-field');
  });

  it.each(['readOnlyRule', 'disableRule'])('allows inactive %s', (name) => {
    const schema = model();
    images(schema).rules.push(rule(name, 'false'));
    expect(images(applyProductPhotoSeed(schema, fixture.photos)).values).toHaveLength(2);
  });

  it.each(['complex', 'multiComplex', 'singleCheck', 'multiCheck', 'label'] as const)(
    'refuses unsupported field type %s',
    (type) => {
      const schema = model();
      images(schema).type = type;
      expectFailure(schema, fixture.photos, 'unsupported-field');
    }
  );

  it('treats input as a scalar with capacity one even if its max rule is larger', () => {
    const schema = parseProductSchemaXml(fixture.scalarXml);
    const field = at(schema.fields, 0);
    field.rules.push(rule('maxInputNumRule', '6'));
    expectFailure(schema, fixture.photos, 'capacity-exceeded', 1);
    const result = applyProductPhotoSeed(schema, [photo()]);
    expect(at(result.fields, 0).values).toHaveLength(1);
  });

  it('round-trips a scalar image without changing its value layout or other fields', () => {
    const schema = parseProductSchemaXml(fixture.scalarXml);
    const result = applyProductPhotoSeed(schema, [photo()]);
    expect(at(result.fields, 0).valueLayout).toBe(at(schema.fields, 0).valueLayout);
    const roundTrip = parseProductSchemaXml(serializeProductSchemaXml(result));
    expect(at(at(roundTrip.fields, 0).values, 0)).toMatchObject({
      text: photo().url,
      attributes: { fileId: photo().id }
    });
    expect(at(roundTrip.fields, 1)).toEqual(at(schema.fields, 1));
  });

  it('uses six only when no maxInputNumRule is supplied, without deduplicating or truncating', () => {
    const schema = model();
    images(schema).rules = [];
    const six = Array.from({ length: 6 }, () => photo());
    expect(images(applyProductPhotoSeed(schema, six)).values).toHaveLength(6);
    expectFailure(schema, [...six, photo()], 'capacity-exceeded', 6);
  });

  it('honors a valid explicit multi-input maximum at and above the boundary', () => {
    const schema = model();
    images(schema).rules = [rule('maxInputNumRule', '2')];
    expect(images(applyProductPhotoSeed(schema, fixture.photos)).values).toHaveLength(2);
    expectFailure(schema, [...fixture.photos, photo()], 'capacity-exceeded', 2);
  });

  it.each(fixture.invalidLimits)('rejects invalid maxInputNumRule %j instead of guessing', (limit) => {
    const schema = model();
    images(schema).rules = [rule('maxInputNumRule', limit)];
    expectFailure(schema, fixture.photos, 'unsupported-field');
  });

  it.each(fixture.invalidLimits)('also refuses invalid scalar maximum %j', (limit) => {
    const schema = parseProductSchemaXml(fixture.scalarXml);
    at(schema.fields, 0).rules = [rule('maxInputNumRule', limit)];
    expectFailure(schema, [photo()], 'unsupported-field');
  });

  it('rejects conflicting or conditional maximum rules', () => {
    const schema = model();
    images(schema).rules = [rule('maxInputNumRule', '2'), rule('maxInputNumRule', '3')];
    expectFailure(schema, fixture.photos, 'unsupported-field');
    const conditional = rule('maxInputNumRule', '2');
    conditional.dependGroups = [
      { operator: 'and', expressions: [{ fieldId: 'market', value: 'mock', symbol: '==' }] }
    ];
    images(schema).rules = [conditional];
    expectFailure(schema, fixture.photos, 'unsupported-field');
  });

  it.each(fixture.existingValues)('never overwrites meaningful existing data %j', (value) => {
    const schema = model();
    images(schema).values.push(value);
    expectFailure(schema, fixture.photos, 'field-not-empty');
  });

  it('checks all existing value slots, not just the first', () => {
    const schema = model();
    images(schema).values = [
      { text: ' ', attributes: {}, metadata: {} },
      { text: '', attributes: { fileId: 'mock-existing' }, metadata: {} }
    ];
    expectFailure(schema, fixture.photos, 'field-not-empty');
  });

  it('accepts empty placeholders and does not duplicate an existing touched-root marker', () => {
    const schema = model();
    images(schema).values = [{ text: ' \n', attributes: { img: 'true', fileId: ' ' }, metadata: {} }];
    schema.touchedFieldKeys.push(images(schema).key);
    const result = applyProductPhotoSeed(schema, fixture.photos);
    expect(result.touchedFieldKeys).toEqual([images(schema).key]);
    expect(images(result).values.map((value) => value.attributes.fileId)).toEqual(
      fixture.photos.map((item) => item.id)
    );
  });

  it('preserves source structure, namespaces, unknown nodes, SKU and description content through serialization', () => {
    const schema = model();
    const result = applyProductPhotoSeed(schema, fixture.photos);
    const inspection = inspectProductSchemaSerialization(result);
    expect(inspection).toMatchObject({
      safe: true,
      noOp: false,
      changedFieldKeys: [images(schema).key],
      structuralDiffs: []
    });
    expect(inspection.xml).toContain('urn:mock:product-photo-seed');
    expect(inspection.xml).toContain('<![CDATA[keep <unknown> & data]]>');
    expect(inspection.xml).toContain('<![CDATA[<p>Mock details</p>');
    expect(inspection.xml).toContain('mock:keep="yes"');
    expect(inspection.xml).not.toContain('fileName=');
    expect(inspection.xml).not.toContain('referenceCount=');
    expect(inspection.xml).not.toContain(photo().previewUrl);
    const roundTrip = parseProductSchemaXml(inspection.xml);
    expect(roundTrip.fields.filter((field) => field.key !== images(roundTrip).key)).toEqual(
      schema.fields.filter((field) => field.key !== images(schema).key)
    );
    expect(images(roundTrip).values.map((value) => [value.text, value.attributes.fileId])).toEqual(
      fixture.photos.map((item) => [item.url, item.id])
    );
    const patch = inspectProductSchemaPatchSerialization(result);
    expect(patch).toMatchObject({ safe: true, changedFieldKeys: [images(schema).key], structuralDiffs: [] });
    expect(parseProductSchemaXml(patch.xml).fields).toHaveLength(1);
    expect(patch.xml).not.toContain('mock-existing-sku');
    expect(schema.sourceXml).toBe(fixture.schemaXml);
  });

  it.each(fixture.unsafeUrls)('rejects unsafe or non-gallery URL %j atomically', (url) => {
    expectFailure(model(), [at(fixture.photos, 1), photo({ url })], 'invalid-photo');
  });

  it.each(fixture.invalidIds)('rejects invalid file ID %j atomically', (id) => {
    expectFailure(model(), [at(fixture.photos, 1), photo({ id })], 'invalid-photo');
  });

  it('rejects empty selections and sparse selections', () => {
    expectFailure(model(), [], 'invalid-photo');
    expectFailure(model(), new Array<Photo>(1), 'invalid-photo');
  });

  it.each(fixture.malformedPhotos)('rejects malformed runtime photo records %j', (overrides) => {
    const invalid = { ...photo(), ...overrides };
    expectFailure(model(), [invalid], 'invalid-photo');
  });

  it('preserves case-sensitive URLs and opaque IDs rather than parsing IDs as numbers', () => {
    const photos = [
      photo({ id: 'Mock-ID' }),
      photo({ id: 'mock-id', url: photo().url.toLowerCase() }),
      at(fixture.photos, 1)
    ];
    expect(
      images(applyProductPhotoSeed(model(), photos)).values.map((value) => [
        value.text,
        value.attributes.fileId
      ])
    ).toEqual(photos.map((item) => [item.url, item.id]));
  });

  it('rejects conflicting duplicate IDs including case-sensitive URL and metadata changes', () => {
    expectFailure(model(), [photo(), photo({ url: photo().url.toLowerCase() })], 'invalid-photo');
    expectFailure(model(), [photo(), photo({ groupId: 'mock-other-group' })], 'invalid-photo');
    expectFailure(model(), [photo(), photo({ name: 'mock-other-name.jpg' })], 'invalid-photo');
  });

  it('keeps identical duplicate selections in order rather than deduplicating', () => {
    const photos = [photo(), at(fixture.photos, 1), photo()];
    expect(
      images(applyProductPhotoSeed(model(), photos)).values.map((value) => value.attributes.fileId)
    ).toEqual(photos.map((item) => item.id));
  });
});

describe('snapshotProductPhotoSeed', () => {
  it('validates and detaches selected Photo records for a reusable in-memory seed', () => {
    const photos = [photo(), at(fixture.photos, 1)];
    const snapshot = snapshotProductPhotoSeed(photos);
    expect(snapshot).toEqual(photos);
    expect(snapshot).not.toBe(photos);
    expect(at(snapshot, 0)).not.toBe(at(photos, 0));
    at(snapshot, 0).name = 'mock changed';
    expect(at(photos, 0).name).toBe(photo().name);
  });

  it('validates without mutating frozen inputs', () => {
    const photos = Object.freeze(fixture.photos.map((item) => Object.freeze({ ...item })));
    expect(snapshotProductPhotoSeed(photos)).toEqual(fixture.photos);
    expect(() => snapshotProductPhotoSeed([])).toThrow(ProductPhotoSeedError);
  });
});

describe('fixed main-image input slots', () => {
  function fixedModel(): ProductSchemaModel {
    return parseProductSchemaXml(fixture.fixedSlotsXml);
  }

  function slots(schema: ProductSchemaModel): ProductSchemaField[] {
    const field = images(schema);
    return field.instances[0]?.fields ?? field.children;
  }

  it.each(['fixedSlotsXml', 'fixedSlotsDirectXml', 'fixedSlotsWrappedXml'] as const)(
    'seeds and round-trips existing slot definitions in %s without changing other roots',
    (key) => {
      const schema = parseProductSchemaXml(fixture[key]);
      const before = structuredClone(schema);
      const result = applyProductPhotoSeed(schema, fixture.photos);
      const populated = slots(result);
      expect(images(result).type).toBe('complex');
      expect(images(result).attributes).toEqual(images(schema).attributes);
      expect(images(result).children).toEqual(images(schema).children);
      expect(images(result).instances).toHaveLength(1);
      expect(populated.map((slot) => slot.id)).toEqual(images(schema).children.map((slot) => slot.id));
      expect(populated.slice(2)).toEqual(slots(schema).slice(2));
      expect(populated.slice(0, 2).map((slot) => at(slot.values, 0))).toEqual(
        fixture.photos.map((item) => ({
          text: item.url,
          attributes: { img: 'true', fileId: item.id },
          metadata: {
            fileName: item.name,
            groupId: item.groupId,
            ...(item.width === null ? {} : { width: String(item.width) }),
            ...(item.height === null ? {} : { height: String(item.height) }),
            fileSize: String(item.fileSize),
            referenceCount: String(item.referenceCount),
            modifiedAt: item.modifiedAt
          }
        }))
      );
      for (const [index, slot] of populated.entries()) {
        expect(slot.attributes).toEqual(at(slots(schema), index).attributes);
        expect(slot.rules).toEqual(at(slots(schema), index).rules);
        expect(slot.valueLayout).toBe(at(slots(schema), index).valueLayout);
      }
      expect(result.touchedFieldKeys).toEqual([
        images(result).key,
        at(populated, 0).key,
        at(populated, 1).key
      ]);
      const inspection = inspectProductSchemaSerialization(result);
      expect(inspection).toMatchObject({
        safe: true,
        noOp: false,
        structuralDiffs: [],
        changedFieldKeys: [images(schema).key]
      });
      expect(inspection.xml).toContain('mock:keep="yes"');
      expect(inspection.xml).toContain('mock:slot="0"');
      expect(inspection.xml).toContain('mock:keep="slot-0"');
      expect(inspection.xml).not.toContain('fileName=');
      const roundTrip = parseProductSchemaXml(inspection.xml);
      expect(
        slots(roundTrip)
          .slice(0, 2)
          .map((slot) => {
            const value = at(slot.values, 0);
            return [value.text, value.attributes.fileId];
          })
      ).toEqual(fixture.photos.map((item) => [item.url, item.id]));
      expect(roundTrip.fields.filter((field) => field.key !== images(roundTrip).key)).toEqual(
        schema.fields.filter((field) => field.key !== images(schema).key)
      );
      const patch = inspectProductSchemaPatchSerialization(result);
      expect(patch.safe).toBe(true);
      expect(parseProductSchemaXml(patch.xml).fields).toHaveLength(1);
      expect(schema).toEqual(before);
      expect(result.sourceXml).toBe(schema.sourceXml);
    }
  );

  it.each([1, 2, 6])('maps %i ordered selections into the existing slots only', (count) => {
    const schema = fixedModel();
    const photos = Array.from({ length: count }, () => photo());
    const result = applyProductPhotoSeed(schema, photos);
    expect(slots(result)).toHaveLength(6);
    expect(
      slots(result)
        .slice(0, count)
        .map((slot) => at(slot.values, 0).attributes.fileId)
    ).toEqual(photos.map((item) => item.id));
    expect(inspectProductSchemaSerialization(result).safe).toBe(true);
  });

  it('refuses overflow without fabricating a seventh slot', () => {
    expectFailure(
      fixedModel(),
      Array.from({ length: 7 }, () => photo()),
      'capacity-exceeded',
      6
    );
  });

  it.each(['readOnlyRule', 'disableRule'])('never changes a selected slot protected by %s', (name) => {
    const schema = fixedModel();
    at(images(schema).children, 0).rules.push(rule(name, 'true'));
    expectFailure(schema, fixture.photos, 'unsupported-field');
  });

  it('keeps unused read-only slots unchanged instead of skipping them or stripping their rules', () => {
    const schema = fixedModel();
    const last = at(images(schema).children, 5);
    last.rules.push(rule('readOnlyRule', 'true'));
    const result = applyProductPhotoSeed(schema, [photo()]);
    expect(at(slots(result), 5)).toEqual(last);
    expect(at(images(result).children, 5)).toEqual(last);
    expectFailure(
      schema,
      Array.from({ length: 6 }, () => photo()),
      'unsupported-field'
    );
  });

  it.each(fixture.existingValues)('refuses meaningful data in any slot %j', (value) => {
    const schema = fixedModel();
    at(images(schema).children, 5).values = [value];
    expectFailure(schema, [photo()], 'field-not-empty');
  });

  it('checks rendered instances as well as templates for existing data and read-only rules', () => {
    const schema = parseProductSchemaXml(fixture.fixedSlotsWrappedXml);
    at(slots(schema), 5).values = [{ text: '', attributes: { fileId: 'mock-existing' }, metadata: {} }];
    expectFailure(schema, [photo()], 'field-not-empty');
    at(slots(schema), 5).values = [];
    at(slots(schema), 0).rules.push(rule('readOnlyRule', 'true'));
    expectFailure(schema, [photo()], 'unsupported-field');
  });

  it.each(fixture.invalidLimits)('rejects invalid fixed-slot maximum %j', (limit) => {
    const schema = fixedModel();
    images(schema).rules = [rule('maxInputNumRule', limit)];
    expectFailure(schema, [photo()], 'unsupported-field');
  });

  it('rejects missing, mismatched, duplicate and out-of-order slot definitions', () => {
    const missing = fixedModel();
    images(missing).children.pop();
    expectFailure(missing, [photo()], 'unsupported-field');
    const duplicated = fixedModel();
    at(images(duplicated).children, 1).id = 'scImages_0';
    expectFailure(duplicated, [photo()], 'unsupported-field');
    const reordered = fixedModel();
    images(reordered).children.reverse();
    expectFailure(reordered, [photo()], 'unsupported-field');
    const mismatched = fixedModel();
    images(mismatched).rules = [rule('maxInputNumRule', '7')];
    expectFailure(mismatched, [photo()], 'unsupported-field');
    const noMaximum = fixedModel();
    images(noMaximum).rules = [];
    expectFailure(noMaximum, [photo()], 'unsupported-field');
  });

  it('rejects sparse or multiple rendered instances rather than guessing a destination', () => {
    const sparse = parseProductSchemaXml(fixture.fixedSlotsWrappedXml);
    at(images(sparse).instances, 0).fields.pop();
    expectFailure(sparse, [photo()], 'unsupported-field');
    const multiple = parseProductSchemaXml(fixture.fixedSlotsWrappedXml);
    images(multiple).instances.push(structuredClone(at(images(multiple).instances, 0)));
    expectFailure(multiple, [photo()], 'unsupported-field');
  });

  it('does not treat complex-valued or nested SKU slots as flat main-image inputs', () => {
    const schema = fixedModel();
    at(images(schema).children, 0).type = 'complex';
    expectFailure(schema, [photo()], 'unsupported-field');
    const nested = fixedModel();
    images(nested).id = 'variants';
    expectFailure(nested, [photo()], 'unsupported-field');
  });
});
