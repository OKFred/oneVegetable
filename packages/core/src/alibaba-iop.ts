import { GatewayException } from './errors';
import { NetworkManager, type NetworkTransport } from './network';
import { parseAlibabaTokenResponse, type AlibabaTokenResponse } from './alibaba-credential-bundle';

export const IOP_AUTHORIZE_ENDPOINT = 'https://openapi-auth.alibaba.com/oauth/authorize';
export const IOP_API_ORIGIN = 'https://openapi-api.alibaba.com';
export const PUBLIC_AUTH_ORIGIN = 'https://one-vegetable-auth.pages.dev';
export const PUBLIC_AUTH_CALLBACK = `${PUBLIC_AUTH_ORIGIN}/callback.html`;
export const STORE_EXTENSION_ID = 'aepfdoldflokikbbcpnfifkacpfakmjc';

export type IopTokenPath = '/auth/token/create' | '/auth/token/refresh';

/** GOP signs the API path, sorted parameter names and values; it is not TOP signing. */
export async function signIopRequest(
  path: IopTokenPath,
  parameters: Readonly<Record<string, string>>,
  secret: string
): Promise<string> {
  const text =
    path +
    Object.keys(parameters)
      .filter((key) => key !== 'sign')
      .sort()
      .map((key) => key + (parameters[key] ?? ''))
      .join('');
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

export class AlibabaIopTokenClient {
  private readonly network: NetworkManager;

  constructor(
    transport?: NetworkTransport,
    private readonly clock: () => number = Date.now
  ) {
    this.network = new NetworkManager({
      ...(transport ? { transport } : {}),
      policies: {
        alibaba: {
          allowedOrigins: [IOP_API_ORIGIN],
          maxRequestBytes: 16_384,
          maxResponseBytes: 65_536,
          timeoutMilliseconds: 30_000,
          credentials: 'omit',
          redirect: 'error',
          cache: 'no-store'
        }
      }
    });
  }

  async request(
    path: IopTokenPath,
    input: {
      appKey: string;
      appSecret: string;
      value: string;
      requestId: string;
    }
  ): Promise<AlibabaTokenResponse> {
    const parameters: Record<string, string> = {
      app_key: input.appKey,
      timestamp: String(this.clock()),
      sign_method: 'sha256',
      simplify: 'true',
      [path === '/auth/token/create' ? 'code' : 'refresh_token']: input.value
    };
    const response = await this.network.request({
      service: 'alibaba',
      url: `${IOP_API_ORIGIN}/rest${path}`,
      method: 'POST',
      requestId: input.requestId,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
      body: new URLSearchParams({
        ...parameters,
        sign: await signIopRequest(path, parameters, input.appSecret)
      }),
      responseType: 'text',
      maxAttempts: 1
    });
    let value: unknown;
    try {
      value = JSON.parse(String(response.data));
    } catch {
      throw new GatewayException(
        {
          code: 'IOP_TOKEN_RESULT_UNKNOWN',
          message: 'IOP_TOKEN_RESULT_UNKNOWN',
          retryable: false
        },
        input.requestId
      );
    }
    if (
      response.status >= 500 ||
      !isRecord(value) ||
      (typeof value.code !== 'string' && typeof value.code !== 'number')
    ) {
      throw new GatewayException(
        { code: 'IOP_TOKEN_RESULT_UNKNOWN', message: 'IOP_TOKEN_RESULT_UNKNOWN', retryable: false },
        input.requestId
      );
    }
    if (!response.ok || (value.code !== '0' && value.code !== 0)) {
      // Never echo a provider body: it may contain credentials or an authorization code.
      const subCode = /^[\w.-]{1,80}$/u.test(String(value.code)) ? String(value.code) : 'provider-rejected';
      throw new GatewayException(
        { code: 'IOP_TOKEN_REJECTED', message: 'IOP_TOKEN_REJECTED', subCode, retryable: false },
        input.requestId
      );
    }
    try {
      return parseAlibabaTokenResponse(value);
    } catch {
      throw new GatewayException(
        {
          code: 'IOP_TOKEN_RESULT_UNKNOWN',
          message: 'IOP_TOKEN_RESULT_UNKNOWN',
          retryable: false
        },
        input.requestId
      );
    }
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
