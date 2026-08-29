import { getCookie, setCookie } from 'hono/cookie';

import { isRequestId, normalizeRemark } from '@one-vegetable/core';
import { authorizeAdmin, policySummary } from '../abac';
import { AuthError } from './service';
import { markRequestActor } from '../observability/request-context';
import { requestEventRetentionCutoff } from '../observability/request-events';
import { CURRENT_SCHEMA_VERSION } from '../db/schema';
import { EntityVersionConflictError } from '../db/repository';

import type { Context, Hono } from 'hono';
import type { GatewayError } from '@one-vegetable/core';
import type { AdminService } from './admin-service';
import type { AuthenticatedSession, AuthService } from './service';
import type { PasskeyService } from './passkey-service';
import type { PublicUser, UserRole, UserStatus } from './types';
import type { RequestEventRepository } from '../observability/request-events';
import type { AlibabaCredentialStatus } from '../gateway/credentials';
import type { GatewayMode } from '../runtime-config';
import type { GatewayCredentialService, StoredAlibabaCredentialProvider } from '../gateway/credential-vault';
import { toPublicUser } from './types';

export const SESSION_COOKIE = 'ov_session';
export const CSRF_COOKIE = 'ov_csrf';
const REQUEST_IDS = new WeakMap<Request, string>();

export interface AuthRoutesOptions {
  authService: AuthService;
  authenticationMode?: 'password' | 'passkey';
  passkeyService?: PasskeyService;
  adminService: AdminService;
  apiPrefix: string;
  environment: string;
  runtime: 'node' | 'cloudflare';
  database: 'sqlite' | 'd1';
  gatewayMode: GatewayMode;
  gatewayStatus?: AlibabaCredentialStatus;
  gatewayCredentialService?: GatewayCredentialService;
  gatewayCredentialProvider?: StoredAlibabaCredentialProvider;
  mutationEnabled?: boolean;
  allowedOrigins?: readonly string[];
  requestEvents?: RequestEventRepository;
  requestEventRetentionDays?: number;
  clock?: () => number;
}

export function registerAuthRoutes(api: Hono, options: AuthRoutesOptions): void {
  api.post('/auth/bootstrap/status/get', async (context) => {
    return handle(context, async () => {
      const body = await readBody(context, ['requestId']);
      const requestId = readRequestId(body);
      return success(context, requestId, await options.authService.bootstrapStatus());
    });
  });

  if (options.passkeyService) registerPasskeyRoutes(api, options, options.passkeyService);

  api.post('/auth/bootstrap', async (context) => {
    return handle(context, async () => {
      const body = await readBody(context, ['requestId', 'bootstrapToken', 'username', 'password', 'remark']);
      const remark = readOptionalRemark(body, 'remark');
      const result = await options.authService.bootstrap({
        requestId: readRequestId(body),
        bootstrapToken: readString(body, 'bootstrapToken'),
        username: readString(body, 'username'),
        password: readPassword(body, 'password'),
        ...(remark !== undefined ? { remark } : {})
      });
      setSessionCookies(context, options, result.sessionToken, result.session.csrfToken);
      return success(context, body.requestId as string, {
        user: result.user,
        session: result.session
      });
    });
  });

  api.post('/auth/login', async (context) => {
    return handle(context, async () => {
      const body = await readBody(context, ['requestId', 'username', 'password']);
      const requestId = readRequestId(body);
      const result = await options.authService.login({
        requestId,
        username: readString(body, 'username'),
        password: readPassword(body, 'password')
      });
      setSessionCookies(context, options, result.sessionToken, result.session.csrfToken);
      return success(context, requestId, { user: result.user, session: result.session });
    });
  });

  api.post('/auth/session/get', async (context) => {
    return handle(context, async () => {
      const body = await readBody(context, ['requestId']);
      const requestId = readRequestId(body);
      const authenticated = await authenticateRequest(context, options.authService);
      const csrfToken = getCookie(context, CSRF_COOKIE);
      if (csrfToken) {
        try {
          await options.authService.assertCsrf(authenticated.session, csrfToken);
          setCsrfCookie(context, options, csrfToken);
        } catch {
          // A stale CSRF cookie must not invalidate an otherwise valid read-only session.
        }
      }
      return success(context, requestId, {
        principal: authenticated.principal,
        user: publicUser(authenticated),
        absoluteExpiresTimeUtc: authenticated.session.absoluteExpiresTimeUtc,
        idleExpiresTimeUtc: authenticated.session.idleExpiresTimeUtc
      });
    });
  });

  api.post('/auth/logout', async (context) => {
    return handle(context, async () => {
      const body = await readBody(context, ['requestId']);
      const requestId = readRequestId(body);
      const authenticated = await authenticateMutation(context, options, options.authService);
      await options.authService.logout(requestId, authenticated);
      clearSessionCookies(context, options);
      return success(context, requestId, {});
    });
  });

  api.post('/auth/password/change', async (context) => {
    return handle(context, async () => {
      const body = await readBody(context, ['requestId', 'currentPassword', 'newPassword']);
      const requestId = readRequestId(body);
      const authenticated = await authenticateMutation(context, options, options.authService);
      await options.authService.changePassword({
        requestId,
        authenticated,
        currentPassword: readPassword(body, 'currentPassword'),
        newPassword: readPassword(body, 'newPassword')
      });
      clearSessionCookies(context, options);
      return success(context, requestId, {});
    });
  });

  api.post('/admin/users/list', async (context) => {
    return adminRead(
      context,
      options,
      async (body) => {
        return options.adminService.listUsers(readPage(body), readPageSize(body));
      },
      ['requestId', 'page', 'pageSize']
    );
  });

  api.post('/admin/users/create', async (context) => {
    return adminWrite(
      context,
      options,
      async (body, authenticated) => {
        assertPasswordRoutesEnabled(options);
        const remark = readOptionalRemark(body, 'remark');
        return options.adminService.createUser({
          requestId: readRequestId(body),
          actor: authenticated.principal,
          username: readString(body, 'username'),
          password: readPassword(body, 'password'),
          role: readEnum(body, 'role', ['admin', 'user']),
          ...(remark !== undefined ? { remark } : {})
        });
      },
      ['requestId', 'username', 'password', 'role', 'remark']
    );
  });

  api.post('/admin/users/update', async (context) => {
    return adminWrite(
      context,
      options,
      async (body, authenticated) =>
        options.adminService.updateUser({
          requestId: readRequestId(body),
          actor: authenticated.principal,
          userId: readString(body, 'userId'),
          role: readEnum<UserRole>(body, 'role', ['admin', 'user']),
          status: readEnum<UserStatus>(body, 'status', ['active', 'disabled']),
          expectedRevision: readInteger(body, 'revision'),
          remark: readRemark(body, 'remark')
        }),
      ['requestId', 'userId', 'role', 'status', 'revision', 'remark']
    );
  });

  api.post('/admin/users/password/reset', async (context) => {
    return adminWrite(
      context,
      options,
      async (body, authenticated) => {
        assertPasswordRoutesEnabled(options);
        return options.adminService.resetPassword({
          requestId: readRequestId(body),
          actor: authenticated.principal,
          userId: readString(body, 'userId'),
          expectedRevision: readInteger(body, 'revision'),
          ...(body.newPassword === undefined ? {} : { newPassword: readPassword(body, 'newPassword') })
        });
      },
      ['requestId', 'userId', 'revision', 'newPassword']
    );
  });

  api.post('/admin/users/sessions/revoke', async (context) => {
    return adminWrite(
      context,
      options,
      async (body, authenticated) => {
        await options.adminService.revokeSessions(
          readRequestId(body),
          authenticated.principal,
          readString(body, 'userId')
        );
        return {};
      },
      ['requestId', 'userId']
    );
  });

  api.post('/admin/audit-events/list', async (context) => {
    return adminRead(
      context,
      options,
      (body) =>
        options.adminService.listAudit({
          page: readPage(body),
          pageSize: readPageSize(body),
          ...(typeof body.requestIdFilter === 'string' ? { requestId: body.requestIdFilter } : {}),
          ...(typeof body.actorId === 'string' ? { actorId: body.actorId } : {}),
          ...(typeof body.action === 'string' ? { action: body.action } : {}),
          ...(body.outcome === 'success' || body.outcome === 'error' || body.outcome === 'denied'
            ? { outcome: body.outcome }
            : {}),
          ...(typeof body.fromTimeUtc === 'number' ? { fromTimeUtc: body.fromTimeUtc } : {}),
          ...(typeof body.toTimeUtc === 'number' ? { toTimeUtc: body.toTimeUtc } : {})
        }),
      [
        'requestId',
        'requestIdFilter',
        'actorId',
        'action',
        'outcome',
        'fromTimeUtc',
        'toTimeUtc',
        'page',
        'pageSize'
      ]
    );
  });

  api.post('/admin/system/get', async (context) => {
    return adminRead(
      context,
      options,
      () =>
        Promise.resolve({
          runtime: options.runtime,
          environment: options.environment,
          apiPrefix: options.apiPrefix,
          database: options.database,
          gatewayMode: options.gatewayMode,
          gatewayStatus: {
            ...(options.gatewayStatus ?? {
              source: 'environment',
              configured: false,
              hasAppKey: false,
              hasAppSecret: false,
              hasAccessToken: false,
              endpointOrigin: '',
              signMethod: 'hmac'
            }),
            realReadEnabled: options.gatewayMode === 'real' && options.gatewayStatus?.configured === true,
            mutationEnabled: options.mutationEnabled === true
          },
          schemaVersion: CURRENT_SCHEMA_VERSION,
          requestEventRetentionDays: options.requestEventRetentionDays ?? 30
        }),
      ['requestId']
    );
  });

  api.post('/admin/policy-summary/get', async (context) => {
    return adminRead(context, options, () => Promise.resolve(policySummary()), ['requestId']);
  });

  const gatewayCredentialService = options.gatewayCredentialService;
  const gatewayCredentialProvider = options.gatewayCredentialProvider;
  if (gatewayCredentialService && gatewayCredentialProvider) {
    api.post('/admin/gateway-credentials/get', async (context) => {
      return adminRead(context, options, () => gatewayCredentialService.status(), ['requestId']);
    });

    api.post('/admin/gateway-credentials/import', async (context) => {
      return adminWrite(
        context,
        options,
        async (body, authenticated) => {
          const requestId = readRequestId(body);
          try {
            const result = await gatewayCredentialService.import({
              bundle: body.bundle,
              actorId: authenticated.principal.actorId,
              expectedRevision: readNullableRevision(body, 'revision'),
              remark: readOptionalRemark(body, 'remark') ?? null
            });
            await options.authService.audit({
              requestId,
              actorId: authenticated.principal.actorId,
              action: 'admin.gateway-credentials.import',
              resourceKind: 'gateway-credential',
              resourceId: 'primary',
              outcome: 'success',
              reasonCode: 'GATEWAY_CREDENTIAL_IMPORTED',
              revisionAfter: result.revision
            });
            return result;
          } catch (error: unknown) {
            throw credentialRouteError(error);
          }
        },
        ['requestId', 'bundle', 'revision', 'remark']
      );
    });

    api.post('/admin/gateway-credentials/refresh', async (context) => {
      return adminWrite(
        context,
        options,
        async (body, authenticated) => {
          const requestId = readRequestId(body);
          await gatewayCredentialProvider.requireCredentials(requestId, true);
          const result = await gatewayCredentialService.status();
          await options.authService.audit({
            requestId,
            actorId: authenticated.principal.actorId,
            action: 'admin.gateway-credentials.refresh',
            resourceKind: 'gateway-credential',
            resourceId: 'primary',
            outcome: 'success',
            reasonCode: 'GATEWAY_CREDENTIAL_REFRESHED',
            revisionAfter: result.revision
          });
          return result;
        },
        ['requestId']
      );
    });

    api.post('/admin/gateway-credentials/clear', async (context) => {
      return adminWrite(
        context,
        options,
        async (body, authenticated) => {
          const requestId = readRequestId(body);
          const revision = readInteger(body, 'revision');
          try {
            await gatewayCredentialService.clear(revision);
          } catch (error: unknown) {
            throw credentialRouteError(error);
          }
          await options.authService.audit({
            requestId,
            actorId: authenticated.principal.actorId,
            action: 'admin.gateway-credentials.clear',
            resourceKind: 'gateway-credential',
            resourceId: 'primary',
            outcome: 'success',
            reasonCode: 'GATEWAY_CREDENTIAL_CLEARED',
            revisionBefore: revision
          });
          return {};
        },
        ['requestId', 'revision']
      );
    });
  }

  api.post('/admin/request-events/list', async (context) => {
    return adminRead(
      context,
      options,
      (body) =>
        requiredRequestEvents(options).list({
          page: readPage(body),
          pageSize: readPageSize(body),
          ...(typeof body.requestIdFilter === 'string' ? { requestId: body.requestIdFilter } : {}),
          ...(typeof body.actorId === 'string' ? { actorId: body.actorId } : {}),
          ...(typeof body.route === 'string' ? { route: body.route } : {}),
          ...(typeof body.operation === 'string' ? { operation: body.operation } : {}),
          ...(body.outcome === 'success' || body.outcome === 'error' || body.outcome === 'denied'
            ? { outcome: body.outcome }
            : {}),
          ...(typeof body.fromTimeUtc === 'number' ? { fromTimeUtc: body.fromTimeUtc } : {}),
          ...(typeof body.toTimeUtc === 'number' ? { toTimeUtc: body.toTimeUtc } : {})
        }),
      [
        'requestId',
        'requestIdFilter',
        'actorId',
        'route',
        'operation',
        'outcome',
        'fromTimeUtc',
        'toTimeUtc',
        'page',
        'pageSize'
      ]
    );
  });

  api.post('/admin/request-events/purge', async (context) => {
    return adminWrite(
      context,
      options,
      async (body, authenticated) => {
        const retentionDays = options.requestEventRetentionDays ?? 30;
        const cutoffTimeUtc = requestEventRetentionCutoff((options.clock ?? Date.now)(), retentionDays);
        const deletedCount = await requiredRequestEvents(options).purgeBefore(cutoffTimeUtc);
        await options.authService.audit({
          requestId: readRequestId(body),
          actorId: authenticated.principal.actorId,
          action: 'admin.request-events.purge',
          resourceKind: 'request-events',
          resourceId: null,
          outcome: 'success',
          reasonCode: 'RETENTION_PURGE_COMPLETED'
        });
        return { deletedCount, retentionDays, cutoffTimeUtc };
      },
      ['requestId']
    );
  });
}

function registerPasskeyRoutes(api: Hono, options: AuthRoutesOptions, passkeys: PasskeyService): void {
  api.post('/auth/passkey/bootstrap/options', async (context) => {
    return handle(context, async () => {
      const body = await readBody(context, ['requestId', 'bootstrapToken', 'username']);
      const requestId = readRequestId(body);
      return success(
        context,
        requestId,
        await passkeys.bootstrapOptions({
          bootstrapToken: readString(body, 'bootstrapToken'),
          username: readString(body, 'username'),
          ceremony: passkeyCeremony(context)
        })
      );
    });
  });

  api.post('/auth/passkey/bootstrap/verify', async (context) => {
    return handle(context, async () => {
      const body = await readBody(context, ['requestId', 'challengeId', 'response', 'credentialName']);
      const requestId = readRequestId(body);
      const result = await passkeys.bootstrapVerify({
        requestId,
        challengeId: readString(body, 'challengeId'),
        response: body.response,
        ...(body.credentialName === undefined ? {} : { credentialName: readString(body, 'credentialName') })
      });
      setSessionCookies(context, options, result.sessionToken, result.session.csrfToken);
      return success(context, requestId, authenticationResult(result));
    });
  });

  api.post('/auth/passkey/login/options', async (context) => {
    return handle(context, async () => {
      const body = await readBody(context, ['requestId']);
      return success(context, readRequestId(body), await passkeys.loginOptions(passkeyCeremony(context)));
    });
  });

  api.post('/auth/passkey/login/verify', async (context) => {
    return handle(context, async () => {
      const body = await readBody(context, ['requestId', 'challengeId', 'response']);
      const requestId = readRequestId(body);
      const result = await passkeys.loginVerify({
        requestId,
        challengeId: readString(body, 'challengeId'),
        response: body.response
      });
      setSessionCookies(context, options, result.sessionToken, result.session.csrfToken);
      return success(context, requestId, authenticationResult(result));
    });
  });

  api.post('/auth/passkeys/list', async (context) => {
    return handle(context, async () => {
      const body = await readBody(context, ['requestId']);
      const authenticated = await authenticateRequest(context, options.authService);
      return success(
        context,
        readRequestId(body),
        await passkeys.listCredentials(authenticated.principal.actorId)
      );
    });
  });

  api.post('/auth/passkeys/register/options', async (context) => {
    return handle(context, async () => {
      const body = await readBody(context, ['requestId']);
      const authenticated = await authenticateMutation(context, options);
      return success(
        context,
        readRequestId(body),
        await passkeys.registerOptions(authenticated.user, passkeyCeremony(context))
      );
    });
  });

  api.post('/auth/passkeys/register/verify', async (context) => {
    return handle(context, async () => {
      const body = await readBody(context, ['requestId', 'challengeId', 'response', 'credentialName']);
      const authenticated = await authenticateMutation(context, options);
      return success(
        context,
        readRequestId(body),
        await passkeys.registerVerify({
          requestId: readRequestId(body),
          actor: authenticated.principal,
          challengeId: readString(body, 'challengeId'),
          response: body.response,
          ...(body.credentialName === undefined ? {} : { credentialName: readString(body, 'credentialName') })
        })
      );
    });
  });

  api.post('/auth/passkeys/remove', async (context) => {
    return handle(context, async () => {
      const body = await readBody(context, ['requestId', 'credentialId']);
      const authenticated = await authenticateMutation(context, options);
      await passkeys.removeCredential({
        requestId: readRequestId(body),
        actor: authenticated.principal,
        credentialId: readString(body, 'credentialId')
      });
      return success(context, readRequestId(body), {});
    });
  });

  api.post('/auth/recovery-codes/regenerate', async (context) => {
    return handle(context, async () => {
      const body = await readBody(context, ['requestId']);
      const authenticated = await authenticateMutation(context, options);
      return success(context, readRequestId(body), {
        recoveryCodes: await passkeys.regenerateRecoveryCodes({
          requestId: readRequestId(body),
          actor: authenticated.principal
        })
      });
    });
  });

  api.post('/auth/passkey/recovery/options', async (context) => {
    return handle(context, async () => {
      const body = await readBody(context, ['requestId', 'username', 'recoveryCode']);
      return success(
        context,
        readRequestId(body),
        await passkeys.recoveryOptions({
          username: readString(body, 'username'),
          recoveryCode: readString(body, 'recoveryCode'),
          ceremony: passkeyCeremony(context)
        })
      );
    });
  });

  api.post('/auth/passkey/recovery/verify', async (context) => {
    return handle(context, async () => {
      const body = await readBody(context, ['requestId', 'challengeId', 'response', 'credentialName']);
      const requestId = readRequestId(body);
      const result = await passkeys.recoveryVerify({
        requestId,
        challengeId: readString(body, 'challengeId'),
        response: body.response,
        ...(body.credentialName === undefined ? {} : { credentialName: readString(body, 'credentialName') })
      });
      setSessionCookies(context, options, result.sessionToken, result.session.csrfToken);
      return success(context, requestId, authenticationResult(result));
    });
  });

  api.post('/auth/passkey/enrollment/options', async (context) => {
    return handle(context, async () => {
      const body = await readBody(context, ['requestId', 'enrollmentToken']);
      return success(
        context,
        readRequestId(body),
        await passkeys.enrollmentOptions({
          enrollmentToken: readString(body, 'enrollmentToken'),
          ceremony: passkeyCeremony(context)
        })
      );
    });
  });

  api.post('/auth/passkey/enrollment/verify', async (context) => {
    return handle(context, async () => {
      const body = await readBody(context, ['requestId', 'challengeId', 'response', 'credentialName']);
      const requestId = readRequestId(body);
      const result = await passkeys.enrollmentVerify({
        requestId,
        challengeId: readString(body, 'challengeId'),
        response: body.response,
        ...(body.credentialName === undefined ? {} : { credentialName: readString(body, 'credentialName') })
      });
      setSessionCookies(context, options, result.sessionToken, result.session.csrfToken);
      return success(context, requestId, authenticationResult(result));
    });
  });

  api.post('/admin/users/enrollment/create', async (context) => {
    return adminWrite(
      context,
      options,
      async (body, authenticated) => {
        const remark = readOptionalRemark(body, 'remark');
        return passkeys.createEnrollment({
          requestId: readRequestId(body),
          actor: authenticated.principal,
          username: readString(body, 'username'),
          role: readEnum(body, 'role', ['admin', 'user']),
          ...(remark === undefined ? {} : { remark })
        });
      },
      ['requestId', 'username', 'role', 'remark']
    );
  });
}

function passkeyCeremony(context: Context): { origin: string; rpId: string } {
  const requestUrl = new URL(context.req.url);
  const origin = context.req.header('Origin');
  if (!origin || origin !== requestUrl.origin) {
    throw new AuthError('ORIGIN_INVALID', 'Passkey 请求 Origin 无效', 403);
  }
  return { origin, rpId: requestUrl.hostname };
}

function authenticationResult(result: {
  user: PublicUser;
  session: unknown;
  recoveryCodes?: string[];
}): Record<string, unknown> {
  return {
    user: result.user,
    session: result.session,
    ...(result.recoveryCodes ? { recoveryCodes: result.recoveryCodes } : {})
  };
}

function assertPasswordRoutesEnabled(options: AuthRoutesOptions): void {
  if (options.authenticationMode === 'passkey') {
    throw new AuthError('PASSWORD_LOGIN_DISABLED', '自托管环境请使用 Passkey', 403);
  }
}

export async function authenticateRequest(
  context: Context,
  authService: AuthService
): Promise<AuthenticatedSession> {
  const token = getCookie(context, SESSION_COOKIE);
  if (!token) throw new AuthError('SESSION_REQUIRED', '请先登录', 401);
  const authenticated = await authService.authenticate(token);
  markRequestActor(context.req.raw, authenticated.principal.actorId);
  return authenticated;
}

export async function authenticateMutation(
  context: Context,
  options: Pick<AuthRoutesOptions, 'authService' | 'allowedOrigins'>,
  authService = options.authService
): Promise<AuthenticatedSession> {
  assertOrigin(context, options.allowedOrigins ?? []);
  const authenticated = await authenticateRequest(context, authService);
  await authService.assertCsrf(authenticated.session, context.req.header('X-CSRF-Token'));
  return authenticated;
}

function assertOrigin(context: Context, allowedOrigins: readonly string[]): void {
  const origin = context.req.header('Origin');
  const requestOrigin = new URL(context.req.url).origin;
  if (!origin || (origin !== requestOrigin && !allowedOrigins.includes(origin))) {
    throw new AuthError('ORIGIN_INVALID', '请求 Origin 无效', 403);
  }
}

async function adminRead(
  context: Context,
  options: AuthRoutesOptions,
  action: (body: Record<string, unknown>, authenticated: AuthenticatedSession) => Promise<unknown>,
  allowedKeys: readonly string[]
): Promise<Response> {
  return handle(context, async () => {
    const body = await readBody(context, allowedKeys);
    const requestId = readRequestId(body);
    const authenticated = await authenticateRequest(context, options.authService);
    const decision = authorizeAdmin(authenticated.principal, 'admin.read');
    if (!decision.allowed) throw new AuthError(decision.reasonCode, '需要管理员权限', 403);
    return success(context, requestId, await action(body, authenticated));
  });
}

async function adminWrite(
  context: Context,
  options: AuthRoutesOptions,
  action: (body: Record<string, unknown>, authenticated: AuthenticatedSession) => Promise<unknown>,
  allowedKeys: readonly string[]
): Promise<Response> {
  return handle(context, async () => {
    const body = await readBody(context, allowedKeys);
    const requestId = readRequestId(body);
    const authenticated = await authenticateMutation(context, options);
    const decision = authorizeAdmin(authenticated.principal, 'admin.write');
    if (!decision.allowed) throw new AuthError(decision.reasonCode, '需要管理员权限', 403);
    return success(context, requestId, await action(body, authenticated));
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
  if (!isRecord(value) || Object.keys(value).some((key) => !allowedKeys.includes(key))) {
    throw new AuthError('INVALID_REQUEST_BODY', '请求 Body 无效或包含未定义字段', 400);
  }
  readRequestId(value);
  REQUEST_IDS.set(context.req.raw, value.requestId as string);
  return value;
}

function readRequestId(body: Record<string, unknown>): string {
  if (!isRequestId(body.requestId))
    throw new AuthError('INVALID_REQUEST_ID', 'requestId 必须是 UUID v4', 400);
  return body.requestId;
}

function readString(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== 'string') throw new AuthError('INVALID_REQUEST_BODY', `${key} 无效`, 400);
  return value;
}

function readNullableString(body: Record<string, unknown>, key: string): string | null {
  const value = body[key];
  if (value === null) return null;
  return readString(body, key);
}

function readOptionalRemark(body: Record<string, unknown>, key: string): string | null | undefined {
  return body[key] === undefined ? undefined : readRemark(body, key);
}

function readRemark(body: Record<string, unknown>, key: string): string | null {
  try {
    return normalizeRemark(readNullableString(body, key));
  } catch {
    throw new AuthError('INVALID_REMARK', 'remark 不能超过 500 个 Unicode 字符', 400);
  }
}

function readPassword(body: Record<string, unknown>, key: string): string {
  const password = readString(body, key);
  const bytes = new TextEncoder().encode(password).byteLength;
  if (bytes < 12 || bytes > 256) {
    throw new AuthError('INVALID_PASSWORD', '密码必须为 12–256 UTF-8 字节', 400);
  }
  return password;
}

function readInteger(body: Record<string, unknown>, key: string): number {
  const value = body[key];
  if (!Number.isSafeInteger(value)) throw new AuthError('INVALID_REQUEST_BODY', `${key} 无效`, 400);
  return value as number;
}

function readNullableRevision(body: Record<string, unknown>, key: string): number | null {
  if (body[key] === null) return null;
  return readInteger(body, key);
}

function credentialRouteError(error: unknown): AuthError {
  if (error instanceof AuthError) return error;
  if (error instanceof EntityVersionConflictError) {
    return new AuthError('ENTITY_VERSION_CONFLICT', '凭据已被其他请求更新', 409);
  }
  return new AuthError(
    'GATEWAY_CREDENTIAL_INVALID',
    error instanceof Error ? error.message : 'Alibaba 授权包无效',
    400
  );
}

function readPage(body: Record<string, unknown>): number {
  return body.page === undefined ? 1 : readInteger(body, 'page');
}

function readPageSize(body: Record<string, unknown>): number {
  return body.pageSize === undefined ? 20 : readInteger(body, 'pageSize');
}

function readEnum<T extends string>(body: Record<string, unknown>, key: string, values: readonly T[]): T {
  const value = readString(body, key);
  if (!values.some((candidate) => candidate === value)) {
    throw new AuthError('INVALID_REQUEST_BODY', `${key} 无效`, 400);
  }
  return value as T;
}

async function handle(context: Context, action: () => Promise<Response>): Promise<Response> {
  try {
    return await action();
  } catch (error: unknown) {
    const requestId = await requestIdForError(context);
    if (error instanceof AuthError) {
      return failure(context, requestId, error.status, {
        code: error.code,
        message: error.message,
        retryable: false
      });
    }
    return failure(context, requestId, 500, {
      code: 'INTERNAL_ERROR',
      message: '内部错误',
      retryable: false
    });
  }
}

function requestIdForError(context: Context): Promise<string> {
  return Promise.resolve(REQUEST_IDS.get(context.req.raw) ?? crypto.randomUUID());
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

function setSessionCookies(
  context: Context,
  options: Pick<AuthRoutesOptions, 'apiPrefix' | 'environment'>,
  sessionToken: string,
  csrfToken: string
): void {
  const secure = options.environment !== 'local-node' && options.environment !== 'test';
  setCookie(context, SESSION_COOKIE, sessionToken, {
    httpOnly: true,
    secure,
    sameSite: 'Strict',
    path: options.apiPrefix,
    maxAge: 8 * 60 * 60
  });
  setCsrfCookie(context, options, csrfToken);
}

function setCsrfCookie(
  context: Context,
  options: Pick<AuthRoutesOptions, 'environment'>,
  csrfToken: string
): void {
  const secure = options.environment !== 'local-node' && options.environment !== 'test';
  setCookie(context, CSRF_COOKIE, csrfToken, {
    httpOnly: false,
    secure,
    sameSite: 'Strict',
    path: '/',
    maxAge: 8 * 60 * 60
  });
}

function clearSessionCookies(
  context: Context,
  options: Pick<AuthRoutesOptions, 'apiPrefix' | 'environment'>
): void {
  const secure = options.environment !== 'local-node' && options.environment !== 'test';
  setCookie(context, SESSION_COOKIE, '', {
    httpOnly: true,
    secure,
    sameSite: 'Strict',
    path: options.apiPrefix,
    maxAge: 0
  });
  for (const path of ['/', options.apiPrefix]) {
    setCookie(context, CSRF_COOKIE, '', {
      httpOnly: false,
      secure,
      sameSite: 'Strict',
      path,
      maxAge: 0
    });
  }
}

function publicUser(authenticated: AuthenticatedSession): PublicUser {
  return toPublicUser(authenticated.user);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredRequestEvents(options: AuthRoutesOptions): RequestEventRepository {
  if (!options.requestEvents) {
    throw new AuthError('REQUEST_DIAGNOSTICS_UNAVAILABLE', '请求诊断存储不可用', 503);
  }
  return options.requestEvents;
}
