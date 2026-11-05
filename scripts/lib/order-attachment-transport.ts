type Schema = Record<string, unknown>;
const ref = (name: string) => ({ $ref: '#/components/schemas/' + name });
const uuid = { type: 'string', format: 'uuid' };
const hash = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const time = { type: 'integer', minimum: 0 };
const nullableText = { type: ['string', 'null'], maxLength: 2048 };
const object = (properties: Record<string, Schema>, required = Object.keys(properties)): Schema => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false
});
export function orderAttachmentTransportSchemas(): Record<string, Schema> {
  return {
    OrderAttachmentFile: object({
      fileName: { type: 'string', minLength: 1, maxLength: 255, pattern: '^[^\\\\/\\u0000-\\u001f]+$' },
      contentType: { enum: ['image/jpeg', 'image/png', 'application/pdf', 'application/msword'] },
      byteLength: { type: 'integer', minimum: 1, maximum: 5_000_000 },
      contentBase64: {
        type: 'string',
        minLength: 4,
        contentEncoding: 'base64',
        maxLength: 4 * Math.ceil(5_000_000 / 3),
        writeOnly: true,
        pattern: '^[A-Za-z0-9+/]*={0,2}$'
      }
    }),
    OrderAttachmentUploadRequest: object({
      requestId: uuid,
      file: ref('OrderAttachmentFile'),
      context: ref('GalleryTransferContext')
    }),
    OrderAttachmentGetRequest: object({ requestId: uuid, jobId: uuid }),
    OrderAttachmentReceipt: object({
      jobId: uuid,
      requestId: uuid,
      status: { enum: ['sending', 'accepted', 'failed', 'unknown'] },
      fileName: { type: 'string', minLength: 1, maxLength: 255 },
      sha256: hash,
      size: { type: 'integer', minimum: 1, maximum: 5_000_000 },
      createdTimeUtc: time,
      updatedTimeUtc: time,
      gatewayId: hash,
      protocol: { const: 'iop' },
      platformReference: nullableText,
      errorCode: { type: ['string', 'null'], maxLength: 160, pattern: '^[A-Za-z0-9_.;:-]+$' },
      traceId: { type: ['string', 'null'], maxLength: 160, pattern: '^[A-Za-z0-9_-]+$' }
    }),
    OrderAttachmentResponse: object({
      requestId: uuid,
      ok: { const: true },
      data: ref('OrderAttachmentReceipt')
    })
  };
}
export function orderAttachmentTransportPaths(): Record<string, unknown> {
  return Object.fromEntries(
    ['upload', 'get'].map((action) => [
      '/order-attachments/' + action,
      {
        post: {
          operationId: action === 'upload' ? 'orderAttachmentUpload' : 'orderAttachmentGet',
          summary:
            action === 'upload'
              ? 'Upload an IOP attachment with a durable, non-replaying receipt'
              : 'Read an owned attachment receipt without resending the file',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: ref(
                  action === 'upload' ? 'OrderAttachmentUploadRequest' : 'OrderAttachmentGetRequest'
                )
              }
            }
          },
          responses: {
            '200': {
              description: 'Attachment receipt, not an order association',
              content: { 'application/json': { schema: ref('OrderAttachmentResponse') } }
            },
            '4XX': { $ref: '#/components/responses/GatewayFailure' },
            default: { $ref: '#/components/responses/GatewayFailure' }
          }
        }
      }
    ])
  );
}
