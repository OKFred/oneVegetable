import { describe, expect, it } from 'vitest';
import { listCapabilityDefinitions } from '../src/capability-registry';
import * as lazy from '../src/capability-validation-lazy';
import * as worker from '../src/capability-validation-worker';
import { createCapabilityValidation } from '../src/capability-validation-engine';

describe('capability validators across page and MV3 runtimes', () => {
  it('uses a real request and response validator for every generated definition in all seven domains', async () => {
    for (const definition of listCapabilityDefinitions()) {
      for (const [kind, example] of [
        ['validateCapabilityRequest', definition.requestExample],
        ['validateCapabilityResponse', definition.responseExample]
      ] as const) {
        const issues = await worker[kind](definition.method, example);
        expect(issues, `${definition.method} ${kind}`).toEqual(await lazy[kind](definition.method, example));
        expect(
          issues.some((issue) => issue.keyword === 'validator'),
          definition.method
        ).toBe(false);
        const invalid = await worker[kind](definition.method, null);
        expect(invalid.length, definition.method).toBeGreaterThan(0);
        expect(
          invalid.some((issue) => issue.keyword === 'validator'),
          definition.method
        ).toBe(false);
      }
    }
  });

  it('does not treat missing methods, exports or a false validator without errors as valid', async () => {
    for (const method of ['missing.method', 'toString', '__proto__']) {
      expect(await worker.validateCapabilityRequest(method, {})).toMatchObject([{ keyword: 'validator' }]);
    }
    const missing = createCapabilityValidation(() => ({}));
    expect(await missing.validateCapabilityRequest('alibaba.icbu.product.list', {})).toMatchObject([
      { keyword: 'validator' }
    ]);
    const withoutErrors = createCapabilityValidation(
      () =>
        new Proxy(
          {},
          {
            get: (_target, property) => (property === 'then' ? undefined : () => false)
          }
        )
    );
    expect(await withoutErrors.validateCapabilityResponse('alibaba.icbu.product.list', {})).toMatchObject([
      { keyword: 'validator' }
    ]);
  });

  it('propagates loader errors and does not cache failed imports as successful validation', async () => {
    let attempts = 0;
    const broken = createCapabilityValidation(() => {
      attempts += 1;
      throw new Error('load failed');
    });
    await expect(broken.validateCapabilityRequest('alibaba.icbu.product.list', {})).rejects.toThrow(
      'load failed'
    );
    await expect(broken.validateCapabilityRequest('alibaba.icbu.product.list', {})).rejects.toThrow(
      'load failed'
    );
    expect(attempts).toBe(2);
  });

  it('keeps request errors isolated and does not alter parameter values', async () => {
    const good = { cat_id: 123, convert_type: 1 };
    const before = structuredClone(good);
    const [bad, valid] = await Promise.all([
      worker.validateCapabilityRequest('alibaba.icbu.category.id.mapping', { cat_id: 'invalid' }),
      worker.validateCapabilityRequest('alibaba.icbu.category.id.mapping', good)
    ]);
    expect(bad.length).toBeGreaterThan(0);
    expect(valid).toEqual([]);
    expect(good).toEqual(before);
  });
});
