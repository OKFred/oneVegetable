// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import {
  compareProductMutationFingerprints,
  createProductMutationFingerprints
} from '../src/product-mutation-fingerprint';

const PATCH = `<itemSchema><field id="subject" name="Title" type="input"><values><value lang="en">New title</value></values></field><field id="keywords" name="Keywords" type="multiInput"><values><value>bag</value><value>leather</value></values></field></itemSchema>`;

describe('product mutation fingerprints', () => {
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
