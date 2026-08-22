import { describe, expect, it, vi } from 'vitest';

import { BffProductMutationJobClient } from '../src/product-mutation-job-client';

import type { NetworkTransport } from '../src/network';

describe('product mutation job BFF client', () => {
  it('uses centralized POST transport and validates list and refresh responses', async () => {
    const send = vi.fn<NetworkTransport['send']>((input, init) => {
      const url =
        input instanceof URL ? input : typeof input === 'string' ? new URL(input) : new URL(input.url);
      if (typeof init.body !== 'string') throw new Error('expected JSON body');
      const body = JSON.parse(init.body) as Record<string, unknown>;
      expect(new Headers(init.headers).get('X-Request-ID')).toBe(body.requestId);
      const job = jobFixture();
      return Promise.resolve(
        Response.json({
          requestId: body.requestId,
          ok: true,
          data: url.pathname.endsWith('/list') ? { items: [job], page: 1, pageSize: 20, total: 1 } : job
        })
      );
    });
    const client = new BffProductMutationJobClient({
      baseUrl: 'https://staging.example.com',
      transport: { send }
    });

    await expect(client.list({ productId: '1601928079741' })).resolves.toMatchObject({ total: 1 });
    await expect(client.refresh(jobFixture().id, 2)).resolves.toMatchObject({ status: 'auditing' });
    expect(
      send.mock.calls.map(([input]) =>
        input instanceof URL ? input.href : typeof input === 'string' ? input : input.url
      )
    ).toEqual([
      'https://staging.example.com/api/v1/product-mutation-jobs/list',
      'https://staging.example.com/api/v1/product-mutation-jobs/refresh'
    ]);
  });
});

function jobFixture() {
  return {
    id: '2c70921f-f77a-4310-9d4b-091c66d022d0',
    requestId: 'a52678bd-2e7e-4182-a2f1-3558b2fa64a5',
    productId: '1601928079741',
    operation: 'updateProduct',
    status: 'auditing',
    categoryId: 201712702,
    language: 'en_US',
    payloadFingerprint: 'a'.repeat(64),
    fieldExpectations: [{ fieldId: 'subject', fingerprint: 'b'.repeat(64) }],
    traceId: 'trace-1',
    reasonCode: 'ALIBABA_MUTATION_ACCEPTED',
    message: '等待审核',
    submittedTimeUtc: 1,
    lastCheckedTimeUtc: null,
    completedTimeUtc: null,
    createTimeUtc: 1,
    updateTimeUtc: 2,
    creatorId: 'admin-1',
    updaterId: 'admin-1',
    revision: 2,
    remark: null
  } as const;
}
