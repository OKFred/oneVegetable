import { describe, expect, it, vi } from 'vitest';

import {
  BffProductDescriptionTemplateClient,
  CompositeProductDescriptionTemplateClient,
  MemoryProductDescriptionTemplateClient
} from '../src/product-description-template-client';

import type { NetworkTransport } from '../src/network';

describe('product description template clients', () => {
  it('uses centralized JSON POST transport, requestId and CSRF for the BFF client', async () => {
    const send = vi.fn<NetworkTransport['send']>((input, init) => {
      const url =
        input instanceof URL ? input : typeof input === 'string' ? new URL(input) : new URL(input.url);
      if (typeof init.body !== 'string') throw new Error('expected JSON body');
      const body = JSON.parse(init.body) as Record<string, unknown>;
      expect(new Headers(init.headers).get('X-Request-ID')).toBe(body.requestId);
      expect(new Headers(init.headers).get('X-CSRF-Token')).toBe('csrf-token');
      if (url.pathname.endsWith('/operations/availability/get')) {
        return Promise.resolve(
          Response.json({
            requestId: body.requestId,
            ok: true,
            data: {
              items: [{ operation: 'saveProductDraft', allowed: true, reasonCode: 'ADMIN_MUTATION_ALLOWED' }]
            }
          })
        );
      }
      expect(url.pathname).toBe('/api/v1/product-description-templates/list');
      return Promise.resolve(
        Response.json({
          requestId: body.requestId,
          ok: true,
          data: { items: [templateFixture()], page: 1, pageSize: 20, total: 1 }
        })
      );
    });
    const client = new BffProductDescriptionTemplateClient({
      baseUrl: 'https://staging.example.com',
      transport: { send },
      csrfToken: () => 'csrf-token'
    });

    await expect(client.list({ language: 'en_US' })).resolves.toMatchObject({ total: 1 });
    await expect(client.get(['saveProductDraft'])).resolves.toMatchObject({
      items: [{ operation: 'saveProductDraft', allowed: true }]
    });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('provides writable mock and read-only bundled adapters with optimistic revisions', async () => {
    let now = 10;
    const writable = new MemoryProductDescriptionTemplateClient([], {
      actorId: 'mock:editor',
      clock: () => now
    });
    const created = await writable.create({
      name: 'Company',
      category: 'company',
      language: 'en_US',
      html: '<div><h2>About</h2><script>bad()</script></div>'
    });
    expect(created).toMatchObject({ html: '<h2>About</h2>', revision: 1 });

    now += 1;
    const updated = await writable.update({
      ...created,
      name: 'Company profile',
      html: '<p>Updated</p>',
      remark: null
    });
    expect(updated).toMatchObject({ revision: 2, updateTimeUtc: now });
    await expect(
      writable.update({ ...created, name: 'Stale', html: '<p>Stale</p>', remark: null })
    ).rejects.toMatchObject({ gatewayError: { code: 'ENTITY_VERSION_CONFLICT' } });

    const readOnly = new MemoryProductDescriptionTemplateClient([templateFixture()], {
      writable: false
    });
    await expect(readOnly.list()).resolves.toMatchObject({ total: 1 });
    await expect(
      readOnly.create({
        name: 'Denied',
        category: 'custom',
        language: 'en_US',
        html: '<p>Denied</p>'
      })
    ).rejects.toMatchObject({ gatewayError: { code: 'TEMPLATE_WRITE_UNAVAILABLE' } });
  });

  it('merges bundled and shared templates while delegating writes to the shared provider', async () => {
    const bundled = new MemoryProductDescriptionTemplateClient([templateFixture()], { writable: false });
    const shared = new MemoryProductDescriptionTemplateClient([], {
      actorId: 'mock:editor',
      clock: () => 20
    });
    const client = new CompositeProductDescriptionTemplateClient(bundled, shared);

    const created = await client.create({
      name: 'Custom service',
      category: 'service',
      language: 'en_US',
      html: '<h2>Support</h2>'
    });
    await expect(client.list({ language: 'en_US' })).resolves.toMatchObject({
      total: 2,
      items: [{ creatorId: 'system:bundled' }, { id: created.id, creatorId: 'mock:editor' }]
    });
    await expect(client.archive(templateFixture().id, 1)).rejects.toMatchObject({
      gatewayError: { code: 'TEMPLATE_NOT_FOUND' }
    });
  });
});

function templateFixture() {
  return {
    id: '0e918103-f88c-4b42-9704-bc42b074345e',
    name: 'Logistics',
    category: 'logistics',
    language: 'en_US',
    html: '<h2>Shipping</h2>',
    status: 'active',
    createTimeUtc: 1,
    updateTimeUtc: 1,
    creatorId: 'system:bundled',
    updaterId: 'system:bundled',
    revision: 1,
    remark: null
  } as const;
}
