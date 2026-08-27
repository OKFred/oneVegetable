import { describe, expect, it } from 'vitest';

import { inspectOpenApiQuality } from './openapi-quality';

function validDocument(): Record<string, unknown> {
  return {
    openapi: '3.1.1',
    paths: {
      '/healthz': {
        get: { responses: { '200': { description: 'Alive' } } }
      },
      '/operations/call': {
        post: {
          requestBody: {
            content: { 'application/json': { schema: { type: 'object' } } }
          },
          responses: {
            '200': { description: 'Success' },
            '400': { description: 'Invalid request' }
          }
        }
      }
    },
    components: { schemas: {} }
  };
}

describe('OpenAPI project quality rules', () => {
  it('accepts GET probes and POST JSON business operations', () => {
    expect(inspectOpenApiQuality(validDocument())).toEqual([]);
  });

  it('rejects non-POST operations, URL parameters and missing JSON or 4xx responses', () => {
    const document = validDocument();
    const paths = document.paths as Record<string, unknown>;
    paths['/products/get'] = {
      get: {
        parameters: [{ name: 'productId', in: 'query' }],
        responses: { '200': { description: 'Success' } }
      }
    };

    const messages = inspectOpenApiQuality(document).map(({ message }) => message);
    expect(messages).toContain('All non-probe operations must use POST.');
    expect(messages).toContain('Operation parameters are forbidden; use a JSON request body.');
    expect(messages).toContain('Non-probe operations must accept an application/json request body.');
    expect(messages).toContain('Non-probe operations must document at least one 4xx response.');
  });

  it('rejects reusable URL parameters and parameterized probes', () => {
    const document = validDocument();
    const paths = document.paths as Record<string, Record<string, unknown>>;
    const health = paths['/healthz'];
    if (!health) throw new Error('missing health fixture');
    health.parameters = [];
    document.components = {
      parameters: { Page: { name: 'page', in: 'query' } }
    };

    expect(inspectOpenApiQuality(document)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ pointer: '#/paths/~1healthz/parameters' }),
        expect.objectContaining({ pointer: '#/components/parameters' })
      ])
    );
  });
});
