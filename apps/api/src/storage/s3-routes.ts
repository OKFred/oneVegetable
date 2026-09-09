import { isRequestId, GatewayException } from '@one-vegetable/core';
import {
  opaqueGalleryId,
  requireGalleryContext,
  assertGalleryContextId
} from '@one-vegetable/core/gallery-transfer-context';
import { parseS3StorageConfiguration } from '@one-vegetable/core/s3-storage';

import { authorizeAdmin } from '../abac';
import { authenticateMutation, authenticateRequest } from '../auth/routes';
import { AuthError } from '../auth/service';
import { EntityVersionConflictError } from '../db/repository';

import type { GatewayError } from '@one-vegetable/core';
import type { Context, Hono } from 'hono';
import type { AuthService } from '../auth/service';
import type { S3StorageConfigurationService } from './s3-configuration';

const REQUEST_IDS = new WeakMap<Request, string>();
const MAX_OBJECT_BYTES = 5 * 1024 * 1024;

export function registerS3StorageRoutes(
  api: Hono,
  options: {
    authService: AuthService;
    service: S3StorageConfigurationService;
    allowedOrigins?: readonly string[];
    galleryGatewayContextId?: () => Promise<string>;
  }
): void {
  api.post('/admin/storage/s3/get', (context) =>
    adminRead(context, options, async () => options.service.summary(), ['requestId'])
  );
  api.post('/admin/storage/s3/update', (context) =>
    adminWrite(
      context,
      options,
      async (body, actorId) => {
        const configuration = parseS3StorageConfiguration(body.configuration);
        const revision = readNullableRevision(body.revision);
        const before = await options.service.summary();
        const result = await options.service.save({
          configuration,
          actorId,
          expectedRevision: revision,
          remark: readNullableString(body.remark)
        });
        await options.authService.audit({
          requestId: readRequestId(body),
          actorId,
          action: 'storage.s3.update',
          resourceKind: 's3-storage-configuration',
          resourceId: 'primary',
          outcome: 'success',
          reasonCode: 'S3_STORAGE_CONFIGURED',
          revisionBefore: before.revision,
          revisionAfter: result.revision
        });
        return result;
      },
      ['requestId', 'configuration', 'revision', 'remark']
    )
  );
  api.post('/admin/storage/s3/clear', (context) =>
    adminWrite(
      context,
      options,
      async (body, actorId) => {
        const revision = readRevision(body.revision);
        await options.service.clear(revision);
        await options.authService.audit({
          requestId: readRequestId(body),
          actorId,
          action: 'storage.s3.clear',
          resourceKind: 's3-storage-configuration',
          resourceId: 'primary',
          outcome: 'success',
          reasonCode: 'S3_STORAGE_CLEARED',
          revisionBefore: revision,
          revisionAfter: null
        });
        return {};
      },
      ['requestId', 'revision']
    )
  );
  api.post('/admin/storage/s3/test', (context) =>
    adminRead(
      context,
      options,
      async () => {
        const client = await options.service.createClient();
        const page = await client.listObjects({ maximum: 1 });
        return { connected: true, visibleObjectCount: page.items.length };
      },
      ['requestId']
    )
  );
  api.post('/admin/storage/s3/objects/list', (context) =>
    adminRead(
      context,
      options,
      async (body) => {
        const client = await options.service.createClient(
          undefined,
          body.galleryContext === undefined ? undefined : requireGalleryContext(body.galleryContext).storage
        );
        const prefix = readOptionalString(body.prefix);
        const continuationToken = readOptionalString(body.continuationToken);
        const maximum = readOptionalPositiveInteger(body.maximum, 1000);
        return client.listObjects({
          ...(prefix ? { prefix } : {}),
          ...(continuationToken ? { continuationToken } : {}),
          ...(maximum ? { maximum } : {}),
          requestId: readRequestId(body)
        });
      },
      ['requestId', 'prefix', 'continuationToken', 'maximum']
    )
  );
  api.post('/admin/storage/s3/objects/get', (context) =>
    adminRead(
      context,
      options,
      async (body) => {
        const client = await options.service.createClient(
          undefined,
          body.galleryContext === undefined ? undefined : requireGalleryContext(body.galleryContext).storage
        );
        const object = await client.getObject(readRequiredString(body.key, 1024), readRequestId(body));
        if (object.bytes.byteLength > MAX_OBJECT_BYTES)
          throw new AuthError('S3_OBJECT_TOO_LARGE', 'S3 对象过大', 400);
        return {
          key: object.key,
          contentBase64: encodeBase64(object.bytes),
          contentType: object.contentType,
          byteLength: object.bytes.byteLength,
          etag: object.etag
        };
      },
      ['requestId', 'key']
    )
  );
  api.post('/admin/storage/s3/objects/put', (context) =>
    adminWrite(
      context,
      options,
      async (body, actorId) => {
        const bytes = decodeBase64(readRequiredString(body.contentBase64, 8 * 1024 * 1024));
        if (bytes.byteLength > MAX_OBJECT_BYTES)
          throw new AuthError('S3_OBJECT_TOO_LARGE', 'S3 对象过大', 400);
        const key = readRequiredString(body.key, 1024);
        const client = await options.service.createClient(
          undefined,
          body.galleryContext === undefined ? undefined : requireGalleryContext(body.galleryContext).storage
        );
        const result = await client.putObject({
          key,
          bytes,
          contentType: readRequiredString(body.contentType, 128),
          requestId: readRequestId(body)
        });
        await options.authService.audit({
          requestId: readRequestId(body),
          actorId,
          action: 'storage.s3.object.put',
          resourceKind: 's3-object',
          resourceId: key,
          outcome: 'success',
          reasonCode: 'S3_OBJECT_STORED'
        });
        return { key, etag: result.etag };
      },
      ['requestId', 'key', 'contentBase64', 'contentType']
    )
  );
}

async function adminRead(
  context: Context,
  options: { authService: AuthService; galleryGatewayContextId?: () => Promise<string> },
  action: (body: Record<string, unknown>, actorId: string) => Promise<unknown>,
  allowedKeys: readonly string[]
): Promise<Response> {
  return handle(context, async () => {
    const body = await readBody(context, allowedKeys);
    const authenticated = await authenticateRequest(context, options.authService);
    const decision = authorizeAdmin(authenticated.principal, 'admin.read');
    if (!decision.allowed) throw new AuthError(decision.reasonCode, '需要管理员权限', 403);
    await checkTransferIdentity(body, authenticated.principal.actorId, options.galleryGatewayContextId);
    return success(context, readRequestId(body), await action(body, authenticated.principal.actorId));
  });
}

async function adminWrite(
  context: Context,
  options: {
    authService: AuthService;
    allowedOrigins?: readonly string[];
    galleryGatewayContextId?: () => Promise<string>;
  },
  action: (body: Record<string, unknown>, actorId: string) => Promise<unknown>,
  allowedKeys: readonly string[]
): Promise<Response> {
  return handle(context, async () => {
    const body = await readBody(context, allowedKeys);
    const authenticated = await authenticateMutation(context, {
      authService: options.authService,
      ...(options.allowedOrigins ? { allowedOrigins: options.allowedOrigins } : {})
    });
    const decision = authorizeAdmin(authenticated.principal, 'admin.write');
    if (!decision.allowed) throw new AuthError(decision.reasonCode, '需要管理员权限', 403);
    await checkTransferIdentity(body, authenticated.principal.actorId, options.galleryGatewayContextId);
    return success(context, readRequestId(body), await action(body, authenticated.principal.actorId));
  });
}

async function readBody(context: Context, allowedKeys: readonly string[]): Promise<Record<string, unknown>> {
  if (!context.req.header('content-type')?.toLocaleLowerCase().startsWith('application/json')) {
    throw new AuthError('INVALID_CONTENT_TYPE', '请求必须使用 application/json', 400);
  }
  let value: unknown;
  try {
    value = await context.req.json<unknown>();
  } catch {
    throw new AuthError('INVALID_JSON', '请求 Body 不是有效 JSON', 400);
  }
  if (
    !isRecord(value) ||
    Object.keys(value).some((key) => key !== 'galleryContext' && !allowedKeys.includes(key))
  ) {
    throw new AuthError('INVALID_REQUEST_BODY', '请求 Body 无效或包含未定义字段', 400);
  }
  readRequestId(value);
  REQUEST_IDS.set(context.req.raw, value.requestId as string);
  return value;
}

async function checkTransferIdentity(
  body: Record<string, unknown>,
  actorId: string,
  gatewayId?: () => Promise<string>
): Promise<void> {
  if (body.galleryContext === undefined) return;
  const expected = requireGalleryContext(body.galleryContext);
  assertGalleryContextId(expected.identity, await opaqueGalleryId(actorId));
  if (!gatewayId) throw new AuthError('GALLERY_CONTEXT_UNAVAILABLE', 'GALLERY_CONTEXT_UNAVAILABLE', 503);
  assertGalleryContextId(expected.gateway, await gatewayId());
}

async function handle(context: Context, action: () => Promise<Response>): Promise<Response> {
  try {
    return await action();
  } catch (error: unknown) {
    const requestId = REQUEST_IDS.get(context.req.raw) ?? crypto.randomUUID();
    if (error instanceof AuthError)
      return failure(context, requestId, error.status, error.code, error.message);
    if (error instanceof EntityVersionConflictError) {
      return failure(context, requestId, 409, 'ENTITY_VERSION_CONFLICT', error.message);
    }
    if (error instanceof GatewayException) return failure(context, requestId, 409, error.gatewayError.code, error.gatewayError.message);
    return failure(
      context,
      requestId,
      500,
      error instanceof Error && 'code' in error && typeof error.code === 'string'
        ? error.code
        : 'S3_STORAGE_FAILED',
      error instanceof Error ? error.message : 'S3 存储操作失败'
    );
  }
}

function readRequestId(body: Record<string, unknown>): string {
  if (!isRequestId(body.requestId))
    throw new AuthError('INVALID_REQUEST_ID', 'requestId 必须是 UUID v4', 400);
  return body.requestId;
}

function readNullableRevision(value: unknown): number | null {
  return value === null ? null : readRevision(value);
}

function readRevision(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1)
    throw new AuthError('INVALID_REQUEST_BODY', 'revision 无效', 400);
  return value as number;
}

function readNullableString(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') throw new AuthError('INVALID_REQUEST_BODY', '字符串字段无效', 400);
  return value;
}

function readOptionalString(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return readRequiredString(value, 2048);
}

function readRequiredString(value: unknown, maximumLength: number): string {
  if (typeof value !== 'string' || !value || value.length > maximumLength) {
    throw new AuthError('INVALID_REQUEST_BODY', '字符串字段无效', 400);
  }
  return value;
}

function readOptionalPositiveInteger(value: unknown, maximum: number): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > maximum) {
    throw new AuthError('INVALID_REQUEST_BODY', '整数参数无效', 400);
  }
  return value as number;
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decodeBase64(value: string): Uint8Array {
  if (!/^[A-Za-z0-9+/]*={0,2}$/u.test(value) || value.length % 4 !== 0) {
    throw new AuthError('INVALID_REQUEST_BODY', 'contentBase64 无效', 400);
  }
  try {
    return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
  } catch {
    throw new AuthError('INVALID_REQUEST_BODY', 'contentBase64 无效', 400);
  }
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
