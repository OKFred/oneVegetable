import { GatewayException } from './errors';
import { requireProductOperationContext } from './product-operation-context';
import type { ProductMutationJob } from './product-mutation-job';
import type { Product, ProductDisplayRequest, RequestOf, ResponseOf } from './types';

export function displayRequestForJob(
  job: ProductMutationJob,
  display: 'online' | 'offline'
): ProductDisplayRequest {
  const protocol = job.protocol ?? 'top';
  if (protocol === 'iop') requireProductOperationContext(job.productContext);
  else if (!job.encryptedProductId) throw mismatch();
  return {
    protocol,
    productIds: [job.productId],
    encryptedProductIds: job.encryptedProductId ? [job.encryptedProductId] : [],
    display
  };
}

/** Exact IDs only: never scan a shop or substitute ciphertext for an IOP numeric ID. */
export async function readProductDisplayTargets(
  list: (request: RequestOf<'listProducts'>) => Promise<ResponseOf<'listProducts'>>,
  request: ProductDisplayRequest
): Promise<Product[]> {
  const iop = request.protocol === 'iop';
  if (
    request.productIds.length === 0 ||
    (iop && request.productIds.length > 30) ||
    new Set(request.productIds).size !== request.productIds.length ||
    (request.encryptedProductIds.length !== request.productIds.length &&
      !(iop && request.encryptedProductIds.length === 0))
  )
    throw mismatch();
  const products: Product[] = [];
  for (const [index, productId] of request.productIds.entries()) {
    if (!/^[1-9][0-9]*$/u.test(productId)) throw mismatch();
    const result = await list({ productId, page: 1, pageSize: 1, language: 'en_US' });
    const product = result.items[0];
    if (
      result.items.length !== 1 ||
      result.total !== 1 ||
      product?.id !== productId ||
      !['online', 'offline', 'auditing'].includes(product.status) ||
      (!iop &&
        (!request.encryptedProductIds[index] || product.encryptedId !== request.encryptedProductIds[index]))
    )
      throw mismatch();
    products.push(product);
  }
  return products;
}

function mismatch(): GatewayException {
  return new GatewayException({
    code: 'PRODUCT_DISPLAY_TARGET_MISMATCH',
    message: 'PRODUCT_DISPLAY_TARGET_MISMATCH',
    retryable: false
  });
}
