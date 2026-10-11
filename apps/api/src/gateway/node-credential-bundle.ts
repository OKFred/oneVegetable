import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { alibabaAuthorizationMetadata, type AlibabaAuthorizationMetadata } from '@one-vegetable/core';

import {
  EnvironmentAlibabaCredentialProvider,
  GatewayConfigurationError,
  readEndpoint,
  readProtocol,
  readSignMethod
} from './credentials';

import type { GatewayCredentials } from '@one-vegetable/core';
import type {
  AlibabaCredentialEnvironment,
  AlibabaCredentialProvider,
  AlibabaCredentialStatus
} from './credentials';

export interface NodeAlibabaCredentialEnvironment extends AlibabaCredentialEnvironment {
  ONE_VEGETABLE_ALIBABA_CREDENTIAL_FILE?: string;
}

interface CredentialBundleData extends AlibabaAuthorizationMetadata {
  protocol?: 'top' | 'iop';
  appKey: string;
  appSecret: string;
  accessToken: string;
  expiresAtUtc: string | null;
}

export function createNodeAlibabaCredentialProvider(
  environment: NodeAlibabaCredentialEnvironment,
  options: { workingDirectory?: string; now?: () => number } = {}
): AlibabaCredentialProvider {
  const file = environment.ONE_VEGETABLE_ALIBABA_CREDENTIAL_FILE?.trim();
  if (!file) return new EnvironmentAlibabaCredentialProvider(environment);
  return new NodeCredentialBundleProvider(
    resolve(options.workingDirectory ?? process.cwd(), file),
    environment,
    {
      now: options.now ?? Date.now
    }
  );
}

export class NodeCredentialBundleProvider implements AlibabaCredentialProvider {
  readonly #data: CredentialBundleData;
  readonly #endpoint: URL;
  readonly #signMethod: GatewayCredentials['signMethod'];
  readonly #now: () => number;
  readonly #protocol: 'top' | 'iop';

  constructor(
    path: string,
    environment: AlibabaCredentialEnvironment = {},
    options: { now?: () => number } = {}
  ) {
    this.#data = readCredentialBundle(path);
    this.#protocol = readProtocol(this.#data.protocol);
    if (
      environment.ONE_VEGETABLE_ALIBABA_PROTOCOL !== undefined &&
      readProtocol(environment.ONE_VEGETABLE_ALIBABA_PROTOCOL) !== this.#protocol
    )
      throw invalidBundle('Alibaba 授权包与环境协议不匹配');
    this.#endpoint = readEndpoint(environment.ONE_VEGETABLE_ALIBABA_ENDPOINT, this.#protocol);
    this.#signMethod =
      this.#protocol === 'iop'
        ? 'hmac-sha256'
        : readSignMethod(environment.ONE_VEGETABLE_ALIBABA_SIGN_METHOD);
    this.#now = options.now ?? Date.now;
  }

  status(): AlibabaCredentialStatus {
    return {
      source: 'credential-bundle',
      configured: !this.isExpired(),
      hasAppKey: true,
      hasAppSecret: true,
      hasAccessToken: true,
      accessTokenExpiresTimeUtc:
        this.#data.expiresAtUtc === null ? null : Date.parse(this.#data.expiresAtUtc),
      endpointOrigin: this.#endpoint.origin,
      endpoint: this.#endpoint.href,
      protocol: this.#protocol,
      signMethod: this.#signMethod,
      systemApiPermission: this.#data.systemApiPermission,
      permissionCapturedTimeUtc: this.#data.permissionCapturedTimeUtc
    };
  }

  requireCredentials(): GatewayCredentials {
    if (this.isExpired()) {
      throw new GatewayConfigurationError(
        'ALIBABA_ACCESS_TOKEN_EXPIRED',
        'Alibaba Access Token 已过期，请运行 pnpm openapi:auth:refresh'
      );
    }
    return {
      appKey: this.#data.appKey,
      appSecret: this.#data.appSecret,
      accessToken: this.#data.accessToken,
      endpoint: this.#endpoint.href,
      protocol: this.#protocol,
      signMethod: this.#signMethod
    };
  }

  private isExpired(): boolean {
    if (!this.#data.expiresAtUtc) return false;
    return Date.parse(this.#data.expiresAtUtc) <= this.#now() + 5 * 60_000;
  }
}

function readCredentialBundle(path: string): CredentialBundleData {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  } catch {
    throw invalidBundle('Alibaba 授权包不存在、不可读或不是有效 JSON');
  }
  const root = record(value);
  if (root.protocol !== undefined && root.protocol !== 'top' && root.protocol !== 'iop')
    throw invalidBundle('Alibaba 授权包协议无效');
  const application = record(root.application);
  const oauth = record(root.oauth);
  if (root.schemaVersion !== 1) throw invalidBundle('Alibaba 授权包版本不受支持');
  return {
    ...alibabaAuthorizationMetadata(value),
    ...(root.protocol === undefined ? {} : { protocol: root.protocol }),
    appKey: requiredSecret(application.appKey, 'AppKey'),
    appSecret: requiredSecret(application.appSecret, 'AppSecret'),
    accessToken: requiredSecret(oauth.accessToken, 'Access Token'),
    expiresAtUtc: nullableDate(oauth.expiresAtUtc)
  };
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function requiredSecret(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '' || value.length > 4096) {
    throw invalidBundle(`Alibaba 授权包中的 ${label} 无效`);
  }
  return value.trim();
}

function nullableDate(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    throw invalidBundle('Alibaba 授权包中的过期时间无效');
  }
  return value;
}

function invalidBundle(message: string): GatewayConfigurationError {
  return new GatewayConfigurationError('ALIBABA_CREDENTIAL_FILE_INVALID', message);
}
