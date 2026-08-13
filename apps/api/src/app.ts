import { Hono } from 'hono';
import { cors } from 'hono/cors';

import {
  createRequestId,
  isOperationId,
  isRequestId,
  MockGatewayClient,
  normalizeApiPrefix
} from '@one-vegetable/core';
import { authorizeOperation, operationIsMutation, StaticOperationFeatureFlags } from './abac';
import { AuthError } from './auth/service';
import { authenticateMutation, authenticateRequest, registerAuthRoutes } from './auth/routes';

import type {
  ApiResponse,
  BackendMeta,
  GatewayClient,
  GatewayError,
  OperationId,
  ProbeResponse
} from '@one-vegetable/core';
import type { Context } from 'hono';
import type { OperationFeatureFlags } from './abac';
import type { AdminService } from './auth/admin-service';
import type { AuthenticatedSession, AuthService } from './auth/service';

export type ApiRuntime = 'node' | 'cloudflare';
export type ApiDatabase = 'sqlite' | 'd1';
export type GatewayMode = 'mock' | 'disabled' | 'real';

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
  request(operation: OperationId, request: unknown): Promise<unknown>;
}

export function createApiApp(options: ApiAppOptions): Hono {
  const apiPrefix = normalizeApiPrefix(options.apiPrefix);
  const gateway = options.gateway ?? new MockGatewayClient();
  const dynamicGateway = gateway as unknown as DynamicGateway;
  const app = new Hono();
  const api = new Hono();
  const featureFlags = options.featureFlags ?? new StaticOperationFeatureFlags();

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
      version: options.version ?? '2.0.0'
    };
    logRequest(options, parsed.requestId, 'meta/get', 'success', 200, startedAt);
    return success(context, parsed.requestId, data);
  });

  api.post('/operations/call', async (context) => {
    const startedAt = (options.clock ?? Date.now)();
    const parsed = await parseEnvelope(context, ['requestId', 'operation', 'payload']);
    if (!parsed.ok) return parsed.response;
    if (options.gatewayMode !== 'mock') {
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
      const data = await dynamicGateway.request(parsed.body.operation, parsed.body.payload);
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
      const status = error instanceof AuthError ? error.status : 500;
      const code = error instanceof AuthError ? error.code : 'OPERATION_FAILED';
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
        message: error instanceof Error ? error.message : '操作执行失败',
        retryable: false
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function success(context: Context, requestId: string, data: unknown): Response {
  return respond(context, requestId, 200, { requestId, ok: true, data } satisfies ApiResponse<unknown>);
}

function failure(
  context: Context,
  requestId: string,
  status: 400 | 401 | 403 | 404 | 409 | 415 | 500 | 503,
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
