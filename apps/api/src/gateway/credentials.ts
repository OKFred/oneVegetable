import { ALIBABA_GATEWAY } from '@one-vegetable/core';
import { IOP_API_ORIGIN, IOP_BUSINESS_ENDPOINT } from '@one-vegetable/core/alibaba-iop';

import type { GatewayCredentials, SignMethod, OperationId } from '@one-vegetable/core';
import type { GalleryRequestOptions } from '@one-vegetable/core/gallery-transfer-context';

export interface AlibabaCredentialEnvironment {
  ONE_VEGETABLE_ALIBABA_APP_KEY?: string;
  ONE_VEGETABLE_ALIBABA_APP_SECRET?: string;
  ONE_VEGETABLE_ALIBABA_ACCESS_TOKEN?: string;
  ONE_VEGETABLE_ALIBABA_ENDPOINT?: string;
  ONE_VEGETABLE_ALIBABA_SIGN_METHOD?: string;
  ONE_VEGETABLE_ALIBABA_PROTOCOL?: string;
}

export interface AlibabaCredentialStatus {
  source: 'environment' | 'credential-bundle' | 'd1-vault' | 'sqlite-vault' | 'documentation-replay';
  configured: boolean;
  hasAppKey: boolean;
  hasAppSecret: boolean;
  hasAccessToken: boolean;
  endpointOrigin: string;
  endpoint?: string;
  protocol?: 'top' | 'iop';
  signMethod: SignMethod;
  accessTokenExpiresTimeUtc?: number | null;
  accessTokenCapturedTimeUtc?: number | null;
  systemApiPermission?: 'active' | 'inactive' | 'not-recorded' | 'unknown';
  permissionCapturedTimeUtc?: number | null;
  lastRefreshTimeUtc?: number | null;
  lastRefreshErrorCode?: string | null;
}

export interface AlibabaCredentialProvider {
  status(): AlibabaCredentialStatus;
  requireCredentials(): GatewayCredentials;
}

export interface AsyncAlibabaCredentialProvider {
  status(): Promise<AlibabaCredentialStatus>;
  requireCredentials(requestId?: string, forceRefresh?: boolean): Promise<GatewayCredentials>;
  credentialSnapshot?(): Promise<GatewayCredentials | null>;
  selectProtocol?(
    operation: OperationId,
    payload: unknown,
    context?: GalleryRequestOptions
  ): Promise<'top' | 'iop'>;
  resolveForOperation?(
    operation: OperationId,
    payload: unknown,
    context?: GalleryRequestOptions & { requestId?: string }
  ): Promise<GatewayCredentials>;
}

export class GatewayConfigurationError extends Error {
  constructor(
    readonly code:
      | 'ALIBABA_CREDENTIALS_INCOMPLETE'
      | 'ALIBABA_CREDENTIAL_FILE_INVALID'
      | 'ALIBABA_PROTOCOL_INVALID'
      | 'ALIBABA_PROTOCOL_SELECTION_REQUIRED'
      | 'ALIBABA_AUTHORIZATION_BINDING_CHANGED'
      | 'PRODUCT_CONTEXT_CHANGED'
      | 'GALLERY_CONTEXT_CHANGED'
      | 'ALIBABA_PROTOCOL_ENDPOINT_MISMATCH'
      | 'IOP_TOKEN_RESULT_UNKNOWN'
      | 'IOP_TOKEN_REJECTED'
      | 'ALIBABA_ACCESS_TOKEN_EXPIRED'
      | 'ALIBABA_CREDENTIALS_NOT_CONFIGURED'
      | 'ALIBABA_CREDENTIAL_ENCRYPTION_KEY_INVALID'
      | 'ALIBABA_CREDENTIAL_VAULT_UNREADABLE'
      | 'ALIBABA_REFRESH_TOKEN_MISSING'
      | 'ALIBABA_REFRESH_TOKEN_EXPIRED'
      | 'ALIBABA_CREDENTIAL_REFRESH_IN_PROGRESS'
      | 'ALIBABA_TOKEN_REFRESH_FAILED'
      | 'ALIBABA_ENDPOINT_INVALID'
      | 'ALIBABA_SIGN_METHOD_INVALID'
      | 'META_CREDENTIAL_ENCRYPTION_KEY_INVALID'
      | 'META_CREDENTIAL_VAULT_UNREADABLE'
      | 'S3_CREDENTIAL_ENCRYPTION_KEY_INVALID'
      | 'S3_CREDENTIAL_VAULT_UNREADABLE'
      | 'S3_STORAGE_NOT_CONFIGURED'
      | 'S3_LOCAL_HTTP_DISABLED',
    message: string,
    readonly diagnostics: { subCode?: string; traceId?: string } = {}
  ) {
    super(message);
    this.name = 'GatewayConfigurationError';
  }
}

export class EnvironmentAlibabaCredentialProvider implements AlibabaCredentialProvider {
  readonly #appKey: string;
  readonly #appSecret: string;
  readonly #accessToken: string;
  readonly #endpoint: string;
  readonly #endpointOrigin: string;
  readonly #signMethod: SignMethod;
  readonly #protocol: 'top' | 'iop';

  constructor(environment: AlibabaCredentialEnvironment) {
    this.#appKey = readSecret(environment.ONE_VEGETABLE_ALIBABA_APP_KEY);
    this.#appSecret = readSecret(environment.ONE_VEGETABLE_ALIBABA_APP_SECRET);
    this.#accessToken = readSecret(environment.ONE_VEGETABLE_ALIBABA_ACCESS_TOKEN);
    this.#protocol = readProtocol(environment.ONE_VEGETABLE_ALIBABA_PROTOCOL);
    const endpoint = readEndpoint(environment.ONE_VEGETABLE_ALIBABA_ENDPOINT, this.#protocol);
    this.#endpoint = endpoint.href;
    this.#endpointOrigin = endpoint.origin;
    this.#signMethod =
      this.#protocol === 'iop'
        ? 'hmac-sha256'
        : readSignMethod(environment.ONE_VEGETABLE_ALIBABA_SIGN_METHOD);
  }

  status(): AlibabaCredentialStatus {
    const hasAppKey = this.#appKey.length > 0;
    const hasAppSecret = this.#appSecret.length > 0;
    const hasAccessToken = this.#accessToken.length > 0;
    return {
      source: 'environment',
      configured: hasAppKey && hasAppSecret && hasAccessToken,
      hasAppKey,
      hasAppSecret,
      hasAccessToken,
      endpointOrigin: this.#endpointOrigin,
      endpoint: this.#endpoint,
      protocol: this.#protocol,
      signMethod: this.#signMethod
    };
  }

  requireCredentials(): GatewayCredentials {
    if (!this.status().configured) {
      throw new GatewayConfigurationError('ALIBABA_CREDENTIALS_INCOMPLETE', 'Alibaba 服务端凭据未完整配置');
    }
    return {
      appKey: this.#appKey,
      appSecret: this.#appSecret,
      accessToken: this.#accessToken,
      endpoint: this.#endpoint,
      protocol: this.#protocol,
      signMethod: this.#signMethod
    };
  }
}

function readSecret(value: string | undefined): string {
  const result = value?.trim() ?? '';
  if (result.length > 4096) {
    throw new GatewayConfigurationError('ALIBABA_CREDENTIALS_INCOMPLETE', 'Alibaba 服务端凭据长度无效');
  }
  return result;
}

export function readProtocol(value: unknown): 'top' | 'iop' {
  if (value === undefined) return 'top';
  if (value === 'top' || value === 'iop') return value;
  throw new GatewayConfigurationError('ALIBABA_PROTOCOL_INVALID', 'Alibaba 协议必须显式为 top 或 iop');
}

export function readEndpoint(value: string | undefined, protocol: 'top' | 'iop' = 'top'): URL {
  let endpoint: URL;
  try {
    endpoint = new URL(value ?? (protocol === 'iop' ? IOP_BUSINESS_ENDPOINT : ALIBABA_GATEWAY));
  } catch {
    throw new GatewayConfigurationError('ALIBABA_ENDPOINT_INVALID', 'Alibaba 网关地址无效');
  }
  if (
    endpoint.protocol !== 'https:' ||
    endpoint.username !== '' ||
    endpoint.password !== '' ||
    endpoint.search !== '' ||
    endpoint.hash !== ''
  ) {
    throw new GatewayConfigurationError('ALIBABA_ENDPOINT_INVALID', 'Alibaba 网关必须是无凭据的 HTTPS 地址');
  }
  if (
    (protocol === 'iop' && endpoint.href !== IOP_BUSINESS_ENDPOINT) ||
    (protocol === 'top' && endpoint.origin === IOP_API_ORIGIN)
  ) {
    throw new GatewayConfigurationError('ALIBABA_PROTOCOL_ENDPOINT_MISMATCH', 'Alibaba 协议与网关地址不匹配');
  }
  return endpoint;
}

export function readSignMethod(value: string | undefined): SignMethod {
  const normalized = value?.trim().toLocaleLowerCase();
  const method = normalized === undefined || normalized === '' ? 'hmac' : normalized;
  if (method === 'hmac' || method === 'md5' || method === 'hmac-sha256') return method;
  throw new GatewayConfigurationError('ALIBABA_SIGN_METHOD_INVALID', 'Alibaba 签名算法无效');
}
