import { NetworkManager, type NetworkTransport } from '@one-vegetable/core/network';
import { GatewayException } from '@one-vegetable/core/errors';
import { parseAlibabaTokenResponse } from '@one-vegetable/core/credential-bundle';
import { isRecord } from '@one-vegetable/core/alibaba-iop';
import type { AuthorizationTokenClient } from './iop-authorization';

/** Legacy TOP OAuth only; never sends its secret or code to IOP. */
export class TopAuthorizationTokenClient implements AuthorizationTokenClient {
  private readonly network: NetworkManager;
  constructor(transport?: NetworkTransport) {
    this.network = new NetworkManager({
      ...(transport ? { transport } : {}),
      policies: {
        alibaba: {
          allowedOrigins: ['https://oauth.alibaba.com'],
          credentials: 'omit',
          redirect: 'error',
          cache: 'no-store',
          timeoutMilliseconds: 30_000,
          maxRequestBytes: 16_384,
          maxResponseBytes: 65_536
        }
      }
    });
  }
  async request(
    path: Parameters<AuthorizationTokenClient['request']>[0],
    input: Parameters<AuthorizationTokenClient['request']>[1]
  ) {
    const create = path === '/auth/token/create';
    if (create && !input.redirectUri) throw this.failure('AUTH_INPUT_INVALID', input.requestId);
    const response = await this.network.request({
      service: 'alibaba',
      url: 'https://oauth.alibaba.com/token',
      method: 'POST',
      requestId: input.requestId,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
      body: new URLSearchParams({
        client_id: input.appKey,
        client_secret: input.appSecret,
        sp: 'icbu',
        grant_type: create ? 'authorization_code' : 'refresh_token',
        [create ? 'code' : 'refresh_token']: input.value,
        ...(create && input.redirectUri ? { redirect_uri: input.redirectUri } : {})
      }),
      responseType: 'text',
      maxAttempts: 1
    });
    let value: unknown;
    try {
      value = JSON.parse(String(response.data));
    } catch {
      throw this.failure('TOP_TOKEN_RESULT_UNKNOWN', input.requestId);
    }
    if (response.status >= 500 || !isRecord(value))
      throw this.failure('TOP_TOKEN_RESULT_UNKNOWN', input.requestId);
    if (typeof value.error === 'string' || isRecord(value.error_response))
      throw this.failure('TOP_TOKEN_REJECTED', input.requestId);
    if (!response.ok) throw this.failure('TOP_TOKEN_RESULT_UNKNOWN', input.requestId);
    try {
      return parseAlibabaTokenResponse(value);
    } catch {
      throw this.failure('TOP_TOKEN_RESULT_UNKNOWN', input.requestId);
    }
  }
  private failure(code: string, requestId: string): GatewayException {
    return new GatewayException({ code, message: code, retryable: false }, requestId);
  }
}
