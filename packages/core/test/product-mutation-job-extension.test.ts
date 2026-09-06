import { describe, expect, it } from 'vitest';

import {
  ExtensionProductMutationJobClient,
  type ExtensionProductMutationJobRequest,
  type ProductMutationJob
} from '../src';

describe('ExtensionProductMutationJobClient', () => {
  it('uses a correlated runtime request and validates the returned page', async () => {
    let sent: ExtensionProductMutationJobRequest | null = null;
    const client = new ExtensionProductMutationJobClient({
      send(message) {
        sent = message;
        return Promise.resolve({
          requestId: message.requestId,
          ok: true,
          data: { items: [job()], page: 1, pageSize: 20, total: 1 }
        });
      }
    });

    const page = await client.list({ productId: '1600000000001' });

    expect(page.total).toBe(1);
    expect(sent).toMatchObject({
      kind: 'product-mutation-job-request',
      operation: 'list',
      payload: { productId: '1600000000001' }
    });
  });

  it('surfaces normalized runtime errors', async () => {
    const client = new ExtensionProductMutationJobClient({
      send(message) {
        return Promise.resolve({
          requestId: message.requestId,
          ok: false,
          error: {
            code: 'PRODUCT_MUTATION_JOB_NOT_FOUND',
            message: '商品写入任务不存在',
            retryable: false
          }
        });
      }
    });

    await expect(client.get(crypto.randomUUID())).rejects.toMatchObject({
      gatewayError: { code: 'PRODUCT_MUTATION_JOB_NOT_FOUND' }
    });
  });

  it('rejects a response with a different requestId', async () => {
    const client = new ExtensionProductMutationJobClient({
      send() {
        return Promise.resolve({
          requestId: crypto.randomUUID(),
          ok: true,
          data: job()
        });
      }
    });

    await expect(client.get(crypto.randomUUID())).rejects.toMatchObject({
      gatewayError: { code: 'INVALID_RUNTIME_RESPONSE' }
    });
  });

  it('uses the trusted page readback provider for update jobs', async () => {
    const sent: ExtensionProductMutationJobRequest[] = [];
    const current = job({
      operation: 'updateProduct',
      status: 'auditing',
      categoryId: 100,
      language: 'en_US',
      encryptedProductId: null,
      targetDisplay: null,
      originalDisplay: null,
      fieldExpectations: [{ fieldId: 'subject', fingerprint: 'b'.repeat(64) }]
    });
    const client = new ExtensionProductMutationJobClient(
      {
        send(message) {
          sent.push(message);
          return Promise.resolve({
            requestId: message.requestId,
            ok: true,
            data:
              message.operation === 'get'
                ? current
                : { ...current, status: 'verified', revision: current.revision + 1 }
          });
        }
      },
      {
        compare(value) {
          expect(value).toEqual(current);
          return Promise.resolve({ matched: true, missingFieldIds: [], mismatchedFieldIds: [] });
        }
      }
    );

    await expect(client.refresh(current.id, current.revision)).resolves.toMatchObject({
      status: 'verified'
    });
    expect(sent.map((message) => message.operation)).toEqual(['get', 'complete-update-readback']);
    expect(sent[1]?.payload).toMatchObject({
      id: current.id,
      revision: current.revision,
      result: { kind: 'comparison', comparison: { matched: true } }
    });
  });
});

function job(overrides: Partial<ProductMutationJob> = {}): ProductMutationJob {
  return {
    id: crypto.randomUUID(),
    requestId: crypto.randomUUID(),
    productId: '1600000000001',
    operation: 'updateProductDisplay',
    status: 'verifying',
    categoryId: null,
    language: null,
    payloadFingerprint: 'a'.repeat(64),
    fieldExpectations: [],
    encryptedProductId: 'encrypted-product-id',
    targetDisplay: 'offline',
    originalDisplay: 'online',
    traceId: crypto.randomUUID(),
    reasonCode: 'ALIBABA_DISPLAY_MUTATION_ACCEPTED',
    message: '等待回读',
    submittedTimeUtc: 1,
    lastCheckedTimeUtc: null,
    completedTimeUtc: null,
    createTimeUtc: 1,
    updateTimeUtc: 1,
    creatorId: 'extension:local-admin',
    updaterId: 'extension:local-admin',
    revision: 2,
    remark: null,
    ...overrides
  };
}
