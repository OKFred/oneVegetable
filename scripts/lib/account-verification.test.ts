import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { readAccountVerificationSnapshot } from './account-verification';

describe('account verification snapshot', () => {
  it('contains only sanitized method outcomes and stable reason codes', async () => {
    const snapshot = await readAccountVerificationSnapshot(resolve(import.meta.dirname, '../..'));

    expect(snapshot.schemaVersion).toBe(1);
    expect(snapshot.results).toHaveLength(37);
    expect(snapshot.results).toContainEqual({
      method: 'alibaba.icbu.product.country.getcountrylist',
      status: 'passed',
      reasonCode: null
    });
    expect(snapshot.results).toContainEqual({
      method: 'alibaba.icbu.text.trans',
      status: 'permission-denied',
      reasonCode: 'isv.permission-api-package-limit'
    });
    expect(snapshot.results).toContainEqual({
      method: 'alibaba.icbu.rfq.search',
      status: 'permission-denied',
      reasonCode: 'isv.permission-api-package-limit'
    });
    expect(JSON.stringify(snapshot)).not.toMatch(/requestId|traceId|responseShape|accessToken/iu);
  });
});
