import { ALIBABA_GATEWAY } from '@one-vegetable/core';

import type { GatewayCredentials, SignMethod } from '@one-vegetable/core';

export interface AlibabaCredentialEnvironment {
  ONE_VEGETABLE_ALIBABA_APP_KEY?: string;
  ONE_VEGETABLE_ALIBABA_APP_SECRET?: string;
  ONE_VEGETABLE_ALIBABA_ACCESS_TOKEN?: string;
  ONE_VEGETABLE_ALIBABA_ENDPOINT?: string;
  ONE_VEGETABLE_ALIBABA_SIGN_METHOD?: string;
}

export interface AlibabaCredentialStatus {
  source: 'environment' | 'documentation-replay';
  configured: boolean;
  hasAppKey: boolean;
  hasAppSecret: boolean;
  hasAccessToken: boolean;
  endpointOrigin: string;
  signMethod: SignMethod;
}

export interface AlibabaCredentialProvider {
  status(): AlibabaCredentialStatus;
  requireCredentials(): GatewayCredentials;
}

export class GatewayConfigurationError extends Error {
  constructor(
    readonly code:
      'ALIBABA_CREDENTIALS_INCOMPLETE' | 'ALIBABA_ENDPOINT_INVALID' | 'ALIBABA_SIGN_METHOD_INVALID',
    message: string
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

  constructor(environment: AlibabaCredentialEnvironment) {
    this.#appKey = readSecret(environment.ONE_VEGETABLE_ALIBABA_APP_KEY);
    this.#appSecret = readSecret(environment.ONE_VEGETABLE_ALIBABA_APP_SECRET);
    this.#accessToken = readSecret(environment.ONE_VEGETABLE_ALIBABA_ACCESS_TOKEN);
    const endpoint = readEndpoint(environment.ONE_VEGETABLE_ALIBABA_ENDPOINT ?? ALIBABA_GATEWAY);
    this.#endpoint = endpoint.href;
    this.#endpointOrigin = endpoint.origin;
    this.#signMethod = readSignMethod(environment.ONE_VEGETABLE_ALIBABA_SIGN_METHOD);
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

function readEndpoint(value: string): URL {
  let endpoint: URL;
  try {
    endpoint = new URL(value);
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
  return endpoint;
}

function readSignMethod(value: string | undefined): SignMethod {
  const normalized = value?.trim().toLocaleLowerCase();
  const method = normalized === undefined || normalized === '' ? 'hmac' : normalized;
  if (method === 'hmac' || method === 'md5' || method === 'hmac-sha256') return method;
  throw new GatewayConfigurationError('ALIBABA_SIGN_METHOD_INVALID', 'Alibaba 签名算法无效');
}
