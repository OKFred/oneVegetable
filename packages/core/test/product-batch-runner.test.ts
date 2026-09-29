// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import fixture from '../../../mock/data/product-batch-maintenance.json';
import { ProductBatchMaintenanceRunner } from '../src/product-batch-runner';
import { GatewayException } from '../src/errors';
import type { GalleryRequestOptions } from '../src/gallery-transfer-context';
import type { GatewayClient, Product, OperationId, RequestOf, ResponseOf } from '../src/types';
import type { ProductMutationJob } from '../src/product-mutation-job';
import type { ProductMutationJobClient } from '../src/product-mutation-job-client';
const xml = readFileSync(resolve('mock/data/product-schema/batch-maintenance.xml'), 'utf8');
const rules = { groupPath: null, keywords: { action: 'append', values: ['Linen'] } } as const;
function setup() {
  let now = 1000;
  const context = { identity: 'a'.repeat(64), gateway: 'b'.repeat(64) };
  const calls: { operation: string; at: number; payload: unknown; options?: GalleryRequestOptions }[] = [];
  const jobs: ProductMutationJob[] = [];
  let schema = xml;
  let mutationError: 'business' | 'unknown' | null = null;
  let updated: (() => void) | undefined;
  const product: Product = { ...fixture.product, status: 'online' };
  const gateway: GatewayClient = {
    productOperationContext: () => Promise.resolve({ ...context }),
    request<K extends OperationId>(
      operation: K,
      payload: RequestOf<K>,
      options?: GalleryRequestOptions
    ): Promise<ResponseOf<K>> {
      calls.push({ operation, at: now, payload, ...(options ? { options } : {}) });
      let result: unknown;
      if (operation === 'listProducts') {
        const query = payload as RequestOf<'listProducts'>;
        result = { items: [{ ...product, id: query.productId }], page: 1, pageSize: 1, total: 1 };
      } else if (operation === 'renderProductSchema') {
        result = { xml: schema, categoryId: 123, language: 'en_US', market: 'wholesale' };
      } else if (operation === 'updateProduct') {
        const request = payload as RequestOf<'updateProduct'>;
        const job: ProductMutationJob = {
          ...fixture.job,
          id: crypto.randomUUID(),
          requestId: options?.requestId ?? '',
          batchId: options?.productBatchId ?? null,
          productContext: options?.productContext ?? null,
          productId: request.productId,
          operation: 'updateProduct',
          status:
            mutationError === 'business'
              ? 'failed'
              : mutationError === 'unknown'
                ? 'recovery-required'
                : 'auditing',
          language: 'en_US'
        };
        jobs.push(job);
        updated?.();
        if (mutationError)
          throw new GatewayException({
            code: mutationError === 'business' ? 'isv.invalid-parameter' : 'NETWORK_TIMEOUT',
            message: 'Provider response',
            retryable: false
          });
        result = { success: true, productId: request.productId, traceId: 'batch-test', job };
      } else throw new Error(operation);
      return Promise.resolve(result as ResponseOf<K>);
    }
  };
  const jobClient: ProductMutationJobClient = {
    list: () => Promise.resolve({ items: jobs, page: 1, pageSize: 100, total: jobs.length }),
    get: (id) =>
      Promise.resolve(
        jobs.find((job) => job.id === id) ??
          (() => {
            throw new Error('missing');
          })()
      ),
    recover: () => Promise.reject(new Error('No automatic recovery allowed')),
    refresh: (id) => {
      const job = jobs.find((entry) => entry.id === id);
      if (!job) throw new Error('missing');
      calls.push({ operation: 'readback', at: now, payload: id });
      return Promise.resolve({ ...job, status: 'verified', revision: job.revision + 1 });
    }
  };
  const runner = new ProductBatchMaintenanceRunner({
    gateway,
    jobs: jobClient,
    products: [product, { ...product, id: '302' }],
    language: 'en_US',
    now: () => now,
    wait: (ms) => {
      now += ms;
      return Promise.resolve();
    }
  });
  return {
    runner,
    calls,
    jobs,
    context,
    setSchema: (value: string) => {
      schema = value;
    },
    fail: (value: typeof mutationError) => {
      mutationError = value;
    },
    afterWrite: (callback: () => void) => {
      updated = callback;
    }
  };
}
describe('batch maintenance scheduling', () => {
  const preview = (runner: ProductBatchMaintenanceRunner) =>
    runner.preview({ groupPath: null, keywords: { ...rules.keywords, values: [...rules.keywords.values] } });
  it('only submits after preview, serializes requests, verifies receipts and excludes unchanged roots', async () => {
    const { runner, calls } = setup();
    await preview(runner);
    expect(calls.every((call) => call.operation !== 'updateProduct')).toBe(true);
    await runner.execute();
    expect(runner.items.map((item) => item.state)).toEqual(['verified', 'verified']);
    const writes = calls.filter((call) => call.operation === 'updateProduct');
    expect(writes).toHaveLength(2);
    expect(writes[0]?.options?.productBatchId).toBe(runner.batchId);
    expect(JSON.stringify(writes[0]?.payload)).not.toContain('subject');
    expect(calls.slice(1).every((call, index) => call.at - (calls[index]?.at ?? 0) >= 300)).toBe(true);
    expect(calls.find((call) => call.operation === 'readback')?.at).toBeGreaterThanOrEqual(
      (writes[0]?.at ?? 0) + 5000
    );
    await expect(runner.execute()).rejects.toThrow();
  });
  it('requires re-preview for a changed target but accepts an unrelated title change', async () => {
    const changed = setup();
    await preview(changed.runner);
    changed.setSchema(xml.replace('Cotton shirt', 'Changed keyword'));
    await changed.runner.execute();
    expect(changed.calls.filter((call) => call.operation === 'updateProduct')).toHaveLength(0);
    expect(changed.runner.items[0]?.state).toBe('conflict');
    const unrelated = setup();
    await preview(unrelated.runner);
    unrelated.setSchema(xml.replace('Do not change', 'Title changed elsewhere'));
    await unrelated.runner.execute();
    expect(unrelated.jobs).toHaveLength(2);
  });
  it('does not send the next item after leave/stop, while retaining the active receipt', async () => {
    const test = setup();
    await preview(test.runner);
    test.afterWrite(() => {
      test.runner.stop();
    });
    await test.runner.execute();
    expect(test.jobs).toHaveLength(1);
    expect(test.runner.items[0]?.job).not.toBeNull();
    expect(test.runner.items[1]?.requestId).toBeNull();
  });
  it('stops the batch on unknown results and never retries the mutation', async () => {
    const test = setup();
    await preview(test.runner);
    test.fail('unknown');
    await test.runner.execute();
    expect(test.jobs).toHaveLength(1);
    expect(test.runner.items[0]?.state).toBe('unknown');
  });
  it('continues after a recorded explicit business rejection', async () => {
    const test = setup();
    await preview(test.runner);
    test.fail('business');
    await test.runner.execute();
    expect(test.jobs).toHaveLength(2);
    expect(test.runner.items.every((item) => item.state === 'failed')).toBe(true);
  });
  it('pins account context and freezes per-item exclusion', async () => {
    const test = setup();
    await preview(test.runner);
    test.context.gateway = 'c'.repeat(64);
    await expect(test.runner.execute()).rejects.toMatchObject({
      gatewayError: { code: 'PRODUCT_CONTEXT_CHANGED' }
    });
    expect(test.jobs).toHaveLength(0);
    const selected = setup();
    await preview(selected.runner);
    const second = selected.runner.items[1];
    if (second) second.selected = false;
    await selected.runner.execute();
    expect(selected.jobs).toHaveLength(1);
  });
});
