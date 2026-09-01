import {
  isRequestId,
  normalizeRemark,
  validateSocialPostListInput,
  validateSocialPostPrepareInput,
  validateSocialPostTargetInput
} from '@one-vegetable/core';
import { authorizeAdmin } from '../abac';
import { authenticateMutation, authenticateRequest } from '../auth/routes';
import { AuthError } from '../auth/service';
import { ExtensionSocialDeviceError } from './extension-device-service';
import { MetaEntityVersionConflictError } from './repository';
import { SocialMediaAssetError } from './media-service';
import { SocialPublishingServiceError } from './publishing-service';
import { MetaSocialServiceError } from './service';

import type { GatewayError } from '@one-vegetable/core';
import type { Hono } from 'hono';
import type { Context } from 'hono';
import type { AuthService } from '../auth/service';
import type { ExtensionSocialDeviceService } from './extension-device-service';
import type { MetaSocialService } from './service';
import type { SocialMediaAssetService } from './media-service';
import type { SocialPublishingService } from './publishing-service';

const REQUEST_IDS = new WeakMap<Request, string>();

export interface MetaSocialRouteOptions {
  authService: AuthService;
  service: MetaSocialService;
  mediaAssets?: SocialMediaAssetService;
  publishing?: SocialPublishingService;
  extensionDevices?: ExtensionSocialDeviceService;
  allowedOrigins?: readonly string[];
}

export function registerMetaSocialRoutes(api: Hono, options: MetaSocialRouteOptions): void {
  api.post('/admin/social/meta/config/get', (context) =>
    adminRead(context, options, async () => options.service.configuration(), ['requestId'])
  );

  api.post('/admin/social/meta/config/update', (context) =>
    adminWrite(
      context,
      options,
      async (body, actorId) => {
        const requestId = readRequestId(body);
        const current = await options.service.configuration();
        const result = await options.service.configure({
          appId: readString(body, 'appId'),
          appSecret: readSensitiveString(body, 'appSecret', 512),
          publicOrigin: readString(body, 'publicOrigin'),
          expectedRevision: readNullableRevision(body, 'revision'),
          actorId,
          remark: readRemark(body, 'remark')
        });
        await options.authService.audit({
          requestId,
          actorId,
          action: 'social.meta.config.update',
          resourceKind: 'meta-app-configuration',
          resourceId: 'primary',
          outcome: 'success',
          reasonCode: 'META_APP_CONFIGURED',
          revisionBefore: current.revision,
          revisionAfter: result.revision
        });
        return result;
      },
      ['requestId', 'appId', 'appSecret', 'publicOrigin', 'revision', 'remark']
    )
  );

  api.post('/admin/social/meta/config/clear', (context) =>
    adminWrite(
      context,
      options,
      async (body, actorId) => {
        const requestId = readRequestId(body);
        const revision = readRevision(body, 'revision');
        await options.service.clearConfiguration(revision);
        await options.authService.audit({
          requestId,
          actorId,
          action: 'social.meta.config.clear',
          resourceKind: 'meta-app-configuration',
          resourceId: 'primary',
          outcome: 'success',
          reasonCode: 'META_APP_CONFIGURATION_CLEARED',
          revisionBefore: revision,
          revisionAfter: null
        });
        return {};
      },
      ['requestId', 'revision']
    )
  );

  api.post('/admin/social/meta/oauth/start', (context) =>
    adminWrite(
      context,
      options,
      async (body, actorId) => {
        const result = await options.service.startOAuth({ actorId });
        await options.authService.audit({
          requestId: readRequestId(body),
          actorId,
          action: 'social.meta.oauth.start',
          resourceKind: 'meta-oauth-state',
          resourceId: null,
          outcome: 'success',
          reasonCode: 'META_OAUTH_STARTED'
        });
        return result;
      },
      ['requestId']
    )
  );

  api.get('/social/meta/oauth/callback', async (context) => {
    const requestId = crypto.randomUUID();
    try {
      const oauthError = context.req.query('error');
      if (oauthError) {
        throw new MetaSocialServiceError('META_OAUTH_DENIED', 'Meta OAuth 授权被拒绝', 400);
      }
      const result = await options.service.completeOAuth({
        state: context.req.query('state') ?? '',
        code: context.req.query('code') ?? '',
        requestId
      });
      await options.authService.audit({
        requestId,
        actorId: result.actorId,
        action: 'social.meta.oauth.complete',
        resourceKind: 'meta-connection',
        resourceId: result.connection.id,
        outcome: 'success',
        reasonCode: 'META_OAUTH_COMPLETED',
        revisionBefore: null,
        revisionAfter: result.connection.revision
      });
      return callbackRedirect(context, requestId, 'connected');
    } catch (error: unknown) {
      const normalized = routeError(error);
      return callbackRedirect(context, requestId, 'failed', normalized.code);
    }
  });

  api.post('/admin/social/meta/connections/list', (context) =>
    adminRead(context, options, async () => ({ items: await options.service.listConnections() }), [
      'requestId'
    ])
  );

  api.post('/admin/social/meta/connections/disconnect', (context) =>
    adminWrite(
      context,
      options,
      async (body, actorId) => {
        const requestId = readRequestId(body);
        const connectionId = readUuid(body, 'connectionId');
        const revision = readRevision(body, 'revision');
        await options.service.disconnect({ connectionId, expectedRevision: revision, actorId });
        await options.authService.audit({
          requestId,
          actorId,
          action: 'social.meta.connection.disconnect',
          resourceKind: 'meta-connection',
          resourceId: connectionId,
          outcome: 'success',
          reasonCode: 'META_CONNECTION_DISCONNECTED',
          revisionBefore: revision,
          revisionAfter: revision + 1
        });
        return {};
      },
      ['requestId', 'connectionId', 'revision']
    )
  );

  if (options.extensionDevices) registerExtensionDeviceRoutes(api, options);

  api.post('/social/destinations/list', (context) =>
    socialRead(context, options, async () => ({ items: await options.service.listDestinations() }), [
      'requestId'
    ])
  );

  if (options.mediaAssets) {
    api.get('/social-media/:opaqueToken', async (context) => {
      const requestId = crypto.randomUUID();
      const object = await options.mediaAssets?.readByOpaqueToken(context.req.param('opaqueToken'));
      if (!object)
        return failure(context, requestId, 404, {
          code: 'SOCIAL_MEDIA_NOT_FOUND',
          message: '社交素材不存在或已过期',
          retryable: false
        });
      return new Response(Uint8Array.from(object.bytes).buffer, {
        status: 200,
        headers: {
          'Content-Type': object.contentType,
          'Content-Length': String(object.bytes.byteLength),
          'Cache-Control': 'private, max-age=60',
          'X-Content-Type-Options': 'nosniff',
          'X-Request-ID': requestId
        }
      });
    });
  }

  if (options.publishing) registerPublishingRoutes(api, options);
}

function registerExtensionDeviceRoutes(api: Hono, options: MetaSocialRouteOptions): void {
  const devices = options.extensionDevices;
  if (!devices) return;

  api.post('/extension-pairings/start', (context) =>
    extensionRequest(
      context,
      async (body) => {
        const extensionId = readString(body, 'extensionId');
        assertExtensionOrigin(context, extensionId);
        return devices.start({ extensionId, deviceName: readString(body, 'deviceName') });
      },
      ['requestId', 'extensionId', 'deviceName']
    )
  );

  api.post('/extension-pairings/status', (context) =>
    extensionRequest(
      context,
      async (body) => {
        const extensionId = readString(body, 'extensionId');
        assertExtensionOrigin(context, extensionId);
        return devices.status({
          pairingId: readUuid(body, 'pairingId'),
          pairingCode: readString(body, 'pairingCode'),
          extensionId
        });
      },
      ['requestId', 'pairingId', 'pairingCode', 'extensionId']
    )
  );

  api.post('/admin/extension-pairings/approve', (context) =>
    adminWrite(
      context,
      options,
      async (body, actorId) => {
        const result = await devices.approve(readString(body, 'pairingCode'), actorId);
        await options.authService.audit({
          requestId: readRequestId(body),
          actorId,
          action: 'social.extension-pairing.approve',
          resourceKind: 'extension-social-pairing',
          resourceId: result.pairingId,
          outcome: 'success',
          reasonCode: 'EXTENSION_PAIRING_APPROVED'
        });
        return result;
      },
      ['requestId', 'pairingCode']
    )
  );

  api.post('/admin/extension-devices/list', (context) =>
    adminRead(context, options, async () => ({ items: await devices.list() }), ['requestId'])
  );

  api.post('/admin/extension-devices/revoke', (context) =>
    adminWrite(
      context,
      options,
      async (body, actorId) => {
        const deviceId = readUuid(body, 'deviceId');
        const revision = readRevision(body, 'revision');
        await devices.revoke({ deviceId, revision, actorId });
        await options.authService.audit({
          requestId: readRequestId(body),
          actorId,
          action: 'social.extension-device.revoke',
          resourceKind: 'extension-social-device',
          resourceId: deviceId,
          outcome: 'success',
          reasonCode: 'EXTENSION_DEVICE_REVOKED',
          revisionBefore: revision,
          revisionAfter: revision + 1
        });
        return {};
      },
      ['requestId', 'deviceId', 'revision']
    )
  );
}

function registerPublishingRoutes(api: Hono, options: MetaSocialRouteOptions): void {
  const publishing = options.publishing;
  if (!publishing) return;

  api.post('/social-posts/prepare', (context) =>
    socialWrite(
      context,
      options,
      async (body, actorId) => {
        const validation = validateSocialPostPrepareInput(body);
        if (!validation.valid || !validation.data) {
          throw new AuthError('INVALID_REQUEST_BODY', validation.errors.join('；'), 400);
        }
        const result = await publishing.prepare(validation.data, actorId);
        await options.authService.audit({
          requestId: validation.data.requestId,
          actorId,
          action: 'social.post.prepare',
          resourceKind: 'social-publish-job',
          resourceId: result.id,
          outcome: 'success',
          reasonCode: 'SOCIAL_POST_PREPARED',
          revisionBefore: null,
          revisionAfter: result.revision
        });
        return result;
      },
      ['requestId', 'destinationId', 'caption', 'idempotencyKey', 'file']
    )
  );

  for (const [path, action, auditAction] of [
    ['/social-posts/publish', 'publish', 'social.post.publish'],
    ['/social-posts/advance', 'advance', 'social.post.advance']
  ] as const) {
    api.post(path, (context) =>
      socialWrite(
        context,
        options,
        async (body, actorId) => {
          const request = readSocialTarget(body);
          const result = await publishing[action]({ ...request, actorId });
          await options.authService.audit({
            requestId: request.requestId,
            actorId,
            action: auditAction,
            resourceKind: 'social-publish-job',
            resourceId: result.id,
            outcome: result.status === 'failed' || result.status === 'unknown' ? 'error' : 'success',
            reasonCode: result.reasonCode ?? `SOCIAL_POST_${result.status.toUpperCase()}`,
            revisionBefore: Math.max(1, result.revision - 1),
            revisionAfter: result.revision
          });
          return result;
        },
        ['requestId', 'jobId']
      )
    );
  }

  api.post('/social-posts/get', (context) =>
    socialRead(
      context,
      options,
      async (body, actorId) => {
        const request = readSocialTarget(body);
        return publishing.get(request.jobId, actorId);
      },
      ['requestId', 'jobId']
    )
  );

  api.post('/social-posts/list', (context) =>
    socialRead(
      context,
      options,
      async (body, actorId) => {
        const validation = validateSocialPostListInput(body);
        if (!validation.valid || !validation.data) {
          throw new AuthError('INVALID_REQUEST_BODY', validation.errors.join('；'), 400);
        }
        return { items: await publishing.list(actorId, validation.data.limit) };
      },
      ['requestId', 'limit']
    )
  );

  api.post('/social-posts/cancel', (context) =>
    socialWrite(
      context,
      options,
      async (body, actorId) => {
        const request = readSocialTarget(body);
        const result = await publishing.cancel(request.jobId, actorId);
        await options.authService.audit({
          requestId: request.requestId,
          actorId,
          action: 'social.post.cancel',
          resourceKind: 'social-publish-job',
          resourceId: result.id,
          outcome: 'success',
          reasonCode: 'SOCIAL_POST_CANCELLED',
          revisionBefore: Math.max(1, result.revision - 1),
          revisionAfter: result.revision
        });
        return result;
      },
      ['requestId', 'jobId']
    )
  );
}

function readSocialTarget(body: Record<string, unknown>): { requestId: string; jobId: string } {
  const validation = validateSocialPostTargetInput(body);
  if (!validation.valid || !validation.data) {
    throw new AuthError('INVALID_REQUEST_BODY', validation.errors.join('；'), 400);
  }
  return validation.data;
}

async function adminRead(
  context: Context,
  options: MetaSocialRouteOptions,
  action: (body: Record<string, unknown>, actorId: string) => Promise<unknown>,
  allowedKeys: readonly string[]
): Promise<Response> {
  return handle(context, async () => {
    const body = await readBody(context, allowedKeys);
    const authenticated = await authenticateRequest(context, options.authService);
    const decision = authorizeAdmin(authenticated.principal, 'admin.read');
    if (!decision.allowed) throw new AuthError(decision.reasonCode, '需要管理员权限', 403);
    return success(context, readRequestId(body), await action(body, authenticated.principal.actorId));
  });
}

async function adminWrite(
  context: Context,
  options: MetaSocialRouteOptions,
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
    return success(context, readRequestId(body), await action(body, authenticated.principal.actorId));
  });
}

async function socialRead(
  context: Context,
  options: MetaSocialRouteOptions,
  action: (body: Record<string, unknown>, actorId: string) => Promise<unknown>,
  allowedKeys: readonly string[]
): Promise<Response> {
  return handle(context, async () => {
    const body = await readBody(context, allowedKeys);
    const actorId = await authenticateSocialActor(context, options, false);
    return success(context, readRequestId(body), await action(body, actorId));
  });
}

async function socialWrite(
  context: Context,
  options: MetaSocialRouteOptions,
  action: (body: Record<string, unknown>, actorId: string) => Promise<unknown>,
  allowedKeys: readonly string[]
): Promise<Response> {
  return handle(context, async () => {
    const body = await readBody(context, allowedKeys);
    const actorId = await authenticateSocialActor(context, options, true);
    return success(context, readRequestId(body), await action(body, actorId));
  });
}

async function authenticateSocialActor(
  context: Context,
  options: MetaSocialRouteOptions,
  mutation: boolean
): Promise<string> {
  const authorization = context.req.header('authorization')?.trim();
  if (authorization) {
    const match = /^Bearer (ovd_[A-Za-z0-9_-]{43})$/u.exec(authorization);
    if (!match?.[1] || !options.extensionDevices) {
      throw new ExtensionSocialDeviceError('EXTENSION_DEVICE_UNAUTHORIZED', '扩展设备授权无效', 401);
    }
    const extensionId = context.req.header('x-one-vegetable-extension-id') ?? '';
    assertExtensionOrigin(context, extensionId);
    const authenticated = await options.extensionDevices.authenticate({
      deviceToken: match[1],
      extensionId
    });
    return authenticated.actorId;
  }
  const authenticated = mutation
    ? await authenticateMutation(context, {
        authService: options.authService,
        ...(options.allowedOrigins ? { allowedOrigins: options.allowedOrigins } : {})
      })
    : await authenticateRequest(context, options.authService);
  const decision = authorizeAdmin(authenticated.principal, mutation ? 'admin.write' : 'admin.read');
  if (!decision.allowed) throw new AuthError(decision.reasonCode, '需要管理员权限', 403);
  return authenticated.principal.actorId;
}

async function extensionRequest(
  context: Context,
  action: (body: Record<string, unknown>) => Promise<unknown>,
  allowedKeys: readonly string[]
): Promise<Response> {
  return handle(context, async () => {
    const body = await readBody(context, allowedKeys);
    return success(context, readRequestId(body), await action(body));
  });
}

function assertExtensionOrigin(context: Context, extensionId: string): void {
  if (
    !/^[a-p]{32}$/u.test(extensionId) ||
    context.req.header('origin') !== `chrome-extension://${extensionId}`
  ) {
    throw new ExtensionSocialDeviceError(
      'EXTENSION_ORIGIN_MISMATCH',
      '请求来源与 Chrome 扩展 ID 不匹配',
      403
    );
  }
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
  if (!isRecord(value) || Object.keys(value).some((key) => !allowedKeys.includes(key))) {
    throw new AuthError('INVALID_REQUEST_BODY', '请求 Body 无效或包含未定义字段', 400);
  }
  readRequestId(value);
  REQUEST_IDS.set(context.req.raw, value.requestId as string);
  return value;
}

function readRequestId(body: Record<string, unknown>): string {
  if (!isRequestId(body.requestId)) {
    throw new AuthError('INVALID_REQUEST_ID', 'requestId 必须是 UUID v4', 400);
  }
  return body.requestId;
}

function readString(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== 'string') throw new AuthError('INVALID_REQUEST_BODY', `${key} 无效`, 400);
  return value;
}

function readSensitiveString(body: Record<string, unknown>, key: string, maxLength: number): string {
  const value = readString(body, key).trim();
  if (!value || value.length > maxLength) {
    throw new AuthError('INVALID_REQUEST_BODY', `${key} 无效`, 400);
  }
  return value;
}

function readUuid(body: Record<string, unknown>, key: string): string {
  const value = readString(body, key);
  if (!isRequestId(value)) throw new AuthError('INVALID_REQUEST_BODY', `${key} 必须是 UUID v4`, 400);
  return value;
}

function readRevision(body: Record<string, unknown>, key: string): number {
  const value = body[key];
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new AuthError('INVALID_REQUEST_BODY', `${key} 无效`, 400);
  }
  return value as number;
}

function readNullableRevision(body: Record<string, unknown>, key: string): number | null {
  return body[key] === null ? null : readRevision(body, key);
}

function readRemark(body: Record<string, unknown>, key: string): string | null {
  const value = body[key];
  if (value !== null && typeof value !== 'string') {
    throw new AuthError('INVALID_REMARK', 'remark 无效', 400);
  }
  try {
    return normalizeRemark(value);
  } catch {
    throw new AuthError('INVALID_REMARK', 'remark 不能超过 500 个 Unicode 字符', 400);
  }
}

async function handle(context: Context, action: () => Promise<Response>): Promise<Response> {
  try {
    return await action();
  } catch (error: unknown) {
    const normalized = routeError(error);
    return failure(context, REQUEST_IDS.get(context.req.raw) ?? crypto.randomUUID(), normalized.status, {
      code: normalized.code,
      message: normalized.message,
      retryable: normalized.retryable
    });
  }
}

function routeError(error: unknown): {
  code: string;
  message: string;
  status: number;
  retryable: boolean;
} {
  if (error instanceof AuthError) {
    return { code: error.code, message: error.message, status: error.status, retryable: false };
  }
  if (error instanceof MetaSocialServiceError) {
    return {
      code: error.code,
      message: error.message,
      status: error.status,
      retryable: error.retryable
    };
  }
  if (error instanceof SocialMediaAssetError) {
    return { code: error.code, message: error.message, status: error.status, retryable: false };
  }
  if (error instanceof SocialPublishingServiceError) {
    return {
      code: error.code,
      message: error.message,
      status: error.status,
      retryable: error.retryable
    };
  }
  if (error instanceof ExtensionSocialDeviceError) {
    return { code: error.code, message: error.message, status: error.status, retryable: false };
  }
  if (error instanceof MetaEntityVersionConflictError) {
    return {
      code: 'ENTITY_VERSION_CONFLICT',
      message: error.message,
      status: 409,
      retryable: false
    };
  }
  return { code: 'META_SOCIAL_FAILED', message: 'Meta 社交功能暂时失败', status: 500, retryable: false };
}

function callbackRedirect(
  context: Context,
  requestId: string,
  status: 'connected' | 'failed',
  reasonCode?: string
): Response {
  if (context.req.header('accept')?.includes('application/json')) {
    return status === 'connected'
      ? success(context, requestId, { status })
      : failure(context, requestId, 400, {
          code: reasonCode ?? 'META_OAUTH_FAILED',
          message: 'Meta OAuth 授权失败',
          retryable: false
        });
  }
  const query = new URLSearchParams({ meta: status });
  if (reasonCode) query.set('reason', reasonCode.slice(0, 128));
  const response = context.redirect(`${new URL(context.req.url).origin}/#/admin?${query}`, 303);
  response.headers.set('X-Request-ID', requestId);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

function success(context: Context, requestId: string, data: unknown): Response {
  return respond(context, requestId, 200, { requestId, ok: true, data });
}

function failure(context: Context, requestId: string, status: number, error: GatewayError): Response {
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
