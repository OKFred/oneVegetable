import {
  createRequestId,
  isRequestId,
  validateProductMutationJobGetInput,
  validateProductMutationJobListInput,
  validateProductMutationJobRefreshInput
} from '@one-vegetable/core';

import { authenticateRequest } from '../auth/routes';
import { AuthError } from '../auth/service';
import { EntityVersionConflictError } from '../db/repository';
import { ProductMutationJobAccessError, ProductMutationRevisionConflictError } from './service';

import type { GatewayError } from '@one-vegetable/core';
import type { Context, Hono } from 'hono';
import type { AuthService } from '../auth/service';
import type { ProductMutationLifecycleService } from './service';

export interface ProductMutationRoutesOptions {
  authService: AuthService;
  service: ProductMutationLifecycleService;
}

export function registerProductMutationRoutes(api: Hono, options: ProductMutationRoutesOptions): void {
  api.post('/product-mutation-jobs/list', async (context) =>
    handle(context, async (body) => {
      const input = valid(validateProductMutationJobListInput(body));
      const authenticated = await authenticateRequest(context, options.authService);
      const result = await options.service.list(
        {
          page: input.page ?? 1,
          pageSize: input.pageSize ?? 20,
          ...(input.productId ? { productId: input.productId } : {}),
          ...(input.status ? { status: input.status } : {})
        },
        authenticated.principal
      );
      return success(context, input.requestId, result);
    })
  );

  api.post('/product-mutation-jobs/get', async (context) =>
    handle(context, async (body) => {
      const input = valid(validateProductMutationJobGetInput(body));
      const authenticated = await authenticateRequest(context, options.authService);
      const result = await options.service.get(input.id, authenticated.principal);
      return success(context, input.requestId, result);
    })
  );

  api.post('/product-mutation-jobs/refresh', async (context) =>
    handle(context, async (body) => {
      const input = valid(validateProductMutationJobRefreshInput(body));
      const authenticated = await authenticateRequest(context, options.authService);
      const result = await options.service.refresh({
        requestId: input.requestId,
        actor: authenticated.principal,
        id: input.id,
        expectedRevision: input.revision
      });
      return success(context, input.requestId, result);
    })
  );
}

async function handle(context: Context, action: (body: unknown) => Promise<Response>): Promise<Response> {
  let body: unknown;
  try {
    if (!context.req.header('content-type')?.toLocaleLowerCase().startsWith('application/json')) {
      throw new AuthError('INVALID_CONTENT_TYPE', '请求必须使用 application/json', 400);
    }
    body = await context.req.json<unknown>();
    return await action(body);
  } catch (error: unknown) {
    const requestId = readErrorRequestId(body);
    if (error instanceof AuthError) {
      return failure(context, requestId, error.status, error.code, error.message);
    }
    if (
      error instanceof EntityVersionConflictError ||
      error instanceof ProductMutationRevisionConflictError
    ) {
      return failure(context, requestId, 409, 'ENTITY_VERSION_CONFLICT', error.message);
    }
    if (error instanceof ProductMutationJobAccessError) {
      return failure(context, requestId, 404, 'PRODUCT_MUTATION_JOB_NOT_FOUND', error.message);
    }
    return failure(
      context,
      requestId,
      500,
      'INTERNAL_ERROR',
      error instanceof Error ? error.message : '内部错误'
    );
  }
}

function valid<T>(result: { valid: boolean; data?: T; errors: string[] }): T {
  if (!result.valid || !result.data) {
    throw new AuthError('INVALID_REQUEST_BODY', result.errors.join('；') || '请求 Body 无效', 400);
  }
  return result.data;
}

function readErrorRequestId(body: unknown): string {
  if (typeof body === 'object' && body !== null && 'requestId' in body && isRequestId(body.requestId)) {
    return body.requestId;
  }
  return createRequestId();
}

function success(context: Context, requestId: string, data: unknown): Response {
  return respond(context, requestId, 200, { requestId, ok: true, data });
}

function failure(
  context: Context,
  requestId: string,
  status: number,
  code: string,
  message: string
): Response {
  const error: GatewayError = { code, message, retryable: false };
  return respond(context, requestId, status, { requestId, ok: false, error });
}

function respond(context: Context, requestId: string, status: number, body: object): Response {
  context.header('X-Request-ID', requestId);
  context.header('Cache-Control', 'no-store');
  return context.json(body, status as 200);
}
