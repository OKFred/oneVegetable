import { DEFAULT_API_PREFIX, normalizeApiPrefix } from './api-contract';
import { GatewayException } from './errors';
import { createRequestId, NetworkManager } from './network';

import type { ApiResponse } from './api-contract';
import type { EntityAuditFields, UnixEpochMilliseconds } from './audit';
import type { NetworkTransport } from './network';

export type ControlUserRole = 'admin' | 'user';
export type ControlUserStatus = 'active' | 'disabled';

export interface ControlUser extends EntityAuditFields {
  id: string;
  username: string;
  role: ControlUserRole;
  status: ControlUserStatus;
  lockedUntilUtc: UnixEpochMilliseconds | null;
}

export interface ControlPrincipal {
  actorId: string;
  username: string;
  role: ControlUserRole;
  source: 'bff' | 'extension';
}

export interface ControlSession {
  principal: ControlPrincipal;
  user: ControlUser;
  absoluteExpiresTimeUtc: UnixEpochMilliseconds;
  idleExpiresTimeUtc: UnixEpochMilliseconds;
}

interface AuthenticationResult {
  user: ControlUser;
  session: {
    principal: ControlPrincipal;
    csrfToken: string;
    absoluteExpiresTimeUtc: UnixEpochMilliseconds;
    idleExpiresTimeUtc: UnixEpochMilliseconds;
  };
}

export interface ControlAuditEvent {
  id: string;
  eventTimeUtc: UnixEpochMilliseconds;
  requestId: string;
  actorId: string | null;
  action: string;
  resourceKind: string;
  resourceId: string | null;
  outcome: 'success' | 'error' | 'denied';
  reasonCode: string;
  revisionBefore: number | null;
  revisionAfter: number | null;
}

export interface ControlSystemInfo {
  runtime: 'node' | 'cloudflare';
  environment: string;
  apiPrefix: string;
  database: 'sqlite' | 'd1';
  gatewayMode: 'mock' | 'disabled' | 'real';
  schemaVersion: number;
  requestEventRetentionDays: number;
  gatewayStatus: {
    source: 'environment';
    configured: boolean;
    hasAppKey: boolean;
    hasAppSecret: boolean;
    hasAccessToken: boolean;
    endpointOrigin: string;
    signMethod: 'hmac' | 'md5' | 'hmac-sha256';
    realReadEnabled: boolean;
    mutationEnabled: false;
  };
}

export interface ControlRequestEvent {
  id: string;
  eventTimeUtc: UnixEpochMilliseconds;
  requestId: string;
  environment: string;
  runtime: 'node' | 'cloudflare';
  route: string;
  operation: string;
  actorId: string | null;
  outcome: 'success' | 'error' | 'denied';
  statusCode: number;
  durationMilliseconds: number;
}

export interface PageResult<T> {
  items: T[];
  total: number;
}

export interface ControlClient {
  session(): Promise<ControlSession>;
  bootstrap(input: {
    bootstrapToken: string;
    username: string;
    password: string;
    remark?: string | null;
  }): Promise<ControlSession>;
  login(username: string, password: string): Promise<ControlSession>;
  logout(): Promise<void>;
  listUsers(page?: number, pageSize?: number): Promise<PageResult<ControlUser>>;
  createUser(input: {
    username: string;
    password: string;
    role: ControlUserRole;
    remark?: string | null;
  }): Promise<ControlUser>;
  updateUser(input: {
    userId: string;
    role: ControlUserRole;
    status: ControlUserStatus;
    revision: number;
    remark: string | null;
  }): Promise<ControlUser>;
  resetPassword(
    userId: string,
    revision: number,
    newPassword?: string
  ): Promise<{ user: ControlUser; temporaryPassword: string | null }>;
  revokeSessions(userId: string): Promise<void>;
  listAudit(input?: {
    requestIdFilter?: string;
    actorId?: string;
    action?: string;
    outcome?: ControlAuditEvent['outcome'];
    fromTimeUtc?: number;
    toTimeUtc?: number;
    page?: number;
    pageSize?: number;
  }): Promise<PageResult<ControlAuditEvent>>;
  system(): Promise<ControlSystemInfo>;
  policySummary(): Promise<Record<string, unknown>>;
  listRequestEvents(input?: {
    requestIdFilter?: string;
    actorId?: string;
    route?: string;
    operation?: string;
    outcome?: ControlRequestEvent['outcome'];
    fromTimeUtc?: number;
    toTimeUtc?: number;
    page?: number;
    pageSize?: number;
  }): Promise<PageResult<ControlRequestEvent>>;
  purgeRequestEvents(): Promise<{
    deletedCount: number;
    retentionDays: number;
    cutoffTimeUtc: UnixEpochMilliseconds;
  }>;
  csrfToken(): string | null;
}

export interface BffControlClientOptions {
  baseUrl: string;
  apiPrefix?: string | undefined;
  transport?: NetworkTransport;
  csrfToken?: () => string | null;
}

export class BffControlClient implements ControlClient {
  readonly #baseUrl: URL;
  readonly #apiPrefix: string;
  readonly #network: NetworkManager;
  readonly #externalCsrfToken: (() => string | null) | undefined;
  #sessionCsrfToken: string | null = null;

  constructor(options: BffControlClientOptions) {
    this.#baseUrl = new URL(options.baseUrl);
    if (this.#baseUrl.protocol !== 'http:' && this.#baseUrl.protocol !== 'https:') {
      throw new Error('BFF 地址仅允许 HTTP(S)');
    }
    this.#apiPrefix = normalizeApiPrefix(options.apiPrefix ?? DEFAULT_API_PREFIX);
    this.#externalCsrfToken = options.csrfToken;
    this.#network = new NetworkManager({
      ...(options.transport ? { transport: options.transport } : {}),
      policies: {
        alibaba: { allowedOrigins: [] },
        bff: {
          allowedOrigins: [this.#baseUrl.origin],
          timeoutMilliseconds: 30_000,
          maxRequestBytes: 1024 * 1024,
          maxResponseBytes: 4 * 1024 * 1024,
          credentials: 'include',
          redirect: 'error'
        },
        'external-photo': { allowedOrigins: [] }
      }
    });
  }

  csrfToken(): string | null {
    return this.#sessionCsrfToken ?? this.#externalCsrfToken?.() ?? null;
  }

  session(): Promise<ControlSession> {
    return this.#call('/auth/session/get', {});
  }

  async bootstrap(input: {
    bootstrapToken: string;
    username: string;
    password: string;
    remark?: string | null;
  }): Promise<ControlSession> {
    const result = await this.#call<AuthenticationResult>('/auth/bootstrap', input);
    this.#sessionCsrfToken = result.session.csrfToken;
    return toControlSession(result);
  }

  async login(username: string, password: string): Promise<ControlSession> {
    const result = await this.#call<AuthenticationResult>('/auth/login', { username, password });
    this.#sessionCsrfToken = result.session.csrfToken;
    return toControlSession(result);
  }

  async logout(): Promise<void> {
    await this.#call('/auth/logout', {});
    this.#sessionCsrfToken = null;
  }

  listUsers(page = 1, pageSize = 20): Promise<PageResult<ControlUser>> {
    return this.#call('/admin/users/list', { page, pageSize });
  }

  createUser(input: {
    username: string;
    password: string;
    role: ControlUserRole;
    remark?: string | null;
  }): Promise<ControlUser> {
    return this.#call('/admin/users/create', input);
  }

  updateUser(input: {
    userId: string;
    role: ControlUserRole;
    status: ControlUserStatus;
    revision: number;
    remark: string | null;
  }): Promise<ControlUser> {
    return this.#call('/admin/users/update', input);
  }

  resetPassword(
    userId: string,
    revision: number,
    newPassword?: string
  ): Promise<{ user: ControlUser; temporaryPassword: string | null }> {
    return this.#call('/admin/users/password/reset', {
      userId,
      revision,
      ...(newPassword ? { newPassword } : {})
    });
  }

  async revokeSessions(userId: string): Promise<void> {
    await this.#call('/admin/users/sessions/revoke', { userId });
  }

  listAudit(
    input: {
      requestIdFilter?: string;
      actorId?: string;
      action?: string;
      outcome?: ControlAuditEvent['outcome'];
      fromTimeUtc?: number;
      toTimeUtc?: number;
      page?: number;
      pageSize?: number;
    } = {}
  ): Promise<PageResult<ControlAuditEvent>> {
    return this.#call('/admin/audit-events/list', { page: 1, pageSize: 50, ...input });
  }

  system(): Promise<ControlSystemInfo> {
    return this.#call('/admin/system/get', {});
  }

  policySummary(): Promise<Record<string, unknown>> {
    return this.#call('/admin/policy-summary/get', {});
  }

  listRequestEvents(
    input: {
      requestIdFilter?: string;
      actorId?: string;
      route?: string;
      operation?: string;
      outcome?: ControlRequestEvent['outcome'];
      fromTimeUtc?: number;
      toTimeUtc?: number;
      page?: number;
      pageSize?: number;
    } = {}
  ): Promise<PageResult<ControlRequestEvent>> {
    return this.#call('/admin/request-events/list', { page: 1, pageSize: 50, ...input });
  }

  purgeRequestEvents(): Promise<{
    deletedCount: number;
    retentionDays: number;
    cutoffTimeUtc: UnixEpochMilliseconds;
  }> {
    return this.#call('/admin/request-events/purge', {});
  }

  async #call<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const requestId = createRequestId();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const csrfToken = this.csrfToken();
    if (csrfToken) headers['X-CSRF-Token'] = csrfToken;
    const response = await this.#network.request({
      service: 'bff',
      url: new URL(`${this.#apiPrefix}${path}`, this.#baseUrl),
      method: 'POST',
      headers,
      requestId,
      body: JSON.stringify({ requestId, ...body }),
      responseType: 'json'
    });
    if (!isApiResponse(response.data) || response.data.requestId !== requestId) {
      throw new GatewayException({
        code: 'INVALID_BFF_RESPONSE',
        message: 'BFF 响应契约或 requestId 无效',
        retryable: false
      });
    }
    if (!response.data.ok) throw new GatewayException(response.data.error);
    return response.data.data as T;
  }
}

function toControlSession(value: AuthenticationResult): ControlSession {
  return {
    principal: value.session.principal,
    user: value.user,
    absoluteExpiresTimeUtc: value.session.absoluteExpiresTimeUtc,
    idleExpiresTimeUtc: value.session.idleExpiresTimeUtc
  };
}

function isApiResponse(value: unknown): value is ApiResponse<unknown> {
  if (!isRecord(value) || typeof value.requestId !== 'string' || typeof value.ok !== 'boolean') return false;
  return value.ok ? 'data' in value : isRecord(value.error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
