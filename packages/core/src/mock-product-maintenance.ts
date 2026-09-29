// Explicit Web demo only; never exported from the production core barrel.
import fixture from '../../../mock/data/product-batch-maintenance.json';
import { MockGatewayClient } from './mock-client';
import {
  createProductMutationFingerprints,
  compareProductMutationFingerprints
} from './product-mutation-fingerprint';
import type { ProductMutationJob } from './product-mutation-job';
import type { ProductMutationJobClient } from './product-mutation-job-client';
import type { GalleryRequestOptions } from './gallery-transfer-context';
import type { OperationId, RequestOf, ResponseOf } from './types';

export class MockProductMaintenanceGateway extends MockGatewayClient {
  private readonly jobs = new Map<string, ProductMutationJob>();
  private readonly schemas = new Map<string, string>();
  productOperationContext() {
    return Promise.resolve({ identity: 'a'.repeat(64), gateway: 'b'.repeat(64) });
  }
  private getJob(id: string): ProductMutationJob {
    const job = this.jobs.get(id);
    if (!job) throw new Error('Job missing');
    return structuredClone(job);
  }
  readonly productMutationJobs: ProductMutationJobClient = {
    list: () =>
      Promise.resolve({
        items: [...this.jobs.values()].map((j) => structuredClone(j)),
        page: 1,
        pageSize: 100,
        total: this.jobs.size
      }),
    get: (id) => Promise.resolve(this.getJob(id)),
    refresh: async (id) => {
      const job = this.getJob(id);
      const comparison = await compareProductMutationFingerprints(
        this.schemas.get(job.productId) ?? fixture.xml,
        job.fieldExpectations
      );
      const updated: ProductMutationJob = {
        ...job,
        status: comparison.matched ? 'verified' : 'recovery-required',
        revision: job.revision + 1
      };
      this.jobs.set(id, updated);
      return updated;
    },
    recover: () => Promise.reject(new Error('Demo recovery not supported'))
  };
  override async request<K extends OperationId>(
    operation: K,
    payload: RequestOf<K>,
    options?: GalleryRequestOptions
  ): Promise<ResponseOf<K>> {
    if (options?.productContext && operation === 'renderProductSchema') {
      const input = payload as RequestOf<'renderProductSchema'>;
      return {
        xml: this.schemas.get(input.productId) ?? fixture.xml,
        categoryId: input.categoryId,
        language: input.language,
        market: 'wholesale'
      } as ResponseOf<K>;
    }
    if (options?.productBatchId && operation === 'updateProduct') {
      const input = payload as RequestOf<'updateProduct'>;
      const fp = await createProductMutationFingerprints(input.schemaPatchXml);
      const source = new DOMParser().parseFromString(
        this.schemas.get(input.productId) ?? fixture.xml,
        'application/xml'
      );
      const patch = new DOMParser().parseFromString(input.schemaPatchXml, 'application/xml');
      for (const field of Array.from(patch.documentElement.children)) {
        const original = Array.from(source.documentElement.children).find(
          (f) => f.getAttribute('id') === field.getAttribute('id')
        );
        if (!original) throw new Error('Unknown root');
        original.replaceWith(source.importNode(field, true));
      }
      this.schemas.set(input.productId, new XMLSerializer().serializeToString(source));
      const job: ProductMutationJob = {
        ...fixture.job,
        ...fp,
        id: crypto.randomUUID(),
        requestId: options.requestId ?? crypto.randomUUID(),
        productId: input.productId,
        categoryId: input.categoryId,
        language: input.language,
        operation: 'updateProduct',
        status: 'auditing',
        batchId: options.productBatchId,
        productContext: options.productContext ?? null
      };
      this.jobs.set(job.id, job);
      return { success: true, productId: input.productId, traceId: job.traceId, job } as ResponseOf<K>;
    }
    return super.request(operation, payload);
  }
}
