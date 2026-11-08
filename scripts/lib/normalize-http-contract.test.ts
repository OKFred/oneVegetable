import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { normalizeHttpContract } from './normalize-http-contract';

it('keeps the third-party shipping routes typed across repeated contract generation', () => {
  const document = JSON.parse(
    readFileSync(new URL('../../openapi/one-vegetable.json', import.meta.url), 'utf8')
  ) as Parameters<typeof normalizeHttpContract>[0];
  normalizeHttpContract(document);
  const first = JSON.stringify(document.paths);
  normalizeHttpContract(document);
  expect(JSON.stringify(document.paths)).toBe(first);
  for (const [action, schema] of [
    ['configuration', 'ShippingProviderTargetRequest'],
    ['save', 'ShippingProviderSaveRequest'],
    ['clear', 'ShippingProviderClearRequest'],
    ['quote', 'ShippingQuoteRequest']
  ] as const) {
    expect(document.paths['/admin/shipping-services/' + action]).toMatchObject({
      post: {
        requestBody: {
          content: { 'application/json': { schema: { $ref: '#/components/schemas/' + schema } } }
        }
      }
    });
  }
});
