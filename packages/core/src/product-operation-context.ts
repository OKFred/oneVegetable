import { GatewayException } from './errors';
import { galleryGatewayId, opaqueGalleryId } from './gallery-transfer-context';
import type { GatewayCredentials } from './types';

/** Opaque configuration identities; no S3 dependency and no credential material. */
export interface ProductOperationContext {
  identity: string;
  gateway: string;
}

export interface ProductOperationOptions {
  productContext?: ProductOperationContext;
  productBatchId?: string;
}

export async function createProductOperationContext(
  actorId: string,
  credentials: GatewayCredentials
): Promise<ProductOperationContext> {
  return { identity: await opaqueGalleryId(actorId), gateway: await galleryGatewayId(credentials) };
}

export function isProductOperationContext(value: unknown): value is ProductOperationContext {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record: Record<string, unknown> = Object.fromEntries(Object.entries(value));
  return (
    Object.keys(record).length === 2 &&
    typeof record.identity === 'string' &&
    /^[a-f0-9]{64}$/u.test(record.identity) &&
    typeof record.gateway === 'string' &&
    /^[a-f0-9]{64}$/u.test(record.gateway)
  );
}

export function requireProductOperationContext(value: unknown): ProductOperationContext {
  if (!isProductOperationContext(value))
    throw new GatewayException({
      code: 'PRODUCT_CONTEXT_INVALID',
      message: 'PRODUCT_CONTEXT_INVALID',
      retryable: false
    });
  return value;
}

export function assertProductOperationContext(
  expected: ProductOperationContext,
  actual: ProductOperationContext
): void {
  requireProductOperationContext(expected);
  if (expected.identity !== actual.identity || expected.gateway !== actual.gateway)
    throw new GatewayException({
      code: 'PRODUCT_CONTEXT_CHANGED',
      message: 'PRODUCT_CONTEXT_CHANGED',
      retryable: false
    });
}
