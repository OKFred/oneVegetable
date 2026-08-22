import type { EntityAuditFields } from './audit';

export type ProductMutationJobOperation = 'updateProduct';

export type ProductMutationJobStatus = 'submitted' | 'auditing' | 'verified' | 'recovery-required' | 'failed';

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
  categoryId: number;
  language: 'zh_CN' | 'en_US';
  payloadFingerprint: string;
  fieldExpectations: ProductMutationFieldExpectation[];
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

export function productMutationJobIsBlocking(status: ProductMutationJobStatus): boolean {
  return status === 'submitted' || status === 'auditing' || status === 'recovery-required';
}

export function productMutationJobIsTerminal(status: ProductMutationJobStatus): boolean {
  return status === 'verified' || status === 'failed';
}
