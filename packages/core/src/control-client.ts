import { DEFAULT_API_PREFIX, normalizeApiPrefix } from './api-contract';
import { GatewayException } from './errors';
import { createRequestId, NetworkManager } from './network';

import type { ApiResponse, BackendMeta } from './api-contract';
import type { EntityAuditFields, UnixEpochMilliseconds } from './audit';
import type { NetworkTransport } from './network';
import type { AlibabaOpenApiCredentialBundle } from './alibaba-credential-bundle';
import type {
  AlibabaCredentialAcquisitionContinueCommand,
  AlibabaCredentialAcquisitionState
} from './alibaba-credential-acquisition';

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

export interface ControlBootstrapStatus {
  initialized: boolean;
  bootstrapTokenConfigured: boolean;
  bootstrapAvailable: boolean;
  authenticationMode?: 'password' | 'passkey';
}

interface AuthenticationResult {
  user: ControlUser;
  session: {
    principal: ControlPrincipal;
    csrfToken: string;
    absoluteExpiresTimeUtc: UnixEpochMilliseconds;
    idleExpiresTimeUtc: UnixEpochMilliseconds;
  };
  recoveryCodes?: string[];
}

export interface ControlPasskeyOptions {
  challengeId: string;
  options: Record<string, unknown>;
}

export interface ControlPasskeyCredential {
  id: string;
  name: string;
  deviceType: 'singleDevice' | 'multiDevice';
  backedUp: boolean;
  rpId: string;
  createTimeUtc: UnixEpochMilliseconds;
}

export interface ControlPasskeyAuthenticationResult {
  session: ControlSession;
  recoveryCodes: string[];
}

export interface ControlUserEnrollment {
  user: ControlUser;
  enrollmentToken: string;
  expiresTimeUtc: UnixEpochMilliseconds;
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
  gatewayMode: 'mock' | 'replay' | 'disabled' | 'real';
  schemaVersion: number;
  requestEventRetentionDays: number;
  realMutationsPaused?: boolean;
  gatewayStatus: {
    source: 'environment' | 'credential-bundle' | 'd1-vault' | 'documentation-replay';
    configured: boolean;
    hasAppKey: boolean;
    hasAppSecret: boolean;
    hasAccessToken: boolean;
    endpointOrigin: string;
    signMethod: 'hmac' | 'md5' | 'hmac-sha256';
    realReadEnabled: boolean;
    mutationEnabled: boolean;
    accessTokenExpiresTimeUtc?: number | null;
    lastRefreshTimeUtc?: number | null;
    lastRefreshErrorCode?: string | null;
  };
}

export interface ControlRealMutationStatus {
  paused: boolean;
  revision: number | null;
  updateTimeUtc: UnixEpochMilliseconds | null;
  updaterId: string | null;
  remark: string | null;
}

export interface ControlGatewayCredentialSummary {
  configured: boolean;
  revision: number | null;
  accessTokenExpiresTimeUtc: UnixEpochMilliseconds | null;
  refreshTokenExpiresTimeUtc: UnixEpochMilliseconds | null;
  lastRefreshTimeUtc: UnixEpochMilliseconds | null;
  lastRefreshErrorCode: string | null;
  updateTimeUtc: UnixEpochMilliseconds | null;
  updaterId: string | null;
  remark: string | null;
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
  backendMeta(): Promise<BackendMeta>;
  session(): Promise<ControlSession>;
  bootstrapStatus(): Promise<ControlBootstrapStatus>;
  bootstrap(input: {
    bootstrapToken: string;
    username: string;
    password: string;
    remark?: string | null;
  }): Promise<ControlSession>;
  login(username: string, password: string): Promise<ControlSession>;
  passkeyBootstrapOptions?(bootstrapToken: string, username: string): Promise<ControlPasskeyOptions>;
  passkeyBootstrapVerify?(
    challengeId: string,
    response: unknown,
    credentialName?: string
  ): Promise<ControlPasskeyAuthenticationResult>;
  passkeyLoginOptions?(): Promise<ControlPasskeyOptions>;
  passkeyLoginVerify?(challengeId: string, response: unknown): Promise<ControlSession>;
  passkeyRecoveryOptions?(username: string, recoveryCode: string): Promise<ControlPasskeyOptions>;
  passkeyRecoveryVerify?(
    challengeId: string,
    response: unknown,
    credentialName?: string
  ): Promise<ControlPasskeyAuthenticationResult>;
  passkeyEnrollmentOptions?(enrollmentToken: string): Promise<ControlPasskeyOptions>;
  passkeyEnrollmentVerify?(
    challengeId: string,
    response: unknown,
    credentialName?: string
  ): Promise<ControlPasskeyAuthenticationResult>;
  listPasskeys?(): Promise<ControlPasskeyCredential[]>;
  passkeyRegistrationOptions?(): Promise<ControlPasskeyOptions>;
  registerPasskey?(
    challengeId: string,
    response: unknown,
    credentialName?: string
  ): Promise<ControlPasskeyCredential>;
  removePasskey?(credentialId: string): Promise<void>;
  regenerateRecoveryCodes?(): Promise<string[]>;
  logout(): Promise<void>;
  listUsers(page?: number, pageSize?: number): Promise<PageResult<ControlUser>>;
  createUser(input: {
    username: string;
    password: string;
    role: ControlUserRole;
    remark?: string | null;
  }): Promise<ControlUser>;
  createUserEnrollment?(input: {
    username: string;
    role: ControlUserRole;
    remark?: string | null;
  }): Promise<ControlUserEnrollment>;
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
  gatewayCredentialStatus(): Promise<ControlGatewayCredentialSummary>;
  importGatewayCredential(
    bundle: AlibabaOpenApiCredentialBundle,
    revision: number | null,
    remark?: string | null
  ): Promise<ControlGatewayCredentialSummary>;
  refreshGatewayCredential(): Promise<ControlGatewayCredentialSummary>;
  clearGatewayCredential(revision: number): Promise<void>;
  startAlibabaCredentialAcquisition?(input: {
    account: string;
    password: string;
    callbackUrl: string | null;
  }): Promise<AlibabaCredentialAcquisitionState>;
  continueAlibabaCredentialAcquisition?(
    jobId: string,
    command: AlibabaCredentialAcquisitionContinueCommand
  ): Promise<AlibabaCredentialAcquisitionState>;
  alibabaCredentialAcquisitionStatus?(jobId: string): Promise<AlibabaCredentialAcquisitionState>;
  cancelAlibabaCredentialAcquisition?(jobId: string): Promise<AlibabaCredentialAcquisitionState>;
  realMutationStatus?(): Promise<ControlRealMutationStatus>;
  updateRealMutationPause?(
    paused: boolean,
    revision: number | null,
    remark?: string | null
  ): Promise<ControlRealMutationStatus>;
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

  backendMeta(): Promise<BackendMeta> {
    return this.#call('/meta/get', {});
  }

  session(): Promise<ControlSession> {
    return this.#call('/auth/session/get', {});
  }

  bootstrapStatus(): Promise<ControlBootstrapStatus> {
    return this.#call('/auth/bootstrap/status/get', {});
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

  passkeyBootstrapOptions(bootstrapToken: string, username: string): Promise<ControlPasskeyOptions> {
    return this.#call('/auth/passkey/bootstrap/options', { bootstrapToken, username });
  }

  async passkeyBootstrapVerify(
    challengeId: string,
    response: unknown,
    credentialName?: string
  ): Promise<ControlPasskeyAuthenticationResult> {
    return this.#passkeyAuthenticationResult(
      '/auth/passkey/bootstrap/verify',
      challengeId,
      response,
      credentialName
    );
  }

  passkeyLoginOptions(): Promise<ControlPasskeyOptions> {
    return this.#call('/auth/passkey/login/options', {});
  }

  async passkeyLoginVerify(challengeId: string, response: unknown): Promise<ControlSession> {
    const result = await this.#call<AuthenticationResult>('/auth/passkey/login/verify', {
      challengeId,
      response
    });
    this.#sessionCsrfToken = result.session.csrfToken;
    return toControlSession(result);
  }

  passkeyRecoveryOptions(username: string, recoveryCode: string): Promise<ControlPasskeyOptions> {
    return this.#call('/auth/passkey/recovery/options', { username, recoveryCode });
  }

  passkeyRecoveryVerify(
    challengeId: string,
    response: unknown,
    credentialName?: string
  ): Promise<ControlPasskeyAuthenticationResult> {
    return this.#passkeyAuthenticationResult(
      '/auth/passkey/recovery/verify',
      challengeId,
      response,
      credentialName
    );
  }

  passkeyEnrollmentOptions(enrollmentToken: string): Promise<ControlPasskeyOptions> {
    return this.#call('/auth/passkey/enrollment/options', { enrollmentToken });
  }

  passkeyEnrollmentVerify(
    challengeId: string,
    response: unknown,
    credentialName?: string
  ): Promise<ControlPasskeyAuthenticationResult> {
    return this.#passkeyAuthenticationResult(
      '/auth/passkey/enrollment/verify',
      challengeId,
      response,
      credentialName
    );
  }

  listPasskeys(): Promise<ControlPasskeyCredential[]> {
    return this.#call('/auth/passkeys/list', {});
  }

  passkeyRegistrationOptions(): Promise<ControlPasskeyOptions> {
    return this.#call('/auth/passkeys/register/options', {});
  }

  registerPasskey(
    challengeId: string,
    response: unknown,
    credentialName?: string
  ): Promise<ControlPasskeyCredential> {
    return this.#call('/auth/passkeys/register/verify', {
      challengeId,
      response,
      ...(credentialName ? { credentialName } : {})
    });
  }

  async removePasskey(credentialId: string): Promise<void> {
    await this.#call('/auth/passkeys/remove', { credentialId });
  }

  async regenerateRecoveryCodes(): Promise<string[]> {
    const result = await this.#call<{ recoveryCodes: string[] }>('/auth/recovery-codes/regenerate', {});
    return result.recoveryCodes;
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

  createUserEnrollment(input: {
    username: string;
    role: ControlUserRole;
    remark?: string | null;
  }): Promise<ControlUserEnrollment> {
    return this.#call('/admin/users/enrollment/create', input);
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

  gatewayCredentialStatus(): Promise<ControlGatewayCredentialSummary> {
    return this.#call('/admin/gateway-credentials/get', {});
  }

  importGatewayCredential(
    bundle: AlibabaOpenApiCredentialBundle,
    revision: number | null,
    remark: string | null = null
  ): Promise<ControlGatewayCredentialSummary> {
    return this.#call('/admin/gateway-credentials/import', { bundle, revision, remark });
  }

  refreshGatewayCredential(): Promise<ControlGatewayCredentialSummary> {
    return this.#call('/admin/gateway-credentials/refresh', {});
  }

  async clearGatewayCredential(revision: number): Promise<void> {
    await this.#call('/admin/gateway-credentials/clear', { revision });
  }

  startAlibabaCredentialAcquisition(input: {
    account: string;
    password: string;
    callbackUrl: string | null;
  }): Promise<AlibabaCredentialAcquisitionState> {
    return this.#call('/admin/alibaba-credential-acquisition/start', input);
  }

  continueAlibabaCredentialAcquisition(
    jobId: string,
    command: AlibabaCredentialAcquisitionContinueCommand
  ): Promise<AlibabaCredentialAcquisitionState> {
    return this.#call('/admin/alibaba-credential-acquisition/continue', { jobId, command });
  }

  alibabaCredentialAcquisitionStatus(jobId: string): Promise<AlibabaCredentialAcquisitionState> {
    return this.#call('/admin/alibaba-credential-acquisition/status', { jobId });
  }

  cancelAlibabaCredentialAcquisition(jobId: string): Promise<AlibabaCredentialAcquisitionState> {
    return this.#call('/admin/alibaba-credential-acquisition/cancel', { jobId });
  }

  realMutationStatus(): Promise<ControlRealMutationStatus> {
    return this.#call('/admin/real-mutations/status/get', {});
  }

  updateRealMutationPause(
    paused: boolean,
    revision: number | null,
    remark: string | null = null
  ): Promise<ControlRealMutationStatus> {
    return this.#call('/admin/real-mutations/pause/update', { paused, revision, remark });
  }

  async #passkeyAuthenticationResult(
    path: string,
    challengeId: string,
    response: unknown,
    credentialName?: string
  ): Promise<ControlPasskeyAuthenticationResult> {
    const result = await this.#call<AuthenticationResult>(path, {
      challengeId,
      response,
      ...(credentialName ? { credentialName } : {})
    });
    this.#sessionCsrfToken = result.session.csrfToken;
    return { session: toControlSession(result), recoveryCodes: result.recoveryCodes ?? [] };
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
      throw new GatewayException(
        {
          code: 'INVALID_BFF_RESPONSE',
          message: 'BFF 响应契约或 requestId 无效',
          retryable: false
        },
        response.requestId
      );
    }
    if (!response.data.ok) throw new GatewayException(response.data.error, response.data.requestId);
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
