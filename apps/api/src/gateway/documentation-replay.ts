import { getCapabilityDefinition } from '@one-vegetable/core';

import { AlibabaReadGatewayClient } from './alibaba-read-gateway';

import type { GatewayCredentials, NetworkTransport } from '@one-vegetable/core';
import type { AlibabaCredentialStatus } from './credentials';

export const DOCUMENTATION_REPLAY_ORIGIN = 'https://replay.alibaba.invalid';

const REPLAY_CREDENTIALS: GatewayCredentials = {
  appKey: 'documentation-replay-app-key',
  appSecret: 'documentation-replay-app-secret',
  accessToken: 'documentation-replay-access-token',
  endpoint: `${DOCUMENTATION_REPLAY_ORIGIN}/openapi/`,
  signMethod: 'hmac-sha256'
};

const SENSITIVE_KEYS = new Set([
  'access_token',
  'accesstoken',
  'app_key',
  'app_secret',
  'appkey',
  'appsecret',
  'authorization',
  'contentbase64',
  'cookie',
  'session',
  'sign'
]);

export type DocumentationReplayFault = 'none' | 'rate-limit-once' | 'upstream-unavailable' | 'contract-drift';

export interface DocumentationReplayOptions {
  fault?: DocumentationReplayFault;
  wait?: (milliseconds: number) => Promise<void>;
}

export class DocumentationReplayTransport implements NetworkTransport {
  readonly #fault: DocumentationReplayFault;
  readonly #attempts = new Map<string, number>();

  constructor(options: DocumentationReplayOptions = {}) {
    this.#fault = options.fault ?? 'none';
  }

  send(input: RequestInfo | URL, init: RequestInit): Promise<Response> {
    const url =
      input instanceof URL ? input : typeof input === 'string' ? new URL(input) : new URL(input.url);
    if (url.origin !== DOCUMENTATION_REPLAY_ORIGIN || init.method !== 'POST') {
      throw new Error('文档回放只接受固定 Alibaba 模拟端点的 POST 请求');
    }
    if (!(init.body instanceof URLSearchParams)) {
      throw new Error('文档回放请求体必须是 URLSearchParams');
    }
    const method = init.body.get('method');
    if (!method) throw new Error('文档回放请求缺少 method');
    const attempt = (this.#attempts.get(method) ?? 0) + 1;
    this.#attempts.set(method, attempt);

    if (this.#fault === 'rate-limit-once' && attempt === 1) {
      return Promise.resolve(
        Response.json({ error_response: { code: 429, msg: 'replay rate limit' } }, { status: 429 })
      );
    }
    if (this.#fault === 'upstream-unavailable') {
      return Promise.resolve(
        Response.json({ error_response: { code: 503, msg: 'replay unavailable' } }, { status: 503 })
      );
    }

    const responseExample = getCapabilityDefinition(method)?.responseExample;
    if (responseExample === undefined) {
      return Promise.resolve(
        Response.json({ error_response: { code: 'REPLAY_MISSING', msg: '没有可用的文档响应示例' } })
      );
    }
    assertSanitized(responseExample);
    const response = this.#fault === 'contract-drift' ? { replayUnexpected: true } : responseExample;
    const requestId = new Headers(init.headers).get('X-Request-ID') ?? crypto.randomUUID();
    return Promise.resolve(
      Response.json({
        [`${method.replaceAll('.', '_')}_response`]: structuredClone(response),
        request_id: `replay-${requestId}`
      })
    );
  }
}

export function createDocumentationReplayGateway(
  options: DocumentationReplayOptions = {}
): AlibabaReadGatewayClient {
  return new AlibabaReadGatewayClient(REPLAY_CREDENTIALS, {
    transport: new DocumentationReplayTransport(options),
    ...(options.wait ? { wait: options.wait } : {})
  });
}

export function documentationReplayStatus(): AlibabaCredentialStatus {
  return {
    source: 'documentation-replay',
    configured: false,
    hasAppKey: false,
    hasAppSecret: false,
    hasAccessToken: false,
    endpointOrigin: DOCUMENTATION_REPLAY_ORIGIN,
    signMethod: REPLAY_CREDENTIALS.signMethod
  };
}

function assertSanitized(value: unknown, depth = 0): void {
  if (depth > 20) throw new Error('文档回放 fixture 嵌套过深');
  if (Array.isArray(value)) {
    for (const item of value) assertSanitized(item, depth + 1);
    return;
  }
  if (typeof value !== 'object' || value === null) return;
  for (const [key, child] of Object.entries(value)) {
    if (SENSITIVE_KEYS.has(key.toLocaleLowerCase().replaceAll('-', '_'))) {
      throw new Error(`文档回放 fixture 包含敏感字段 ${key}`);
    }
    assertSanitized(child, depth + 1);
  }
}
