type Schema = Record<string, unknown>;
const str = { type: 'string' };
const nullableText = { type: ['string', 'null'] };
const nullableNumber = { type: ['number', 'null'], minimum: 0 };
const id = { type: 'string', pattern: '^[1-9][0-9]*$' };
const object = (properties: Record<string, unknown>, required = Object.keys(properties)): Schema => ({
  type: 'object',
  additionalProperties: false,
  required,
  properties
});
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
export function addVideoContract(document: {
  paths: Record<string, unknown>;
  components: { schemas: Record<string, Schema> };
}): void {
  const s = document.components.schemas;
  s.VideoListRequest = object(
    {
      page: { type: 'integer', minimum: 1 },
      pageSize: { type: 'integer', enum: [20, 50] },
      title: { ...str, maxLength: 200 },
      id
    },
    ['page', 'pageSize']
  );
  s.VideoRelationRequest = object({
    videoId: { ...str, minLength: 1, maxLength: 256 },
    type: { type: 'string', enum: ['main', 'detail'] }
  });
  s.VideoProductRequest = object({
    encryptedProductId: { ...str, minLength: 1, maxLength: 256 },
    language: { type: 'string', enum: ['zh_CN', 'en_US'] }
  });
  const association = {
    productId: id,
    videoId: id,
    encryptedVideoId: { ...str, minLength: 1, maxLength: 256, pattern: '\\S' },
    type: { type: 'string', enum: ['main', 'detail'] },
    language: { type: 'string', enum: ['zh_CN', 'en_US'] }
  };
  s.VideoAssociationRequest = object({ ...association, confirmed: { type: 'boolean', const: true } });
  s.VideoAssociationVerifyRequest = object(association);
  s.VideoAssociationResult = object({
    outcome: { type: 'string', enum: ['confirmed', 'unconfirmed', 'rejected', 'unknown'] },
    traceId: nullableText,
    code: nullableText
  });
  s.Video = object({
    id: nullableText,
    encryptedId: nullableText,
    title: nullableText,
    coverUrl: nullableText,
    videoUrl: nullableText,
    width: nullableNumber,
    height: nullableNumber,
    fileSize: nullableNumber,
    durationRaw: nullableNumber,
    publishedAt: nullableNumber,
    status: nullableText,
    quality: nullableText,
    relatedProductCount: nullableNumber,
    publisher: nullableText
  });
  const meta = {
    traceId: str,
    queriedAt: { type: 'integer', minimum: 0 },
    issues: { type: 'array', items: str }
  };
  s.VideoPage = object({
    ...meta,
    items: { type: 'array', items: ref('Video') },
    page: { type: 'integer', minimum: 1 },
    pageSize: { type: 'integer', minimum: 1 },
    total: { type: ['integer', 'null'], minimum: 0 }
  });
  s.VideoRelations = object({
    ...meta,
    videoId: str,
    type: { type: 'string', enum: ['main', 'detail'] },
    encryptedProductIds: { type: 'array', items: str }
  });
  s.VideoProductSummary = object({
    id: str,
    subject: str,
    imageUrl: nullableText,
    detailUrl: nullableText,
    status: str
  });
  s.VideoProductResolution = object({
    ...meta,
    encryptedProductId: str,
    productId: nullableText,
    product: { oneOf: [ref('VideoProductSummary'), { type: 'null' }] },
    status: { type: 'string', enum: ['resolved', 'not-found', 'invalid-id'] }
  });
  for (const [operation, request, response, path] of [
    ['listVideos', 'VideoListRequest', 'VideoPage', 'list'],
    ['listVideoRelatedProducts', 'VideoRelationRequest', 'VideoRelations', 'relations'],
    ['resolveVideoRelatedProduct', 'VideoProductRequest', 'VideoProductResolution', 'resolve-product'],
    ['associateProductVideo', 'VideoAssociationRequest', 'VideoAssociationResult', 'associate'],
    [
      'verifyProductVideoAssociation',
      'VideoAssociationVerifyRequest',
      'VideoAssociationResult',
      'verify-association'
    ]
  ] as const) {
    document.paths[`/videos/${path}`] = {
      post: {
        operationId: operation,
        tags: ['Photos'],
        summary: operation,
        requestBody: { required: true, content: { 'application/json': { schema: ref(request) } } },
        responses: {
          '200': {
            description:
              operation === 'associateProductVideo'
                ? 'Controlled video association result'
                : 'Read-only video result',
            content: { 'application/json': { schema: ref(response) } }
          },
          '4XX': { $ref: '#/components/responses/GatewayFailure' },
          default: { $ref: '#/components/responses/GatewayFailure' }
        }
      }
    };
  }
}
