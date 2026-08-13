type JsonSchema = boolean | Record<string, unknown>;

interface OpenApiDocument {
  servers?: { url: string }[];
  paths: Record<string, unknown>;
  components: {
    schemas: Record<string, JsonSchema>;
    responses?: Record<string, unknown>;
    [key: string]: unknown;
  };
}

const requestIdSchema = {
  type: 'string',
  format: 'uuid',
  pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
};

export function normalizeHttpContract(document: OpenApiDocument): void {
  document.servers = [{ url: '/api/v1' }];
  const schemas = document.components.schemas;
  schemas.RequestId = requestIdSchema;
  schemas.RequestEnvelope = {
    type: 'object',
    additionalProperties: false,
    required: ['requestId'],
    properties: { requestId: { $ref: '#/components/schemas/RequestId' } }
  };
  schemas.OperationCallRequest = {
    type: 'object',
    additionalProperties: false,
    required: ['requestId', 'operation', 'payload'],
    properties: {
      requestId: { $ref: '#/components/schemas/RequestId' },
      operation: { type: 'string', minLength: 1 },
      payload: { type: 'object', additionalProperties: true }
    }
  };
  schemas.ApiSuccess = {
    type: 'object',
    additionalProperties: false,
    required: ['requestId', 'ok', 'data'],
    properties: {
      requestId: { $ref: '#/components/schemas/RequestId' },
      ok: { const: true },
      data: true
    }
  };
  schemas.ApiFailure = {
    type: 'object',
    additionalProperties: false,
    required: ['requestId', 'ok', 'error'],
    properties: {
      requestId: { $ref: '#/components/schemas/RequestId' },
      ok: { const: false },
      error: { $ref: '#/components/schemas/GatewayError' }
    }
  };
  schemas.ProbeResponse = {
    type: 'object',
    additionalProperties: false,
    required: ['requestId', 'status'],
    properties: {
      requestId: { $ref: '#/components/schemas/RequestId' },
      status: { type: 'string', enum: ['ok', 'not-ready'] }
    }
  };
  schemas.BackendMeta = {
    type: 'object',
    additionalProperties: false,
    required: ['runtime', 'database', 'environment', 'gatewayMode', 'apiPrefix', 'version'],
    properties: {
      runtime: { type: 'string', enum: ['node', 'cloudflare'] },
      database: { type: 'string', enum: ['sqlite', 'd1'] },
      environment: { type: 'string' },
      gatewayMode: { type: 'string', enum: ['mock', 'disabled', 'real'] },
      apiPrefix: { type: 'string' },
      version: { type: 'string' }
    }
  };
  schemas.EncodedFilePayload = {
    type: 'object',
    additionalProperties: false,
    required: ['fileName', 'contentBase64', 'contentType', 'byteLength'],
    properties: {
      fileName: { type: 'string', minLength: 1, maxLength: 255 },
      contentBase64: { type: 'string', minLength: 1, contentEncoding: 'base64' },
      contentType: { type: 'string', minLength: 1 },
      byteLength: { type: 'integer', minimum: 1, maximum: 20971520 }
    }
  };
  schemas.PhotoUploadRequest = {
    allOf: [
      { $ref: '#/components/schemas/EncodedFilePayload' },
      {
        type: 'object',
        properties: { groupId: { type: 'string' } }
      }
    ]
  };
  schemas.RfqAttachmentUploadRequest = { $ref: '#/components/schemas/EncodedFilePayload' };

  const requestBody = (schema: string) => ({
    required: true,
    content: { 'application/json': { schema: { $ref: `#/components/schemas/${schema}` } } }
  });
  const envelopeResponse = (description: string) => ({
    description,
    headers: {
      'X-Request-ID': { schema: { $ref: '#/components/schemas/RequestId' } }
    },
    content: {
      'application/json': {
        schema: {
          oneOf: [{ $ref: '#/components/schemas/ApiSuccess' }, { $ref: '#/components/schemas/ApiFailure' }]
        }
      }
    }
  });

  document.paths = {
    '/healthz': {
      get: {
        summary: 'Check whether the API process is alive',
        operationId: 'healthCheck',
        responses: {
          '200': {
            description: 'Process is alive',
            headers: {
              'X-Request-ID': { schema: { $ref: '#/components/schemas/RequestId' } }
            },
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/ProbeResponse' } }
            }
          }
        }
      }
    },
    '/readyz': {
      get: {
        summary: 'Check database and migration readiness',
        operationId: 'readinessCheck',
        responses: {
          '200': {
            description: 'Application is ready',
            headers: {
              'X-Request-ID': { schema: { $ref: '#/components/schemas/RequestId' } }
            },
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/ProbeResponse' } }
            }
          },
          '503': envelopeResponse('Application is not ready')
        }
      }
    },
    '/meta/get': {
      post: {
        summary: 'Get runtime and environment metadata',
        operationId: 'getBackendMeta',
        requestBody: requestBody('RequestEnvelope'),
        responses: { '200': envelopeResponse('Backend metadata') }
      }
    },
    '/operations/call': {
      post: {
        summary: 'Call a typed oneVegetable operation',
        operationId: 'callOperation',
        requestBody: requestBody('OperationCallRequest'),
        responses: {
          '200': envelopeResponse('Operation result'),
          '400': envelopeResponse('Invalid request'),
          '403': envelopeResponse('Operation denied'),
          '503': envelopeResponse('Backend unavailable')
        }
      }
    }
  };
  document.components.responses = {
    ...(document.components.responses ?? {}),
    GatewayFailure: envelopeResponse('Gateway failure')
  };
}
