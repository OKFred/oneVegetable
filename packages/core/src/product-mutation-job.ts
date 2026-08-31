import type { EntityAuditFields } from './audit';

export type ProductMutationJobOperation =
  'publishProduct' | 'saveProductDraft' | 'updateProduct' | 'updateProductDisplay';

export const PENDING_PRODUCT_MUTATION_ID_PREFIX = 'pending:';

export type ProductMutationJobStatus =
  | 'submitted'
  | 'auditing'
  | 'verifying'
  | 'verified'
  | 'recovery-required'
  | 'recovering'
  | 'recovered'
  | 'failed';

export interface ProductMutationFieldExpectation {
  fieldId: string;
  fingerprint: string;
}

export interface ProductMutationJob extends EntityAuditFields {
  id: string;
  requestId: string;
  productId: string;
  operation: ProductMutationJobOperation;
  status: ProductMutationJobStatus;
  categoryId: number | null;
  language: 'zh_CN' | 'en_US' | null;
  payloadFingerprint: string;
  fieldExpectations: ProductMutationFieldExpectation[];
  encryptedProductId: string | null;
  targetDisplay: 'online' | 'offline' | null;
  originalDisplay: 'online' | 'offline' | null;
  traceId: string | null;
  reasonCode: string | null;
  message: string | null;
  submittedTimeUtc: number;
  lastCheckedTimeUtc: number | null;
  completedTimeUtc: number | null;
}

export interface ProductMutationJobPage {
  items: ProductMutationJob[];
  page: number;
  pageSize: number;
  total: number;
}

export interface ProductMutationJobListRequest {
  requestId: string;
  page?: number;
  pageSize?: number;
  productId?: string;
  status?: ProductMutationJobStatus;
}

export interface ProductMutationJobGetRequest {
  requestId: string;
  id: string;
}

export interface ProductMutationJobRefreshRequest extends ProductMutationJobGetRequest {
  revision: number;
}

export type ProductMutationJobRecoverRequest = ProductMutationJobRefreshRequest;

export function productMutationJobIsBlocking(status: ProductMutationJobStatus): boolean {
  return (
    status === 'submitted' ||
    status === 'auditing' ||
    status === 'verifying' ||
    status === 'recovery-required' ||
    status === 'recovering'
  );
}

export function productMutationJobIsTerminal(status: ProductMutationJobStatus): boolean {
  return status === 'verified' || status === 'recovered' || status === 'failed';
}

export function productMutationJobHasResolvedProductId(job: ProductMutationJob): boolean {
  return /^[1-9][0-9]*$/u.test(job.productId);
}
