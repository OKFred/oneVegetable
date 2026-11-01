import type {
  AlibabaClient,
  ProductAdapter,
  ProductSchemaUpdateRequest,
  ResponseOf
} from '@one-vegetable/core';
import { ProductReferenceClient } from '@one-vegetable/core/product-reference';
import { assertProductSchemaPriceUpdate } from '@one-vegetable/core/product-schema-price';
import { executeExtensionCapabilityCall } from './capability-call';
import { DOMParser } from 'linkedom';

export async function readSchemaPriceReference(client: AlibabaClient, productId: string, requestId: string) {
  if (client.protocol !== 'iop') throw new Error('ALIBABA_IOP_AUTHORIZATION_REQUIRED');
  return new ProductReferenceClient({
    async request(operation, payload) {
      if (operation !== 'callCapability' || payload === undefined)
        throw new Error('PRODUCT_SCHEMA_PRICE_READ_ONLY');
      return (await executeExtensionCapabilityCall(client, { ...payload }, requestId)) as ResponseOf<
        typeof operation
      >;
    }
  }).getProduct(productId);
}

export async function preflightSchemaPrice(
  products: ProductAdapter,
  client: AlibabaClient,
  request: ProductSchemaUpdateRequest,
  requestId: string
) {
  // MV3 has no DOM globals. Install the same local XML-only implementation used
  // by Node so the existing safe serializer can perform its full round-trip.
  if (typeof globalThis.DOMParser === 'undefined')
    Object.defineProperty(globalThis, 'DOMParser', { value: DOMParser });
  if (typeof globalThis.XMLSerializer === 'undefined')
    Object.defineProperty(globalThis, 'XMLSerializer', {
      value: class {
        serializeToString(node: Node) {
          return (node as unknown as { toString(): string }).toString();
        }
      }
    });
  const reference = await readSchemaPriceReference(client, request.productId, requestId);
  const schema = await products.renderSchema({
    productId: request.productId,
    categoryId: request.categoryId,
    language: request.language
  });
  return assertProductSchemaPriceUpdate(request, schema.xml, reference, {
    parseFromString: (xml) => new DOMParser().parseFromString(xml, 'text/xml') as unknown as XMLDocument
  });
}
