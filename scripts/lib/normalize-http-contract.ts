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
      gatewayMode: { type: 'string', enum: ['mock', 'replay', 'disabled', 'real'] },
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
  schemas.AlibabaGatewayStatus = {
    type: 'object',
    additionalProperties: false,
    required: [
      'source',
      'configured',
      'hasAppKey',
      'hasAppSecret',
      'hasAccessToken',
      'endpointOrigin',
      'signMethod',
      'realReadEnabled',
      'mutationEnabled'
    ],
    properties: {
      source: { type: 'string', enum: ['environment', 'documentation-replay'] },
      configured: { type: 'boolean' },
      hasAppKey: { type: 'boolean' },
      hasAppSecret: { type: 'boolean' },
      hasAccessToken: { type: 'boolean' },
      endpointOrigin: { type: 'string' },
      signMethod: { type: 'string', enum: ['hmac', 'md5', 'hmac-sha256'] },
      realReadEnabled: { type: 'boolean' },
      mutationEnabled: { const: false }
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
  schemas.UserRole = { type: 'string', enum: ['admin', 'user'] };
  schemas.UserStatus = { type: 'string', enum: ['active', 'disabled'] };
  schemas.AuthBootstrapStatus = {
    type: 'object',
    additionalProperties: false,
    required: ['initialized', 'bootstrapTokenConfigured', 'bootstrapAvailable'],
    properties: {
      initialized: { type: 'boolean' },
      bootstrapTokenConfigured: { type: 'boolean' },
      bootstrapAvailable: { type: 'boolean' }
    }
  };
  schemas.AuthBootstrapStatusResponse = {
    type: 'object',
    additionalProperties: false,
    required: ['requestId', 'ok', 'data'],
    properties: {
      requestId: { $ref: '#/components/schemas/RequestId' },
      ok: { const: true },
      data: { $ref: '#/components/schemas/AuthBootstrapStatus' }
    }
  };
  schemas.AuthBootstrapRequest = objectRequest(['requestId', 'bootstrapToken', 'username', 'password'], {
    bootstrapToken: { type: 'string' },
    username: { type: 'string' },
    password: { type: 'string', minLength: 12, maxLength: 256 },
    remark: { type: ['string', 'null'], maxLength: 500 }
  });
  schemas.AuthLoginRequest = objectRequest(['requestId', 'username', 'password'], {
    username: { type: 'string' },
    password: { type: 'string', minLength: 12, maxLength: 256 }
  });
  schemas.AuthPasswordChangeRequest = objectRequest(['requestId', 'currentPassword', 'newPassword'], {
    currentPassword: { type: 'string' },
    newPassword: { type: 'string', minLength: 12, maxLength: 256 }
  });
  schemas.PageRequest = objectRequest([], {
    page: { type: 'integer', minimum: 1, default: 1 },
    pageSize: { type: 'integer', minimum: 1, maximum: 100, default: 20 }
  });
  schemas.AdminUserCreateRequest = objectRequest(['requestId', 'username', 'password', 'role'], {
    username: { type: 'string' },
    password: { type: 'string', minLength: 12, maxLength: 256 },
    role: { $ref: '#/components/schemas/UserRole' },
    remark: { type: ['string', 'null'], maxLength: 500 }
  });
  schemas.AdminUserUpdateRequest = objectRequest(
    ['requestId', 'userId', 'role', 'status', 'revision', 'remark'],
    {
      userId: { type: 'string', format: 'uuid' },
      role: { $ref: '#/components/schemas/UserRole' },
      status: { $ref: '#/components/schemas/UserStatus' },
      revision: { type: 'integer', minimum: 1 },
      remark: { type: ['string', 'null'], maxLength: 500 }
    }
  );
  schemas.AdminPasswordResetRequest = objectRequest(['requestId', 'userId', 'revision'], {
    userId: { type: 'string', format: 'uuid' },
    revision: { type: 'integer', minimum: 1 },
    newPassword: { type: 'string', minLength: 12, maxLength: 256 }
  });
  schemas.AdminUserTargetRequest = objectRequest(['requestId', 'userId'], {
    userId: { type: 'string', format: 'uuid' }
  });
  schemas.AdminAuditListRequest = objectRequest([], {
    requestIdFilter: { $ref: '#/components/schemas/RequestId' },
    actorId: { type: 'string' },
    action: { type: 'string' },
    outcome: { type: 'string', enum: ['success', 'error', 'denied'] },
    fromTimeUtc: { type: 'integer', minimum: 0 },
    toTimeUtc: { type: 'integer', minimum: 0 },
    page: { type: 'integer', minimum: 1, default: 1 },
    pageSize: { type: 'integer', minimum: 1, maximum: 100, default: 20 }
  });
  schemas.AdminRequestEventListRequest = objectRequest([], {
    requestIdFilter: { $ref: '#/components/schemas/RequestId' },
    actorId: { type: 'string' },
    route: { type: 'string' },
    operation: { type: 'string' },
    outcome: { type: 'string', enum: ['success', 'error', 'denied'] },
    fromTimeUtc: { type: 'integer', minimum: 0 },
    toTimeUtc: { type: 'integer', minimum: 0 },
    page: { type: 'integer', minimum: 1, default: 1 },
    pageSize: { type: 'integer', minimum: 1, maximum: 100, default: 20 }
  });
  schemas.ProductMutationFieldExpectation = {
    type: 'object',
    additionalProperties: false,
    required: ['fieldId', 'fingerprint'],
    properties: {
      fieldId: { type: 'string', minLength: 1, maxLength: 128 },
      fingerprint: { type: 'string', pattern: '^[0-9a-f]{64}$' }
    }
  };
  schemas.ProductMutationJob = {
    type: 'object',
    additionalProperties: false,
    required: [
      'id',
      'requestId',
      'productId',
      'operation',
      'status',
      'categoryId',
      'language',
      'payloadFingerprint',
      'fieldExpectations',
      'encryptedProductId',
      'targetDisplay',
      'originalDisplay',
      'traceId',
      'reasonCode',
      'message',
      'submittedTimeUtc',
      'lastCheckedTimeUtc',
      'completedTimeUtc',
      'createTimeUtc',
      'updateTimeUtc',
      'creatorId',
      'updaterId',
      'revision',
      'remark'
    ],
    properties: {
      id: { type: 'string', format: 'uuid' },
      requestId: { $ref: '#/components/schemas/RequestId' },
      productId: { type: 'string', pattern: '^[1-9][0-9]*$' },
      operation: { type: 'string', enum: ['updateProduct', 'updateProductDisplay'] },
      status: {
        type: 'string',
        enum: [
          'submitted',
          'auditing',
          'verifying',
          'verified',
          'recovery-required',
          'recovering',
          'recovered',
          'failed'
        ]
      },
      categoryId: { type: ['integer', 'null'], minimum: 1 },
      language: { type: ['string', 'null'], enum: ['zh_CN', 'en_US', null] },
      payloadFingerprint: { type: 'string', pattern: '^[0-9a-f]{64}$' },
      fieldExpectations: {
        type: 'array',
        maxItems: 128,
        items: { $ref: '#/components/schemas/ProductMutationFieldExpectation' }
      },
      encryptedProductId: { type: ['string', 'null'] },
      targetDisplay: { type: ['string', 'null'], enum: ['online', 'offline', null] },
      originalDisplay: { type: ['string', 'null'], enum: ['online', 'offline', null] },
      traceId: { type: ['string', 'null'] },
      reasonCode: { type: ['string', 'null'] },
      message: { type: ['string', 'null'] },
      submittedTimeUtc: { type: 'integer', minimum: 0 },
      lastCheckedTimeUtc: { type: ['integer', 'null'], minimum: 0 },
      completedTimeUtc: { type: ['integer', 'null'], minimum: 0 },
      createTimeUtc: { type: 'integer', minimum: 0 },
      updateTimeUtc: { type: 'integer', minimum: 0 },
      creatorId: { type: 'string' },
      updaterId: { type: 'string' },
      revision: { type: 'integer', minimum: 1 },
      remark: { type: ['string', 'null'], maxLength: 500 }
    }
  };
  schemas.ProductMutationJobListRequest = objectRequest([], {
    page: { type: 'integer', minimum: 1, default: 1 },
    pageSize: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
    productId: { type: 'string', pattern: '^[1-9][0-9]*$' },
    status: {
      type: 'string',
      enum: [
        'submitted',
        'auditing',
        'verifying',
        'verified',
        'recovery-required',
        'recovering',
        'recovered',
        'failed'
      ]
    }
  });
  schemas.ProductMutationJobGetRequest = objectRequest(['requestId', 'id'], {
    id: { type: 'string', format: 'uuid' }
  });
  schemas.ProductMutationJobRefreshRequest = objectRequest(['requestId', 'id', 'revision'], {
    id: { type: 'string', format: 'uuid' },
    revision: { type: 'integer', minimum: 1 }
  });
  schemas.ProductMutationJobPage = {
    type: 'object',
    additionalProperties: false,
    required: ['items', 'page', 'pageSize', 'total'],
    properties: {
      items: { type: 'array', items: { $ref: '#/components/schemas/ProductMutationJob' } },
      page: { type: 'integer', minimum: 1 },
      pageSize: { type: 'integer', minimum: 1 },
      total: { type: 'integer', minimum: 0 }
    }
  };
  const productMutationResult = schemas.ProductMutationResult;
  if (typeof productMutationResult === 'object') {
    const properties = productMutationResult.properties;
    if (typeof properties === 'object' && properties !== null) {
      (properties as Record<string, unknown>).job = { $ref: '#/components/schemas/ProductMutationJob' };
    }
  }
  const productDisplayMutationResult = schemas.ProductDisplayMutationResult;
  if (typeof productDisplayMutationResult === 'object') {
    const properties = productDisplayMutationResult.properties;
    if (typeof properties === 'object' && properties !== null) {
      (properties as Record<string, unknown>).jobs = {
        type: 'array',
        items: { $ref: '#/components/schemas/ProductMutationJob' }
      };
    }
  }

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
  const postOperation = (summary: string, operationId: string, requestSchema: string) => ({
    post: {
      summary,
      operationId,
      requestBody: requestBody(requestSchema),
      responses: {
        '200': envelopeResponse('Operation succeeded'),
        '400': envelopeResponse('Invalid request'),
        '401': envelopeResponse('Authentication required'),
        '403': envelopeResponse('Operation denied'),
        '409': envelopeResponse('Entity conflict')
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
        responses: {
          '200': envelopeResponse('Backend metadata'),
          '400': envelopeResponse('Invalid request')
        }
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
    },
    '/product-mutation-jobs/list': postOperation(
      'List durable product mutation jobs',
      'listProductMutationJobs',
      'ProductMutationJobListRequest'
    ),
    '/product-mutation-jobs/get': postOperation(
      'Get one durable product mutation job',
      'getProductMutationJob',
      'ProductMutationJobGetRequest'
    ),
    '/product-mutation-jobs/refresh': postOperation(
      'Refresh one product mutation job from Alibaba readback',
      'refreshProductMutationJob',
      'ProductMutationJobRefreshRequest'
    ),
    '/product-mutation-jobs/recover': postOperation(
      'Restore the original product display state for a recovery-required job',
      'recoverProductMutationJob',
      'ProductMutationJobRefreshRequest'
    ),
    '/auth/session/get': postOperation('Get the current opaque session', 'getAuthSession', 'RequestEnvelope'),
    '/auth/bootstrap/status/get': {
      post: {
        summary: 'Get local administrator bootstrap availability',
        operationId: 'getAuthBootstrapStatus',
        requestBody: requestBody('RequestEnvelope'),
        responses: {
          '200': {
            description: 'Bootstrap availability',
            headers: {
              'X-Request-ID': { schema: { $ref: '#/components/schemas/RequestId' } }
            },
            content: {
              'application/json': {
                schema: {
                  oneOf: [
                    { $ref: '#/components/schemas/AuthBootstrapStatusResponse' },
                    { $ref: '#/components/schemas/ApiFailure' }
                  ]
                }
              }
            }
          },
          '400': {
            description: 'Invalid request',
            headers: {
              'X-Request-ID': { schema: { $ref: '#/components/schemas/RequestId' } }
            },
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/ApiFailure' } }
            }
          }
        }
      }
    },
    '/auth/bootstrap': postOperation(
      'Create the first local administrator',
      'bootstrapAdmin',
      'AuthBootstrapRequest'
    ),
    '/auth/login': postOperation('Create an opaque local session', 'login', 'AuthLoginRequest'),
    '/auth/logout': postOperation('Revoke the current opaque session', 'logout', 'RequestEnvelope'),
    '/auth/password/change': postOperation(
      'Change the current user password',
      'changePassword',
      'AuthPasswordChangeRequest'
    ),
    '/admin/users/list': postOperation('List local users', 'listAdminUsers', 'PageRequest'),
    '/admin/users/create': postOperation('Create a local user', 'createAdminUser', 'AdminUserCreateRequest'),
    '/admin/users/update': postOperation('Update a local user', 'updateAdminUser', 'AdminUserUpdateRequest'),
    '/admin/users/password/reset': postOperation(
      'Reset a local user password',
      'resetAdminUserPassword',
      'AdminPasswordResetRequest'
    ),
    '/admin/users/sessions/revoke': postOperation(
      'Revoke all sessions for a local user',
      'revokeAdminUserSessions',
      'AdminUserTargetRequest'
    ),
    '/admin/audit-events/list': postOperation(
      'List append-only audit events',
      'listAdminAuditEvents',
      'AdminAuditListRequest'
    ),
    '/admin/system/get': postOperation('Get protected system metadata', 'getAdminSystem', 'RequestEnvelope'),
    '/admin/policy-summary/get': postOperation(
      'Get the read-only ABAC policy summary',
      'getAdminPolicySummary',
      'RequestEnvelope'
    ),
    '/admin/request-events/list': postOperation(
      'List redacted request diagnostics',
      'listAdminRequestEvents',
      'AdminRequestEventListRequest'
    ),
    '/admin/request-events/purge': postOperation(
      'Purge request diagnostics outside the retention window',
      'purgeAdminRequestEvents',
      'RequestEnvelope'
    )
  };
  document.components.responses = {
    ...(document.components.responses ?? {}),
    GatewayFailure: envelopeResponse('Gateway failure')
  };
}

function objectRequest(required: string[], properties: Record<string, JsonSchema>): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['requestId', ...required.filter((name) => name !== 'requestId')],
    properties: {
      requestId: { $ref: '#/components/schemas/RequestId' },
      ...properties
    }
  };
}
