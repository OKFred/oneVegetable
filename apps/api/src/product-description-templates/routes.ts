import {
  createRequestId,
  isRequestId,
  validateProductDescriptionTemplateCreateInput,
  validateProductDescriptionTemplateListInput,
  validateProductDescriptionTemplateStatusInput,
  validateProductDescriptionTemplateUpdateInput
} from '@one-vegetable/core';

import { authenticateMutation, authenticateRequest } from '../auth/routes';
import { AuthError } from '../auth/service';
import { EntityVersionConflictError } from '../db/repository';
import {
  ProductDescriptionTemplateNameConflictError,
  ProductDescriptionTemplateNotFoundError
} from './repository';

import type { GatewayError } from '@one-vegetable/core';
import type { Context, Hono } from 'hono';
import type { AuthService } from '../auth/service';
import type { ProductDescriptionTemplateService } from './service';

export interface ProductDescriptionTemplateRoutesOptions {
  authService: AuthService;
  service: ProductDescriptionTemplateService;
  allowedOrigins?: readonly string[];
}

export function registerProductDescriptionTemplateRoutes(
  api: Hono,
  options: ProductDescriptionTemplateRoutesOptions
): void {
  api.post('/product-description-templates/list', async (context) => {
    return handle(context, async (body) => {
      await authenticateRequest(context, options.authService);
      const input = valid(validateProductDescriptionTemplateListInput(body));
      const page = input.page ?? 1;
      const pageSize = input.pageSize ?? 20;
      const result = await options.service.list({
        page,
        pageSize,
        ...(input.language ? { language: input.language } : {}),
        ...(input.category ? { category: input.category } : {}),
        ...(input.status ? { status: input.status } : {})
      });
      return success(context, input.requestId, { ...result, page, pageSize });
    });
  });

  api.post('/product-description-templates/create', async (context) => {
    return handle(context, async (body) => {
      const input = valid(validateProductDescriptionTemplateCreateInput(body));
      const authenticated = await authenticateMutation(context, options);
      const entity = await options.service.create({
        requestId: input.requestId,
        actor: authenticated.principal,
        name: input.name,
        category: input.category,
        language: input.language,
        html: input.html,
        ...(input.remark !== undefined ? { remark: input.remark } : {})
      });
      return success(context, input.requestId, entity);
    });
  });

  api.post('/product-description-templates/update', async (context) => {
    return handle(context, async (body) => {
      const input = valid(validateProductDescriptionTemplateUpdateInput(body));
      const authenticated = await authenticateMutation(context, options);
      const entity = await options.service.update({
        requestId: input.requestId,
        actor: authenticated.principal,
        id: input.id,
        name: input.name,
        category: input.category,
        language: input.language,
        html: input.html,
        expectedRevision: input.revision,
        remark: input.remark
      });
      return success(context, input.requestId, entity);
    });
  });

  for (const action of ['archive', 'restore'] as const) {
    api.post(`/product-description-templates/${action}`, async (context) => {
      return handle(context, async (body) => {
        const input = valid(validateProductDescriptionTemplateStatusInput(body));
        const authenticated = await authenticateMutation(context, options);
        const entity = await options.service[action]({
          requestId: input.requestId,
          actor: authenticated.principal,
          id: input.id,
          expectedRevision: input.revision
        });
        return success(context, input.requestId, entity);
      });
    });
  }
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
    if (error instanceof AuthError)
      return failure(context, requestId, error.status, error.code, error.message);
    if (error instanceof EntityVersionConflictError) {
      return failure(context, requestId, 409, 'ENTITY_VERSION_CONFLICT', error.message);
    }
    if (error instanceof ProductDescriptionTemplateNameConflictError) {
      return failure(context, requestId, 409, 'TEMPLATE_NAME_CONFLICT', error.message);
    }
    if (error instanceof ProductDescriptionTemplateNotFoundError) {
      return failure(context, requestId, 404, 'TEMPLATE_NOT_FOUND', error.message);
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
