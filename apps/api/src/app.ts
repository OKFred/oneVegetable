import { Hono } from 'hono';
import { cors } from 'hono/cors';

import {
  APP_VERSION,
  createRequestId,
  GatewayException,
  isOperationId,
  isRequestId,
  normalizeApiPrefix,
  QUALIFICATION_GATED_OPERATION_IDS,
  validateOperationAvailabilityInput,
  validateProductDisplayInput,
  validateProductGroupCreateInput,
  validateProductSchemaUpdateInput
} from '@one-vegetable/core';
import { MockGatewayClient } from '@one-vegetable/core/mock';
import {
  authorizeOperation,
  extensionAdminPrincipal,
  operationIsMutation,
  StaticOperationFeatureFlags
} from './abac';
import { AuthError } from './auth/service';
import { authenticateMutation, authenticateRequest, registerAuthRoutes } from './auth/routes';
import { markRequestOperation, readRequestContext } from './observability/request-context';
import { registerProductDescriptionTemplateRoutes } from './product-description-templates/routes';
import { ProductDescriptionTemplateService } from './product-description-templates/service';
import { registerProductMutationRoutes } from './product-mutations/routes';
import {
  ProductDisplayNoChangeError,
  ProductDisplayTargetMismatchError,
  ProductMutationAlreadyInProgressError,
  ProductMutationLifecycleService
} from './product-mutations/service';

import type {
  ApiResponse,
  BackendMeta,
  GatewayClient,
  GatewayError,
  OperationId,
  ProbeResponse,
  ProductDisplayMutationResult,
  ProductDisplayRequest,
  ProductListQuery,
  ProductPage,
  ProductMutationResult,
  ProductSchema,
  ProductSchemaRenderRequest,
  ProductSchemaUpdateRequest
} from '@one-vegetable/core';
import type { Context } from 'hono';
import type { OperationFeatureFlags } from './abac';
import type { AdminService } from './auth/admin-service';
import type { AuthenticatedSession, AuthService } from './auth/service';
import type { RequestEventRepository } from './observability/request-events';
import type { AlibabaCredentialStatus } from './gateway/credentials';
import type { GatewayMode } from './runtime-config';
import type { ProductDescriptionTemplateRepository } from './product-description-templates/repository';
import type { ProductMutationJobRepository } from './product-mutations/repository';

export type ApiRuntime = 'node' | 'cloudflare';
export type ApiDatabase = 'sqlite' | 'd1';
export interface ApiAppOptions {
  runtime: ApiRuntime;
  database: ApiDatabase;
  environment: string;
  gatewayMode: GatewayMode;
  apiPrefix?: string | undefined;
  version?: string;
  gateway?: GatewayClient;
  ready?: () => Promise<boolean>;
  clock?: () => number;
  logger?: (context: RequestLogContext) => void;
  allowedOrigins?: readonly string[];
  authService?: AuthService;
  adminService?: AdminService;
  featureFlags?: OperationFeatureFlags;
  requestEvents?: RequestEventRepository;
  requestEventRetentionDays?: number;
  gatewayStatus?: AlibabaCredentialStatus;
  productDescriptionTemplates?: ProductDescriptionTemplateRepository;
  productMutationJobs?: ProductMutationJobRepository;
}

export interface RequestLogContext {
  requestId: string;
  environment: string;
  runtime: ApiRuntime;
  operation: string;
  actorId: string | null;
  outcome: 'success' | 'error' | 'denied';
  statusCode: number;
  durationMilliseconds: number;
}

interface RequestEnvelope {
  requestId: string;
}

interface OperationCallBody extends RequestEnvelope, Record<string, unknown> {
  operation: OperationId;
  payload: Record<string, unknown>;
}

interface DynamicGateway {
  request(operation: OperationId, request: unknown, context?: { requestId: string }): Promise<unknown>;
}

export function createApiApp(options: ApiAppOptions): Hono {
  const apiPrefix = normalizeApiPrefix(options.apiPrefix);
  if ((options.gatewayMode === 'real' || options.gatewayMode === 'replay') && !options.gateway) {
    throw new Error(`${options.gatewayMode} 网关模式必须显式提供 GatewayClient`);
  }
  const gateway = options.gateway ?? new MockGatewayClient();
  const dynamicGateway = gateway as unknown as DynamicGateway;
  const app = new Hono();
  const api = new Hono();
  const featureFlags = options.featureFlags ?? new StaticOperationFeatureFlags();
  const productMutations = options.productMutationJobs
    ? new ProductMutationLifecycleService(
        options.productMutationJobs,
        {
          async update(request: ProductSchemaUpdateRequest, requestId: string) {
            return (await dynamicGateway.request('updateProduct', request, {
              requestId
            })) as ProductMutationResult;
          },
          async render(request: ProductSchemaRenderRequest, requestId: string) {
            return (await dynamicGateway.request('renderProductSchema', request, {
              requestId
            })) as ProductSchema;
          },
          async updateDisplay(request: ProductDisplayRequest, requestId: string) {
            return (await dynamicGateway.request('updateProductDisplay', request, {
              requestId
            })) as ProductDisplayMutationResult;
          },
          async list(request: ProductListQuery, requestId: string) {
            return (await dynamicGateway.request('listProducts', request, { requestId })) as ProductPage;
          }
        },
        options.authService,
        options.clock
      )
    : undefined;

  api.use('*', async (context, next) => {
    const startedAt = (options.clock ?? Date.now)();
    await next();
    if (context.req.method !== 'OPTIONS') {
      await recordRequestEvent(options, context.req.raw, context.res, apiPrefix, startedAt);
    }
  });

  api.use(
    '*',
    cors({
      origin: [...(options.allowedOrigins ?? [])],
      allowMethods: ['GET', 'POST', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'X-CSRF-Token', 'X-Request-ID'],
      exposeHeaders: ['X-Request-ID'],
      credentials: true,
      maxAge: 600
    })
  );

  api.get('/healthz', (context) => {
    const requestId = createRequestId();
    return respond(context, requestId, 200, { requestId, status: 'ok' } satisfies ProbeResponse);
  });

  if (options.authService && options.adminService) {
    registerAuthRoutes(api, {
      authService: options.authService,
      adminService: options.adminService,
      apiPrefix,
      environment: options.environment,
      runtime: options.runtime,
      database: options.database,
      gatewayMode: options.gatewayMode,
      mutationEnabled: [
        'saveProductDraft',
        'updateProduct',
        'updateProductDisplay',
        'createProductGroup',
        'operatePhotoGroup',
        'uploadPhoto',
        'transferPhotoFromUrl'
      ].some((operation) => featureFlags.isEnabled(`operation:${operation}`)),
      ...(options.requestEvents ? { requestEvents: options.requestEvents } : {}),
      ...(options.gatewayStatus ? { gatewayStatus: options.gatewayStatus } : {}),
      ...(options.requestEventRetentionDays !== undefined
        ? { requestEventRetentionDays: options.requestEventRetentionDays }
        : {}),
      ...(options.clock ? { clock: options.clock } : {}),
      ...(options.allowedOrigins ? { allowedOrigins: options.allowedOrigins } : {})
    });
  }

  if (options.authService && options.productDescriptionTemplates) {
    registerProductDescriptionTemplateRoutes(api, {
      authService: options.authService,
      service: new ProductDescriptionTemplateService(
        options.productDescriptionTemplates,
        options.authService
      ),
      ...(options.allowedOrigins ? { allowedOrigins: options.allowedOrigins } : {})
    });
  }

  if (options.authService && productMutations) {
    registerProductMutationRoutes(api, {
      authService: options.authService,
      service: productMutations,
      ...(options.allowedOrigins ? { allowedOrigins: options.allowedOrigins } : {})
    });
  }

  api.get('/readyz', async (context) => {
    const requestId = createRequestId();
    const ready = await (options.ready?.() ?? Promise.resolve(true));
    if (!ready) {
      return failure(context, requestId, 503, {
        code: 'SERVICE_NOT_READY',
        message: '数据库或 migration 尚未就绪',
        retryable: true
      });
    }
    return respond(context, requestId, 200, { requestId, status: 'ok' } satisfies ProbeResponse);
  });

  api.post('/meta/get', async (context) => {
    const startedAt = (options.clock ?? Date.now)();
    const parsed = await parseEnvelope(context, ['requestId']);
    if (!parsed.ok) return parsed.response;
    const data: BackendMeta = {
      runtime: options.runtime,
      database: options.database,
      environment: options.environment,
      gatewayMode: options.gatewayMode,
      apiPrefix,
      version: options.version ?? APP_VERSION
    };
    logRequest(options, parsed.requestId, 'meta/get', 'success', 200, startedAt);
    return success(context, parsed.requestId, data);
  });

  api.post('/operations/availability/get', async (context) => {
    const startedAt = (options.clock ?? Date.now)();
    const parsed = await parseEnvelope(context, ['requestId', 'operations']);
    if (!parsed.ok) return parsed.response;
    const validation = validateOperationAvailabilityInput(parsed.body);
    if (!validation.valid || !validation.data) {
      return failure(context, parsed.requestId, 400, {
        code: 'INVALID_OPERATION_AVAILABILITY_REQUEST',
        message: validation.errors.join('；') || 'operations 无效',
        retryable: false
      });
    }
    try {
      const principal = options.authService
        ? (await authenticateRequest(context, options.authService)).principal
        : extensionAdminPrincipal();
      const items = validation.data.operations.map((operation) => {
        if (!isOperationId(operation)) {
          return { operation, allowed: false, reasonCode: 'OPERATION_UNKNOWN' };
        }
        if (options.gatewayMode === 'disabled') {
          return { operation, allowed: false, reasonCode: 'ALIBABA_GATEWAY_DISABLED' };
        }
        if (options.gatewayMode !== 'mock' && QUALIFICATION_GATED_OPERATION_IDS.has(operation)) {
          return { operation, allowed: false, reasonCode: 'LOGISTICS_QUALIFICATION_REQUIRED' };
        }
        const decision = authorizeOperation(principal, operation, {}, featureFlags);
        return { operation, allowed: decision.allowed, reasonCode: decision.reasonCode };
      });
      logRequest(
        options,
        parsed.requestId,
        'operations/availability/get',
        'success',
        200,
        startedAt,
        principal.actorId
      );
      return success(context, parsed.requestId, { items });
    } catch (error: unknown) {
      const status = error instanceof AuthError ? error.status : 500;
      const code = error instanceof AuthError ? error.code : 'OPERATION_AVAILABILITY_FAILED';
      logRequest(options, parsed.requestId, 'operations/availability/get', 'denied', status, startedAt);
      return failure(context, parsed.requestId, status, {
        code,
        message: error instanceof Error ? error.message : '读取 operation 状态失败',
        retryable: false
      });
    }
  });

  api.post('/operations/call', async (context) => {
    const startedAt = (options.clock ?? Date.now)();
    const parsed = await parseEnvelope(context, ['requestId', 'operation', 'payload']);
    if (!parsed.ok) return parsed.response;
    if (options.gatewayMode === 'disabled') {
      logRequest(options, parsed.requestId, 'operations/call', 'denied', 503, startedAt);
      return failure(context, parsed.requestId, 503, {
        code: 'ALIBABA_GATEWAY_DISABLED',
        message: '当前环境未启用 Alibaba 网关',
        retryable: false
      });
    }
    if (!isOperationBody(parsed.body)) {
      logRequest(options, parsed.requestId, 'operations/call', 'error', 400, startedAt);
      return failure(context, parsed.requestId, 400, {
        code: 'INVALID_OPERATION_REQUEST',
        message: 'operation 或 payload 无效',
        retryable: false
      });
    }
    const payloadErrors = validateDedicatedProductMutation(parsed.body.operation, parsed.body.payload);
    if (payloadErrors.length > 0) {
      logRequest(options, parsed.requestId, parsed.body.operation, 'error', 400, startedAt);
      return failure(context, parsed.requestId, 400, {
        code: 'INVALID_OPERATION_PAYLOAD',
        message: payloadErrors.join('；'),
        retryable: false
      });
    }
    markRequestOperation(context.req.raw, parsed.body.operation);

    let authenticated: AuthenticatedSession | null = null;
    try {
      if (options.authService) {
        authenticated = operationIsMutation(parsed.body.operation, parsed.body.payload)
          ? await authenticateMutation(context, {
              authService: options.authService,
              ...(options.allowedOrigins ? { allowedOrigins: options.allowedOrigins } : {})
            })
          : await authenticateRequest(context, options.authService);
        const decision = authorizeOperation(
          authenticated.principal,
          parsed.body.operation,
          parsed.body.payload,
          featureFlags
        );
        if (!decision.allowed) {
          await auditOperation(
            options.authService,
            parsed.requestId,
            authenticated.principal.actorId,
            parsed.body.operation,
            'denied',
            decision.reasonCode
          );
          logRequest(
            options,
            parsed.requestId,
            parsed.body.operation,
            'denied',
            403,
            startedAt,
            authenticated.principal.actorId
          );
          return failure(context, parsed.requestId, 403, {
            code: decision.reasonCode,
            message: '当前身份或能力策略不允许该操作',
            retryable: false
          });
        }
      }
      const data = productMutations
        ? parsed.body.operation === 'updateProduct'
          ? await productMutations.submitUpdate({
              requestId: parsed.requestId,
              actor: authenticated?.principal ?? extensionAdminPrincipal(),
              request: parsed.body.payload as unknown as ProductSchemaUpdateRequest
            })
          : parsed.body.operation === 'updateProductDisplay'
            ? await productMutations.submitDisplay({
                requestId: parsed.requestId,
                actor: authenticated?.principal ?? extensionAdminPrincipal(),
                request: parsed.body.payload as unknown as ProductDisplayRequest
              })
            : await dynamicGateway.request(parsed.body.operation, parsed.body.payload, {
                requestId: parsed.requestId
              })
        : await dynamicGateway.request(parsed.body.operation, parsed.body.payload, {
            requestId: parsed.requestId
          });
      if (options.authService && authenticated) {
        await auditOperation(
          options.authService,
          parsed.requestId,
          authenticated.principal.actorId,
          parsed.body.operation,
          'success',
          'OPERATION_SUCCEEDED'
        );
      }
      logRequest(
        options,
        parsed.requestId,
        parsed.body.operation,
        'success',
        200,
        startedAt,
        authenticated?.principal.actorId ?? null
      );
      return success(context, parsed.requestId, data);
    } catch (error: unknown) {
      const gatewayError = error instanceof GatewayException ? error.gatewayError : null;
      const status =
        error instanceof AuthError
          ? error.status
          : error instanceof ProductMutationAlreadyInProgressError
            ? 409
            : error instanceof ProductDisplayNoChangeError ||
                error instanceof ProductDisplayTargetMismatchError
              ? 409
              : gatewayError
                ? gatewayStatus(gatewayError.code)
                : 500;
      const code =
        error instanceof AuthError
          ? error.code
          : error instanceof ProductMutationAlreadyInProgressError
            ? 'PRODUCT_MUTATION_IN_PROGRESS'
            : error instanceof ProductDisplayNoChangeError
              ? 'PRODUCT_DISPLAY_NO_CHANGE'
              : error instanceof ProductDisplayTargetMismatchError
                ? 'PRODUCT_DISPLAY_TARGET_MISMATCH'
                : (gatewayError?.code ?? 'OPERATION_FAILED');
      if (options.authService) {
        await auditOperation(
          options.authService,
          parsed.requestId,
          authenticated?.principal.actorId ?? null,
          parsed.body.operation,
          error instanceof AuthError && (status === 401 || status === 403) ? 'denied' : 'error',
          code
        );
      }
      logRequest(
        options,
        parsed.requestId,
        parsed.body.operation,
        error instanceof AuthError && (status === 401 || status === 403) ? 'denied' : 'error',
        status,
        startedAt,
        authenticated?.principal.actorId ?? null
      );
      return failure(context, parsed.requestId, status, {
        code,
        message: gatewayError?.message ?? (error instanceof Error ? error.message : '操作执行失败'),
        retryable: gatewayError?.retryable ?? false,
        ...(gatewayError?.subCode ? { subCode: gatewayError.subCode } : {}),
        ...(gatewayError?.traceId ? { traceId: gatewayError.traceId } : {})
      });
    }
  });

  app.route(apiPrefix, api);
  app.notFound((context) => {
    const requestId = createRequestId();
    return failure(context, requestId, 404, {
      code: 'ROUTE_NOT_FOUND',
      message: '接口不存在',
      retryable: false
    });
  });
  app.onError((error, context) => {
    const requestId = createRequestId();
    return failure(context, requestId, 500, {
      code: 'INTERNAL_ERROR',
      message: error.message,
      retryable: false
    });
  });
  return app;
}

function gatewayStatus(code: string): 400 | 403 | 429 | 502 | 504 {
  if (code === 'REQUEST_CONTRACT_INVALID' || code === 'INVALID_OPERATION_REQUEST') return 400;
  if (
    code === 'CAPABILITY_UNKNOWN' ||
    code === 'CAPABILITY_NOT_ACTIVE' ||
    code === 'CAPABILITY_RESTRICTED' ||
    code === 'REAL_MUTATION_DISABLED'
  ) {
    return 403;
  }
  if (code === 'RATE_LIMITED') return 429;
  if (code === 'REQUEST_TIMEOUT') return 504;
  return 502;
}

async function parseEnvelope(
  context: Context,
  allowedKeys: readonly string[]
): Promise<
  { ok: true; requestId: string; body: Record<string, unknown> } | { ok: false; response: Response }
> {
  if (!context.req.header('content-type')?.toLocaleLowerCase().startsWith('application/json')) {
    const requestId = createRequestId();
    return {
      ok: false,
      response: failure(context, requestId, 415, {
        code: 'INVALID_CONTENT_TYPE',
        message: '请求必须使用 application/json',
        retryable: false
      })
    };
  }

  let body: unknown;
  try {
    body = await context.req.json<unknown>();
  } catch {
    const requestId = createRequestId();
    return {
      ok: false,
      response: failure(context, requestId, 400, {
        code: 'INVALID_JSON',
        message: '请求 Body 不是有效 JSON',
        retryable: false
      })
    };
  }
  if (!isRecord(body) || !isRequestId(body.requestId)) {
    const requestId = createRequestId();
    return {
      ok: false,
      response: failure(context, requestId, 400, {
        code: 'INVALID_REQUEST_ID',
        message: 'requestId 必须是 UUID v4',
        retryable: false
      })
    };
  }
  if (Object.keys(body).some((key) => !allowedKeys.includes(key))) {
    return {
      ok: false,
      response: failure(context, body.requestId, 400, {
        code: 'INVALID_REQUEST_BODY',
        message: '请求 Body 包含未定义字段',
        retryable: false
      })
    };
  }
  return { ok: true, requestId: body.requestId, body };
}

function isOperationBody(body: Record<string, unknown>): body is OperationCallBody {
  return isOperationId(body.operation) && isRecord(body.payload);
}

function validateDedicatedProductMutation(
  operation: OperationId,
  payload: Record<string, unknown>
): string[] {
  switch (operation) {
    case 'updateProduct':
      return validateProductSchemaUpdateInput(payload).errors;
    case 'updateProductDisplay':
      return validateProductDisplayInput(payload).errors;
    case 'createProductGroup':
      return validateProductGroupCreateInput(payload).errors;
    default:
      return [];
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function success(context: Context, requestId: string, data: unknown): Response {
  return respond(context, requestId, 200, { requestId, ok: true, data } satisfies ApiResponse<unknown>);
}

function failure(
  context: Context,
  requestId: string,
  status: 400 | 401 | 403 | 404 | 409 | 415 | 429 | 500 | 502 | 503 | 504,
  error: GatewayError
): Response {
  return respond(context, requestId, status, {
    requestId,
    ok: false,
    error
  } satisfies ApiResponse<never>);
}

function respond(context: Context, requestId: string, status: number, body: object): Response {
  context.header('X-Request-ID', requestId);
  context.header('Cache-Control', 'no-store');
  return context.json(body, status as 200);
}

function logRequest(
  options: ApiAppOptions,
  requestId: string,
  operation: string,
  outcome: RequestLogContext['outcome'],
  statusCode: number,
  startedAt: number,
  actorId: string | null = null
): void {
  options.logger?.({
    requestId,
    environment: options.environment,
    runtime: options.runtime,
    operation,
    actorId,
    outcome,
    statusCode,
    durationMilliseconds: Math.max(0, (options.clock ?? Date.now)() - startedAt)
  });
}

function auditOperation(
  authService: AuthService,
  requestId: string,
  actorId: string | null,
  operation: OperationId,
  outcome: 'success' | 'error' | 'denied',
  reasonCode: string
): Promise<unknown> {
  return authService.audit({
    requestId,
    actorId,
    action: 'operation.call',
    resourceKind: 'operation',
    resourceId: operation,
    outcome,
    reasonCode
  });
}

async function recordRequestEvent(
  options: ApiAppOptions,
  request: Request,
  response: Response,
  apiPrefix: string,
  startedAt: number
): Promise<void> {
  if (!options.requestEvents) return;
  const statusCode = response.status;
  const requestId = response.headers.get('X-Request-ID') ?? createRequestId();
  const requestContext = readRequestContext(request);
  const route = new URL(request.url).pathname;
  const operation = requestContext.operation ?? route.slice(apiPrefix.length).replace(/^\//, '');
  const outcome: RequestLogContext['outcome'] =
    statusCode >= 200 && statusCode < 300
      ? 'success'
      : statusCode === 401 || statusCode === 403
        ? 'denied'
        : 'error';
  try {
    await options.requestEvents.append({
      id: crypto.randomUUID(),
      eventTimeUtc: (options.clock ?? Date.now)(),
      requestId,
      environment: options.environment,
      runtime: options.runtime,
      route,
      operation,
      actorId: requestContext.actorId ?? null,
      outcome,
      statusCode,
      durationMilliseconds: Math.max(0, (options.clock ?? Date.now)() - startedAt)
    });
  } catch {
    // Diagnostics persistence must not turn an otherwise valid request into an outage.
  }
}
