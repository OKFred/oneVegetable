// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  compareProductMutationFingerprints,
  createProductMutationFingerprints
} from '../src/product-mutation-fingerprint';

const PATCH = `<itemSchema><field id="subject" name="Title" type="input"><values><value lang="en">New title</value></values></field><field id="keywords" name="Keywords" type="multiInput"><values><value>bag</value><value>leather</value></values></field></itemSchema>`;

describe('product mutation fingerprints', () => {
  const group = readFileSync(resolve('mock/data/product-schema/group-fingerprint.xml'), 'utf8');
  const omitted = group
    .replace('<field id="second_group_id" type="input"><value/></field>', '')
    .replace('<field id="third_group_id" type="input"><value/></field>', '');
  it('recognizes omitted empty declared group slots against legacy receipt hashes', async () => {
    const expected = await createProductMutationFingerprints(group);
    expect(await compareProductMutationFingerprints(omitted, expected.fieldExpectations)).toEqual({
      matched: true,
      missingFieldIds: [],
      mismatchedFieldIds: []
    });
  });
  it('never equates an omitted group slot with a requested nonempty ID', async () => {
    const expected = await createProductMutationFingerprints(
      group.replace('<value/>', '<value>987654321</value>')
    );
    expect((await compareProductMutationFingerprints(omitted, expected.fieldExpectations)).matched).toBe(
      false
    );
  });
  it('does not generalize omitted-slot compatibility to other complex roots', async () => {
    const expected = await createProductMutationFingerprints(
      group.replace('id="productGroup"', 'id="attributes"')
    );
    expect(
      (
        await compareProductMutationFingerprints(
          omitted.replace('id="productGroup"', 'id="attributes"'),
          expected.fieldExpectations
        )
      ).matched
    ).toBe(false);
  });
  it('keeps changed group IDs, undeclared slots and attributed empty values strict', async () => {
    const expected = await createProductMutationFingerprints(group);
    for (const xml of [
      omitted.replace('123456789', '123456788'),
      omitted.replace('third_group_id', 'other_group'),
      group.replace('<value/>', '<value fileId="x"/>')
    ])
      expect((await compareProductMutationFingerprints(xml, expected.fieldExpectations)).matched).toBe(false);
  });
  it('verifies changed root fields inside a complete rendered schema', async () => {
    const expected = await createProductMutationFingerprints(PATCH);
    expect(expected.payloadFingerprint).toMatch(/^[0-9a-f]{64}$/u);
    expect(expected.fieldExpectations.map((item) => item.fieldId)).toEqual(['subject', 'keywords']);

    const comparison = await compareProductMutationFingerprints(
      `<itemSchema><field id="unrelated" type="input"><values><value>keep</value></values></field>${PATCH.replace('<itemSchema>', '').replace('</itemSchema>', '')}</itemSchema>`,
      expected.fieldExpectations
    );
    expect(comparison).toEqual({ matched: true, missingFieldIds: [], mismatchedFieldIds: [] });
  });

  it('reports rejected or missing field values without retaining XML', async () => {
    const expected = await createProductMutationFingerprints(PATCH);
    const comparison = await compareProductMutationFingerprints(
      `<itemSchema><field id="subject" type="input"><values><value lang="en">Old title</value></values></field></itemSchema>`,
      expected.fieldExpectations
    );
    expect(comparison).toEqual({
      matched: false,
      missingFieldIds: ['keywords'],
      mismatchedFieldIds: ['subject']
    });
  });
});
